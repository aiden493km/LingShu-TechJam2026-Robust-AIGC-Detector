import decodeJpeg, { init as initJpeg } from '@jsquash/jpeg/decode.js';
import decodePng, { init as initPng } from '@jsquash/png/decode.js';
import resize, { initResize } from '@jsquash/resize';
import decodeWebp, { init as initWebp } from '@jsquash/webp/decode.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  imageDataToNormalizedChw,
  preprocessImage,
  preprocessValidatedImage,
} from '../../src/runtime/preprocess';
import { readAndValidateImageFile } from '../../src/runtime/upload';

vi.mock('@jsquash/jpeg/decode.js', () => ({ default: vi.fn(), init: vi.fn() }));
vi.mock('@jsquash/png/decode.js', () => ({ default: vi.fn(), init: vi.fn() }));
vi.mock('@jsquash/webp/decode.js', () => ({ default: vi.fn(), init: vi.fn() }));
vi.mock('@jsquash/resize', () => ({ default: vi.fn(), initResize: vi.fn() }));

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

const encoder = new TextEncoder();

// Synthetic parity data provenance: near-threshold-synthetic.png is the closest
// Pillow blend of demo_images/r2.png -> f1.png on the deterministic union of
// 0.00..1.00 step 0.01 and 0.8200..0.8300 step 0.0001. alpha=0.8209,
// FP32 probability=0.5583520990, frozen threshold=0.55657113.

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function uint32(value: number, littleEndian: boolean): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, littleEndian);
  return output;
}

function pngChunk(type: string, data = new Uint8Array()): Uint8Array {
  return concatBytes(uint32(data.length, false), encoder.encode(type), data, new Uint8Array(4));
}

function pngBytes(): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1, false);
  view.setUint32(4, 1, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concatBytes(
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk('IHDR', ihdr),
    pngChunk('IEND'),
  );
}

function webpBytes(): Uint8Array {
  const frame = Uint8Array.of(0x10, 0, 0, 0x9d, 0x01, 0x2a, 1, 0, 1, 0);
  const chunk = concatBytes(encoder.encode('VP8 '), uint32(frame.length, true), frame);
  const body = concatBytes(encoder.encode('WEBP'), chunk);
  return concatBytes(encoder.encode('RIFF'), uint32(body.length, true), body);
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return concatBytes(Uint8Array.of(0xff, marker, length >> 8, length & 0xff), payload);
}

function jpegImageStream(): Uint8Array {
  return concatBytes(
    jpegSegment(0xc0, Uint8Array.of(8, 0, 2, 0, 3, 1, 1, 0x11, 0)),
    jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)),
    Uint8Array.of(0x12, 0xff, 0x00, 0x34, 0xff, 0xd9),
  );
}

function jpegBytes(orientation?: number): Uint8Array {
  if (orientation === undefined) {
    return concatBytes(Uint8Array.of(0xff, 0xd8), jpegImageStream());
  }
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49], 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x0112, true);
  view.setUint16(12, 3, true);
  view.setUint32(14, 1, true);
  view.setUint16(18, orientation, true);
  const payload = concatBytes(Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0, 0), tiff);
  const length = payload.length + 2;
  return concatBytes(
    Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff),
    payload,
    jpegImageStream(),
  );
}

function solidImage(width: number, height: number, rgba: readonly number[]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set(rgba, offset);
  }
  return new ImageData(data, width, height);
}

function uncheckedImage(width: number, height: number, dataLength: number): ImageData {
  return {
    colorSpace: 'srgb',
    data: new Uint8ClampedArray(dataLength),
    width,
    height,
  } as ImageData;
}

function fileWithBytes(bytes: Uint8Array, name: string): {
  file: File;
  buffer: ArrayBuffer;
  read: ReturnType<typeof vi.fn<() => Promise<ArrayBuffer>>>;
} {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const read = vi.fn<() => Promise<ArrayBuffer>>().mockResolvedValue(buffer);
  const file = { name, size: bytes.length, type: '', arrayBuffer: read } as unknown as File;
  return { file, buffer, read };
}

const RESIZE_OPTIONS = {
  width: 384,
  height: 384,
  method: 'catrom',
  fitMethod: 'stretch',
  premultiply: false,
  linearRGB: false,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('imageDataToNormalizedChw', () => {
  it('ignores alpha and emits exact planar RGB ImageNet normalization', () => {
    const image = new ImageData(
      Uint8ClampedArray.of(255, 0, 0, 0, 0, 255, 0, 128),
      2,
      1,
    );

    const tensor = imageDataToNormalizedChw(image);
    const expected = [
      (1 - 0.485) / 0.229,
      (0 - 0.485) / 0.229,
      (0 - 0.456) / 0.224,
      (1 - 0.456) / 0.224,
      (0 - 0.406) / 0.225,
      (0 - 0.406) / 0.225,
    ];

    expect(tensor).toBeInstanceOf(Float32Array);
    expect(tensor).toHaveLength(6);
    expected.forEach((value, index) => {
      expect(Math.abs((tensor[index] ?? Number.NaN) - value)).toBeLessThanOrEqual(1e-6);
    });
  });

  it('produces identical values for identical hidden RGB with different alpha', () => {
    const transparent = new ImageData(Uint8ClampedArray.of(17, 83, 241, 0), 1, 1);
    const opaque = new ImageData(Uint8ClampedArray.of(17, 83, 241, 255), 1, 1);

    expect(imageDataToNormalizedChw(transparent)).toEqual(imageDataToNormalizedChw(opaque));
  });

  it('rejects an ImageData payload whose byte length disagrees with its geometry', () => {
    expect(() => imageDataToNormalizedChw(uncheckedImage(2, 2, 15))).toThrow(
      /dimensions|safe limit|megapixels/i,
    );
  });
});

describe('preprocessImage', () => {
  it('warms every supported decoder and the resize runtime before image selection', async () => {
    vi.mocked(decodeJpeg).mockRejectedValue(new Error('Decoding error'));
    vi.mocked(decodeWebp).mockRejectedValue(new Error('Decoding error'));
    const module = await import('../../src/runtime/preprocess');
    expect(typeof module.prepareImageRuntime).toBe('function');

    await module.prepareImageRuntime();

    expect(initJpeg).toHaveBeenCalledTimes(1);
    expect(initPng).toHaveBeenCalledTimes(1);
    expect(initWebp).toHaveBeenCalledTimes(1);
    expect(initResize).toHaveBeenCalledTimes(1);
  });

  it('reuses one validated byte buffer across the validation and preprocessing boundary', async () => {
    const fixture = fileWithBytes(pngBytes(), 'one-read.png');
    vi.mocked(decodePng).mockResolvedValue(solidImage(384, 384, [10, 20, 30, 255]));

    const validated = await readAndValidateImageFile(fixture.file);
    const result = await preprocessValidatedImage(validated.buffer, validated.format);

    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(decodePng).toHaveBeenCalledWith(fixture.buffer, { bitDepth: 8 });
    expect(result.tensor).toHaveLength(3 * 384 * 384);
  });

  it('routes JPEG bytes to the deep decoder with orientation disabled, then applies EXIF once', async () => {
    const fixture = fileWithBytes(jpegBytes(6), 'misleading.png');
    const decoded = new ImageData(
      Uint8ClampedArray.of(
        1, 2, 3, 0,
        11, 12, 13, 128,
        21, 22, 23, 255,
        31, 32, 33, 64,
        41, 42, 43, 192,
        51, 52, 53, 255,
      ),
      3,
      2,
    );
    const resized = solidImage(384, 384, [7, 8, 9, 255]);
    vi.mocked(decodeJpeg).mockResolvedValue(decoded);
    vi.mocked(resize).mockResolvedValue(resized);

    const result = await preprocessImage(fixture.file);

    expect(decodeJpeg).toHaveBeenCalledWith(fixture.buffer, { preserveOrientation: false });
    expect(decodePng).not.toHaveBeenCalled();
    expect(decodeWebp).not.toHaveBeenCalled();
    expect(resize).toHaveBeenCalledWith(expect.objectContaining({ width: 2, height: 3 }), RESIZE_OPTIONS);
    const oriented = vi.mocked(resize).mock.calls[0]?.[0];
    expect(oriented && [...oriented.data]).toEqual([
      31, 32, 33, 64, 1, 2, 3, 0,
      41, 42, 43, 192, 11, 12, 13, 128,
      51, 52, 53, 255, 21, 22, 23, 255,
    ]);
    expect(result).toMatchObject({
      originalWidth: 3,
      originalHeight: 2,
      orientedWidth: 2,
      orientedHeight: 3,
    });
    expect(result.tensor).toHaveLength(3 * 384 * 384);
    expect(fixture.read).toHaveBeenCalledTimes(1);
  });

  it('routes PNG bytes to the deep decoder with forced 8-bit output', async () => {
    const fixture = fileWithBytes(pngBytes(), 'wrong.webp');
    vi.mocked(decodePng).mockResolvedValue(solidImage(2, 4, [10, 20, 30, 40]));
    vi.mocked(resize).mockResolvedValue(solidImage(384, 384, [10, 20, 30, 40]));

    await preprocessImage(fixture.file);

    expect(decodePng).toHaveBeenCalledWith(fixture.buffer, { bitDepth: 8 });
    expect(decodeJpeg).not.toHaveBeenCalled();
    expect(decodeWebp).not.toHaveBeenCalled();
    expect(resize).toHaveBeenCalledWith(expect.any(ImageData), RESIZE_OPTIONS);
  });

  it('routes WebP bytes to the deep decoder without encoder-side options', async () => {
    const fixture = fileWithBytes(webpBytes(), 'wrong.jpg');
    vi.mocked(decodeWebp).mockResolvedValue(solidImage(5, 2, [10, 20, 30, 40]));
    vi.mocked(resize).mockResolvedValue(solidImage(384, 384, [10, 20, 30, 40]));

    await preprocessImage(fixture.file);

    expect(decodeWebp).toHaveBeenCalledWith(fixture.buffer);
    expect(decodeJpeg).not.toHaveBeenCalled();
    expect(decodePng).not.toHaveBeenCalled();
    expect(resize).toHaveBeenCalledWith(expect.any(ImageData), RESIZE_OPTIONS);
  });

  it('bypasses resize only at exactly 384 by 384 and keeps raw hidden RGB', async () => {
    const fixture = fileWithBytes(pngBytes(), 'exact.png');
    const decoded = solidImage(384, 384, [255, 0, 127, 0]);
    vi.mocked(decodePng).mockResolvedValue(decoded);

    const result = await preprocessImage(fixture.file);

    expect(resize).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      originalWidth: 384,
      originalHeight: 384,
      orientedWidth: 384,
      orientedHeight: 384,
    });
    const pixels = 384 * 384;
    expect(result.tensor[0]).toBeCloseTo((1 - 0.485) / 0.229, 6);
    expect(result.tensor[pixels]).toBeCloseTo((0 - 0.456) / 0.224, 6);
    expect(result.tensor[pixels * 2]).toBeCloseTo((127 / 255 - 0.406) / 0.225, 6);
  });

  it('rejects unsupported bytes before invoking any decoder', async () => {
    const fixture = fileWithBytes(encoder.encode('GIF89a'), 'spoof.png');

    await expect(preprocessImage(fixture.file)).rejects.toThrow(/JPEG, PNG, or WebP/i);
    expect(decodeJpeg).not.toHaveBeenCalled();
    expect(decodePng).not.toHaveBeenCalled();
    expect(decodeWebp).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
  });

  it('propagates file-read errors without invoking decode', async () => {
    const readError = new Error('read failed');
    const read = vi.fn<() => Promise<ArrayBuffer>>().mockRejectedValue(readError);
    const file = {
      name: 'read.jpg',
      size: 4,
      type: '',
      arrayBuffer: read,
    } as unknown as File;

    await expect(preprocessImage(file)).rejects.toBe(readError);
    expect(read).toHaveBeenCalledTimes(1);
    expect(decodeJpeg).not.toHaveBeenCalled();
  });

  it('propagates decoder errors and never attempts resize', async () => {
    const fixture = fileWithBytes(jpegBytes(), 'broken.jpg');
    const decodeError = new Error('decode failed');
    vi.mocked(decodeJpeg).mockRejectedValue(decodeError);

    await expect(preprocessImage(fixture.file)).rejects.toBe(decodeError);
    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(resize).not.toHaveBeenCalled();
  });

  it('rejects a decoder result whose RGBA byte length is inconsistent', async () => {
    const fixture = fileWithBytes(pngBytes(), 'mismatched.png');
    vi.mocked(decodePng).mockResolvedValue(uncheckedImage(2, 2, 15));

    await expect(preprocessImage(fixture.file)).rejects.toThrow(
      /dimensions|safe limit|megapixels/i,
    );
    expect(resize).not.toHaveBeenCalled();
  });

  it('rejects an oversized decoder result before allocating or resizing it', async () => {
    const fixture = fileWithBytes(pngBytes(), 'oversized.png');
    vi.mocked(decodePng).mockResolvedValue(uncheckedImage(16_384, 2_049, 4));

    await expect(preprocessImage(fixture.file)).rejects.toThrow(
      /dimensions|safe limit|megapixels/i,
    );
    expect(resize).not.toHaveBeenCalled();
  });

  it('rejects a resize result that is not exactly 384 by 384', async () => {
    const fixture = fileWithBytes(pngBytes(), 'wrong-resize-size.png');
    vi.mocked(decodePng).mockResolvedValue(solidImage(2, 2, [1, 2, 3, 4]));
    vi.mocked(resize).mockResolvedValue(solidImage(383, 384, [1, 2, 3, 4]));

    await expect(preprocessImage(fixture.file)).rejects.toThrow(
      /dimensions|safe limit|megapixels/i,
    );
  });

  it('rejects a resize result whose RGBA byte length is inconsistent', async () => {
    const fixture = fileWithBytes(pngBytes(), 'wrong-resize-data.png');
    vi.mocked(decodePng).mockResolvedValue(solidImage(2, 2, [1, 2, 3, 4]));
    vi.mocked(resize).mockResolvedValue(uncheckedImage(384, 384, 384 * 384 * 4 - 1));

    await expect(preprocessImage(fixture.file)).rejects.toThrow(
      /dimensions|safe limit|megapixels/i,
    );
  });

  it('propagates resize errors after one decode and one file read', async () => {
    const fixture = fileWithBytes(webpBytes(), 'resize.webp');
    const resizeError = new Error('resize failed');
    vi.mocked(decodeWebp).mockResolvedValue(solidImage(8, 9, [1, 2, 3, 4]));
    vi.mocked(resize).mockRejectedValue(resizeError);

    await expect(preprocessImage(fixture.file)).rejects.toBe(resizeError);
    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(decodeWebp).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledTimes(1);
  });
});
