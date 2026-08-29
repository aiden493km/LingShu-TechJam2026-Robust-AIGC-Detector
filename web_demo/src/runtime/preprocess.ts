import decodeJpeg from '@jsquash/jpeg/decode.js';
import decodePng from '@jsquash/png/decode.js';
import resize from '@jsquash/resize';
import decodeWebp from '@jsquash/webp/decode.js';

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

export async function preprocessImage(file: File): Promise<PreprocessedImage> {
  const { buffer, format } = await readAndValidateImageFile(file);
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
