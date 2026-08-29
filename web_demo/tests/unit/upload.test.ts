import { describe, expect, it, vi } from 'vitest';

import { validateImageFile } from '../../src/runtime/upload';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const encoder = new TextEncoder();

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function uint32BigEndian(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function uint32LittleEndian(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function pngChunk(type: string, data = new Uint8Array()): Uint8Array {
  return concatBytes(
    uint32BigEndian(data.length),
    encoder.encode(type),
    data,
    new Uint8Array(4),
  );
}

function pngBytes(...extraChunks: Uint8Array[]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1, false);
  view.setUint32(4, 1, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concatBytes(
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk('IHDR', ihdr),
    ...extraChunks,
    pngChunk('IEND'),
  );
}

function exactSizePng(size: number): Uint8Array {
  const prefix = pngBytes().subarray(0, 8 + 12 + 13);
  const suffix = pngChunk('IEND');
  const fillerLength = size - prefix.length - suffix.length - 12;
  return concatBytes(prefix, pngChunk('tEXt', new Uint8Array(fillerLength)), suffix);
}

function webpChunk(type: string, data: Uint8Array): Uint8Array {
  return concatBytes(
    encoder.encode(type),
    uint32LittleEndian(data.length),
    data,
    data.length % 2 === 1 ? Uint8Array.of(0) : new Uint8Array(),
  );
}

function webpBytes(...chunks: Uint8Array[]): Uint8Array {
  const body = concatBytes(encoder.encode('WEBP'), ...chunks);
  return concatBytes(encoder.encode('RIFF'), uint32LittleEndian(body.length), body);
}

function imageFile(bytes: Uint8Array, name = 'fixture.bin', type = ''): File {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([buffer], name, { type });
}

describe('validateImageFile', () => {
  it('accepts a structurally valid image at the exact 25 MiB boundary', async () => {
    const file = imageFile(exactSizePng(MAX_IMAGE_BYTES), 'boundary.dat', 'text/plain');

    await expect(validateImageFile(file)).resolves.toBe('png');
  });

  it('rejects an empty file before reading it', async () => {
    const arrayBuffer = vi.fn<() => Promise<ArrayBuffer>>();
    const file = {
      name: 'empty.png',
      size: 0,
      type: 'image/png',
      arrayBuffer,
    } as unknown as File;

    await expect(validateImageFile(file)).rejects.toThrow(/empty|0 bytes/i);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects a file larger than 25 MiB before reading it', async () => {
    const arrayBuffer = vi.fn<() => Promise<ArrayBuffer>>();
    const file = {
      name: 'large.png',
      size: MAX_IMAGE_BYTES + 1,
      type: 'image/png',
      arrayBuffer,
    } as unknown as File;

    await expect(validateImageFile(file)).rejects.toThrow(/25 MiB/i);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it.each([
    ['jpeg', Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)],
    ['png', pngBytes()],
    ['webp', webpBytes(webpChunk('VP8 ', Uint8Array.of(0, 0)))],
  ] as const)('detects %s from bytes regardless of filename or MIME', async (format, bytes) => {
    const file = imageFile(bytes, 'misleading.txt', 'application/octet-stream');

    await expect(validateImageFile(file)).resolves.toBe(format);
  });

  it('rejects a spoofed supported extension and MIME type', async () => {
    const file = imageFile(encoder.encode('plain text'), 'spoof.jpg', 'image/jpeg');

    await expect(validateImageFile(file)).rejects.toThrow(/JPEG, PNG, or WebP/i);
  });

  it('rejects a PNG containing the APNG acTL chunk', async () => {
    const file = imageFile(pngBytes(pngChunk('acTL', new Uint8Array(8))), 'animated.png');

    await expect(validateImageFile(file)).rejects.toThrow(/animated/i);
  });

  it.each(['ANIM', 'ANMF'])('rejects a WebP containing the %s animation chunk', async (type) => {
    const file = imageFile(webpBytes(webpChunk(type, new Uint8Array())), 'animated.webp');

    await expect(validateImageFile(file)).rejects.toThrow(/animated/i);
  });

  it('rejects a WebP whose VP8X feature flags declare animation', async () => {
    const flags = new Uint8Array(10);
    flags[0] = 0x02;
    const file = imageFile(webpBytes(webpChunk('VP8X', flags)), 'animated.webp');

    await expect(validateImageFile(file)).rejects.toThrow(/animated/i);
  });

  it.each([
    ['BMP', Uint8Array.of(0x42, 0x4d, 0, 0)],
    ['little-endian TIFF', Uint8Array.of(0x49, 0x49, 0x2a, 0)],
    ['big-endian TIFF', Uint8Array.of(0x4d, 0x4d, 0, 0x2a)],
    ['GIF87a', encoder.encode('GIF87a')],
    ['GIF89a', encoder.encode('GIF89a')],
  ])('rejects the unsupported %s signature', async (_label, bytes) => {
    await expect(validateImageFile(imageFile(bytes))).rejects.toThrow(/JPEG, PNG, or WebP/i);
  });

  it('rejects truncated and overflowing PNG chunk layouts', async () => {
    const truncated = pngBytes().subarray(0, pngBytes().length - 1);
    const overflowing = concatBytes(
      Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      uint32BigEndian(0xffff_ffff),
      encoder.encode('IHDR'),
    );

    await expect(validateImageFile(imageFile(truncated))).rejects.toThrow(/malformed|truncated/i);
    await expect(validateImageFile(imageFile(overflowing))).rejects.toThrow(/malformed|truncated/i);
  });

  it('rejects inconsistent RIFF bounds, WebP chunk overflow, and missing odd-byte padding', async () => {
    const inconsistentRiff = webpBytes(webpChunk('VP8 ', Uint8Array.of(0, 0)));
    new DataView(inconsistentRiff.buffer).setUint32(4, inconsistentRiff.length, true);
    const overflowingChunk = concatBytes(
      encoder.encode('RIFF'),
      uint32LittleEndian(13),
      encoder.encode('WEBP'),
      encoder.encode('VP8 '),
      uint32LittleEndian(10),
      Uint8Array.of(0),
    );
    const missingPadding = concatBytes(
      encoder.encode('RIFF'),
      uint32LittleEndian(13),
      encoder.encode('WEBP'),
      encoder.encode('VP8 '),
      uint32LittleEndian(1),
      Uint8Array.of(0),
    );

    await expect(validateImageFile(imageFile(inconsistentRiff))).rejects.toThrow(/malformed|truncated/i);
    await expect(validateImageFile(imageFile(overflowingChunk))).rejects.toThrow(/malformed|truncated/i);
    await expect(validateImageFile(imageFile(missingPadding))).rejects.toThrow(/malformed|truncated/i);
  });

  it('returns safe actionable errors without echoing hostile names or bytes', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const file = imageFile(encoder.encode(hostile), `${hostile}.jpg`, 'image/jpeg');

    const error = await validateImageFile(file).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/JPEG, PNG, or WebP/i);
    expect((error as Error).message).not.toContain('<');
    expect((error as Error).message).not.toContain('onerror');
  });

  it('reads an accepted-size file exactly once', async () => {
    const file = imageFile(pngBytes(), 'single-read.png');
    const arrayBuffer = vi.spyOn(file, 'arrayBuffer');

    await validateImageFile(file);

    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });
});
