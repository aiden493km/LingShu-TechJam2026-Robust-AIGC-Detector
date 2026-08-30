import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ModelIntegrityError,
  sha256Hex,
  verifyModelSha256,
  type Sha256Digest,
} from '../../src/runtime/model-integrity';

const SHA256_123 =
  '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('model SHA-256 integrity', () => {
  it('computes the lowercase SHA-256 digest of the requested bytes', async () => {
    await expect(sha256Hex(Uint8Array.of(1, 2, 3))).resolves.toBe(SHA256_123);
  });

  it('hashes only the Uint8Array view when it has a non-zero byte offset', async () => {
    const storage = Uint8Array.of(9, 1, 2, 3, 8);

    await expect(sha256Hex(storage.subarray(1, 4))).resolves.toBe(SHA256_123);
  });

  it('copies a SharedArrayBuffer-backed view before hashing it', async () => {
    const storage = new Uint8Array(new SharedArrayBuffer(5));
    storage.set([9, 1, 2, 3, 8]);

    await expect(sha256Hex(storage.subarray(1, 4))).resolves.toBe(SHA256_123);
  });

  it('fails explicitly when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);

    await expect(sha256Hex(Uint8Array.of(1, 2, 3))).rejects.toThrow(
      /Web Crypto.*unavailable/i,
    );
  });

  it('throws ModelIntegrityError when the downloaded digest does not match', async () => {
    const expected = '0'.repeat(64);

    await expect(verifyModelSha256(Uint8Array.of(1, 2, 3), expected)).rejects.toMatchObject({
      name: 'ModelIntegrityError',
      message: expect.stringContaining('SHA-256 does not match'),
    });
    await expect(verifyModelSha256(Uint8Array.of(1, 2, 3), expected)).rejects.toBeInstanceOf(
      ModelIntegrityError,
    );
  });

  it.each([
    ['too short', '0'.repeat(63)],
    ['uppercase', 'A'.repeat(64)],
    ['non-hex', 'g'.repeat(64)],
  ])('rejects a %s expected digest before hashing', async (_name, expected) => {
    const digest: Sha256Digest = vi.fn().mockResolvedValue(SHA256_123);

    await expect(verifyModelSha256(Uint8Array.of(1, 2, 3), expected, digest)).rejects.toThrow(
      /64-character lowercase/i,
    );
    expect(digest).not.toHaveBeenCalled();
  });
});
