import decodeJpeg, { init as initJpeg } from '@jsquash/jpeg/decode.js';
import decodePng, { init as initPng } from '@jsquash/png/decode.js';
import resize, { initResize } from '@jsquash/resize';
import decodeWebp, { init as initWebp } from '@jsquash/webp/decode.js';

import { applyExifOrientation, readJpegOrientation } from './exif';
import {
  assertSafeImageGeometry,
  IMAGE_GEOMETRY_ERROR,
  readAndValidateImageFile,
  type SupportedImageFormat,
} from './upload';

const TARGET_SIZE = 384;
const RED_MEAN = 0.485;
const GREEN_MEAN = 0.456;
const BLUE_MEAN = 0.406;
const RED_STD = 0.229;
const GREEN_STD = 0.224;
const BLUE_STD = 0.225;

const RESIZE_OPTIONS = {
  width: TARGET_SIZE,
  height: TARGET_SIZE,
  method: 'catrom',
  fitMethod: 'stretch',
  premultiply: false,
  linearRGB: false,
} as const;

const JPEG_RUNTIME_WARMUP_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/CABEIAAEAAQMBEQACEQEDEQH/xAAmAAEAAAAAAAAAAAAAAAAAAAAKAQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8Af//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Af//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Af//Z';
const WEBP_RUNTIME_WARMUP_BASE64 = 'UklGRhoAAABXRUJQVlA4TA4AAAAvAAAAAAcQEf0PRET/Aw==';

function decodeEmbeddedBytes(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

const JPEG_RUNTIME_WARMUP = decodeEmbeddedBytes(JPEG_RUNTIME_WARMUP_BASE64);
const WEBP_RUNTIME_WARMUP = decodeEmbeddedBytes(WEBP_RUNTIME_WARMUP_BASE64);

let imageRuntimeReady: Promise<void> | undefined;

async function initializeEmscriptenDecoder(
  initialize: (options?: { print?: (...values: unknown[]) => void; printErr?: (...values: unknown[]) => void }) => Promise<void>,
  decode: (buffer: ArrayBuffer) => Promise<ImageData>,
  warmup: ArrayBuffer,
): Promise<void> {
  await initialize({ print: () => undefined, printErr: () => undefined });
  await decode(warmup);
}

export function prepareImageRuntime(): Promise<void> {
  imageRuntimeReady ??= Promise.all([
    initializeEmscriptenDecoder(
      initJpeg,
      (buffer) => decodeJpeg(buffer, { preserveOrientation: false }),
      JPEG_RUNTIME_WARMUP,
    ),
    Promise.resolve(initPng()).then(() => undefined),
    initializeEmscriptenDecoder(initWebp, decodeWebp, WEBP_RUNTIME_WARMUP),
    Promise.resolve(initResize()).then(() => undefined),
  ]).then(() => undefined);
  return imageRuntimeReady;
}

export interface PreprocessedImage {
  tensor: Float32Array;
  originalWidth: number;
  originalHeight: number;
  orientedWidth: number;
  orientedHeight: number;
}

function assertValidImageData(image: ImageData, requireTargetSize = false): void {
  assertSafeImageGeometry(image.width, image.height);
  const expectedByteLength = image.width * image.height * 4;
  if (
    image.data === undefined ||
    image.data.length !== expectedByteLength ||
    (requireTargetSize && (image.width !== TARGET_SIZE || image.height !== TARGET_SIZE))
  ) {
    throw new Error(IMAGE_GEOMETRY_ERROR);
  }
}

export function imageDataToNormalizedChw(image: ImageData): Float32Array {
  assertValidImageData(image);
  const pixelCount = image.width * image.height;
  const tensor = new Float32Array(pixelCount * 3);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const sourceOffset = pixel * 4;
    const red = image.data[sourceOffset]! / 255;
    const green = image.data[sourceOffset + 1]! / 255;
    const blue = image.data[sourceOffset + 2]! / 255;

    tensor[pixel] = (red - RED_MEAN) / RED_STD;
    tensor[pixelCount + pixel] = (green - GREEN_MEAN) / GREEN_STD;
    tensor[pixelCount * 2 + pixel] = (blue - BLUE_MEAN) / BLUE_STD;
  }

  return tensor;
}

async function decodeImage(format: SupportedImageFormat, buffer: ArrayBuffer): Promise<ImageData> {
  switch (format) {
    case 'jpeg':
      return decodeJpeg(buffer, { preserveOrientation: false });
    case 'png':
      return decodePng(buffer, { bitDepth: 8 });
    case 'webp':
      return decodeWebp(buffer);
  }
}

export async function preprocessValidatedImage(
  buffer: ArrayBuffer,
  format: SupportedImageFormat,
): Promise<PreprocessedImage> {
  const orientation = format === 'jpeg' ? readJpegOrientation(buffer) : 1;
  const decoded = await decodeImage(format, buffer);
  assertValidImageData(decoded);
  const originalWidth = decoded.width;
  const originalHeight = decoded.height;
  const oriented = format === 'jpeg' ? applyExifOrientation(decoded, orientation) : decoded;
  assertValidImageData(oriented);
  const orientedWidth = oriented.width;
  const orientedHeight = oriented.height;
  const prepared =
    orientedWidth === TARGET_SIZE && orientedHeight === TARGET_SIZE
      ? oriented
      : await resize(oriented, RESIZE_OPTIONS);
  assertValidImageData(prepared, true);

  return {
    tensor: imageDataToNormalizedChw(prepared),
    originalWidth,
    originalHeight,
    orientedWidth,
    orientedHeight,
  };
}

export async function preprocessImage(file: File): Promise<PreprocessedImage> {
  const { buffer, format } = await readAndValidateImageFile(file);
  return preprocessValidatedImage(buffer, format);
}
