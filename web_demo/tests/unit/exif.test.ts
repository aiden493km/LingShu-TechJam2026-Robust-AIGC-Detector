import { describe, expect, it, vi } from 'vitest';

import { applyExifOrientation, readJpegOrientation } from '../../src/runtime/exif';

class ImageDataShim {
  readonly colorSpace = 'srgb' as const;
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    if (data.length !== width * height * 4) {
      throw new Error('Invalid ImageData dimensions');
    }
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

vi.stubGlobal('ImageData', ImageDataShim);

const PIXELS = {
  A: [1, 2, 3, 0],
  B: [11, 12, 13, 128],
  C: [21, 22, 23, 255],
  D: [31, 32, 33, 64],
  E: [41, 42, 43, 192],
  F: [51, 52, 53, 255],
} as const;

type PixelName = keyof typeof PIXELS;

function imageFromRows(rows: PixelName[][]): ImageData {
  const values = rows.flatMap((row) => row.flatMap((name) => [...PIXELS[name]]));
  return new ImageData(new Uint8ClampedArray(values), rows[0]?.length ?? 0, rows.length);
}

function bytesFromRows(rows: PixelName[][]): number[] {
  return rows.flatMap((row) => row.flatMap((name) => [...PIXELS[name]]));
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function exifJpeg(
  orientation: number,
  littleEndian: boolean,
  overrides: { type?: number; count?: number; ifdOffset?: number; magic?: number } = {},
): Uint8Array {
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  tiff.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  view.setUint16(2, overrides.magic ?? 42, littleEndian);
  view.setUint32(4, overrides.ifdOffset ?? 8, littleEndian);
  view.setUint16(8, 1, littleEndian);
  view.setUint16(10, 0x0112, littleEndian);
  view.setUint16(12, overrides.type ?? 3, littleEndian);
  view.setUint32(14, overrides.count ?? 1, littleEndian);
  view.setUint16(18, orientation, littleEndian);
  view.setUint32(22, 0, littleEndian);

  const payload = concatBytes(Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0, 0), tiff);
  const length = payload.length + 2;
  return concatBytes(
    Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff),
    payload,
    Uint8Array.of(0xff, 0xd9),
  );
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('readJpegOrientation', () => {
  it('reads an inline SHORT orientation from little-endian TIFF', () => {
    expect(readJpegOrientation(asArrayBuffer(exifJpeg(6, true)))).toBe(6);
  });

  it('reads an inline SHORT orientation from big-endian TIFF', () => {
    expect(readJpegOrientation(asArrayBuffer(exifJpeg(8, false)))).toBe(8);
  });

  it('skips bounded non-EXIF segments before the EXIF APP1 segment', () => {
    const exif = exifJpeg(5, true);
    const jpeg = concatBytes(
      Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x12, 0x34),
      exif.subarray(2),
    );

    expect(readJpegOrientation(asArrayBuffer(jpeg))).toBe(5);
  });

  it('stops at SOS and EOI instead of scanning entropy-coded or trailing bytes', () => {
    const app1 = exifJpeg(6, true).subarray(2, -2);
    const afterSos = concatBytes(
      Uint8Array.of(0xff, 0xd8, 0xff, 0xda, 0, 2),
      app1,
      Uint8Array.of(0xff, 0xd9),
    );
    const afterEoi = concatBytes(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), app1);

    expect(readJpegOrientation(asArrayBuffer(afterSos))).toBe(1);
    expect(readJpegOrientation(asArrayBuffer(afterEoi))).toBe(1);
  });

  it.each([
    ['not a JPEG', Uint8Array.of(0, 1, 2, 3)],
    ['truncated marker', Uint8Array.of(0xff, 0xd8, 0xff)],
    ['segment length below two', Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0, 1, 0xff, 0xd9)],
    ['segment beyond input', Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff)],
    ['truncated EXIF payload', Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0, 9, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49)],
    ['invalid TIFF byte order', (() => {
      const bytes = exifJpeg(6, true);
      bytes.set([0x58, 0x58], 12);
      return bytes;
    })()],
    ['wrong TIFF magic', exifJpeg(6, true, { magic: 41 })],
    ['IFD0 outside APP1', exifJpeg(6, true, { ifdOffset: 0xffff_ffff })],
    ['wrong orientation type', exifJpeg(6, true, { type: 4 })],
    ['wrong orientation count', exifJpeg(6, true, { count: 2 })],
  ])('returns 1 for %s without reading out of bounds', (_label, bytes) => {
    expect(() => readJpegOrientation(asArrayBuffer(bytes))).not.toThrow();
    expect(readJpegOrientation(asArrayBuffer(bytes))).toBe(1);
  });

  it.each([0, 9, 0xffff])('returns 1 for out-of-range orientation %s', (orientation) => {
    expect(readJpegOrientation(asArrayBuffer(exifJpeg(orientation, true)))).toBe(1);
  });
});

describe('applyExifOrientation', () => {
  const sourceRows: PixelName[][] = [
    ['A', 'B', 'C'],
    ['D', 'E', 'F'],
  ];

  it.each([
    [1, 3, 2, [['A', 'B', 'C'], ['D', 'E', 'F']]],
    [2, 3, 2, [['C', 'B', 'A'], ['F', 'E', 'D']]],
    [3, 3, 2, [['F', 'E', 'D'], ['C', 'B', 'A']]],
    [4, 3, 2, [['D', 'E', 'F'], ['A', 'B', 'C']]],
    [5, 2, 3, [['A', 'D'], ['B', 'E'], ['C', 'F']]],
    [6, 2, 3, [['D', 'A'], ['E', 'B'], ['F', 'C']]],
    [7, 2, 3, [['F', 'C'], ['E', 'B'], ['D', 'A']]],
    [8, 2, 3, [['C', 'F'], ['B', 'E'], ['A', 'D']]],
  ] as const)(
    'maps orientation %i to the exact RGBA pixel grid',
    (orientation, width, height, expectedRows) => {
      const source = imageFromRows(sourceRows);

      const result = applyExifOrientation(source, orientation);

      expect([result.width, result.height]).toEqual([width, height]);
      expect([...result.data]).toEqual(bytesFromRows(expectedRows as unknown as PixelName[][]));
      expect(result.data).not.toBe(source.data);
    },
  );

  it.each([0, 9, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'safely treats invalid orientation %s as orientation 1',
    (orientation) => {
      const source = imageFromRows(sourceRows);

      const result = applyExifOrientation(source, orientation);

      expect([result.width, result.height]).toEqual([3, 2]);
      expect([...result.data]).toEqual(bytesFromRows(sourceRows));
    },
  );

  it('preserves RGB bytes hidden beneath alpha zero', () => {
    const source = imageFromRows(sourceRows);

    const result = applyExifOrientation(source, 6);

    expect([...result.data.slice(4, 8)]).toEqual([...PIXELS.A]);
  });
});
