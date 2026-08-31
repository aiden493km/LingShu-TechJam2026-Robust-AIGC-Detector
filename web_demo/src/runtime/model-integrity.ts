export class ModelIntegrityError extends Error {
  override readonly name = 'ModelIntegrityError';
}

export type Sha256Digest = (bytes: Uint8Array) => Promise<string>;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (
    typeof cryptoApi !== 'object' ||
    cryptoApi === null ||
    typeof cryptoApi.subtle !== 'object' ||
    cryptoApi.subtle === null ||
    typeof cryptoApi.subtle.digest !== 'function'
  ) {
    throw new ModelIntegrityError('Web Crypto SHA-256 is unavailable');
  }

  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await cryptoApi.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function verifyModelSha256(
  bytes: Uint8Array,
  expected: string,
  digest: Sha256Digest = sha256Hex,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new ModelIntegrityError(
      'Expected model SHA-256 must be a 64-character lowercase hexadecimal digest',
    );
  }

  const actual = await digest(bytes);
  if (actual !== expected) {
    throw new ModelIntegrityError(
      `Downloaded model SHA-256 does not match: expected ${expected}, received ${actual}`,
    );
  }
}
