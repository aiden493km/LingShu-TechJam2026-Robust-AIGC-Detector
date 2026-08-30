export type SupportedImageFormat = 'jpeg' | 'png' | 'webp';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 16_384;
export const MAX_IMAGE_PIXELS = 32 * 1024 * 1024;
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const EMPTY_ERROR =
  'The selected image is empty. Choose a JPEG, PNG, or WebP image up to 25 MiB.';
const SIZE_ERROR =
  'The selected image exceeds the 25 MiB limit. Choose a smaller JPEG, PNG, or WebP image.';
const FORMAT_ERROR = 'Choose a valid JPEG, PNG, or WebP image.';
const MALFORMED_ERROR =
  'The selected image is malformed or truncated. Choose a valid JPEG, PNG, or WebP image.';
const ANIMATION_ERROR =
  'Animated images are not supported. Choose a still JPEG, PNG, or WebP image.';
export const IMAGE_GEOMETRY_ERROR =
  'The image dimensions exceed the safe limit. Choose an image with positive dimensions, at most 16384 pixels per side and 32 megapixels.';

export function assertSafeImageGeometry(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION
  ) {
    throw new Error(IMAGE_GEOMETRY_ERROR);
  }

  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_IMAGE_PIXELS) {
    throw new Error(IMAGE_GEOMETRY_ERROR);
  }
}

function assertAllowedSize(size: number): void {
  if (size === 0) {
    throw new Error(EMPTY_ERROR);
  }
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_IMAGE_BYTES) {
    throw new Error(SIZE_ERROR);
  }
}

function bytesEqualAt(bytes: Uint8Array, offset: number, expected: Uint8Array): boolean {
  if (offset < 0 || offset + expected.length > bytes.length) {
    return false;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected[index]) {
      return false;
    }
  }
  return true;
}

function asciiEqualAt(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (offset < 0 || offset + expected.length > bytes.length) {
    return false;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function isStartOfFrameMarker(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function validateJpegStructure(bytes: Uint8Array): void {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(MALFORMED_ERROR);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let inEntropy = false;
  let frame:
    | {
        precision: number;
        width: number;
        height: number;
      }
    | undefined;
  let sawScan = false;

  while (offset < bytes.length) {
    let marker: number | undefined;

    if (inEntropy) {
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }

        offset += 1;
        while (offset < bytes.length && bytes[offset] === 0xff) {
          offset += 1;
        }
        if (offset >= bytes.length) {
          throw new Error(MALFORMED_ERROR);
        }

        const entropyMarker = bytes[offset]!;
        offset += 1;
        if (entropyMarker === 0x00 || (entropyMarker >= 0xd0 && entropyMarker <= 0xd7)) {
          continue;
        }

        marker = entropyMarker;
        inEntropy = false;
        break;
      }
    } else {
      if (bytes[offset] !== 0xff) {
        throw new Error(MALFORMED_ERROR);
      }
      while (offset < bytes.length && bytes[offset] === 0xff) {
        offset += 1;
      }
      if (offset >= bytes.length) {
        throw new Error(MALFORMED_ERROR);
      }
      marker = bytes[offset]!;
      offset += 1;
    }

    if (marker === undefined || marker === 0x00 || (marker > 0x01 && marker < 0xc0)) {
      throw new Error(MALFORMED_ERROR);
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      throw new Error(MALFORMED_ERROR);
    }
    if (marker === 0xd9) {
      // Strict policy: EOI must be the final two-byte marker; trailing data is rejected.
      if (frame === undefined || !sawScan || offset !== bytes.length) {
        throw new Error(MALFORMED_ERROR);
      }
      return;
    }
    if (marker === 0x01) {
      continue;
    }

    if (offset + 2 > bytes.length) {
      throw new Error(MALFORMED_ERROR);
    }
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2) {
      throw new Error(MALFORMED_ERROR);
    }
    const payloadStart = offset + 2;
    const payloadLength = segmentLength - 2;
    if (payloadLength > bytes.length - payloadStart) {
      throw new Error(MALFORMED_ERROR);
    }
    offset = payloadStart + payloadLength;

    if (isStartOfFrameMarker(marker)) {
      if (segmentLength < 8) {
        throw new Error(MALFORMED_ERROR);
      }
      const precision = bytes[payloadStart]!;
      const height = view.getUint16(payloadStart + 1, false);
      const width = view.getUint16(payloadStart + 3, false);
      if (precision === 0) {
        throw new Error(MALFORMED_ERROR);
      }
      assertSafeImageGeometry(width, height);
      if (
        frame !== undefined &&
        (frame.precision !== precision || frame.width !== width || frame.height !== height)
      ) {
        throw new Error(MALFORMED_ERROR);
      }
      frame = { precision, width, height };
    } else if (marker === 0xda) {
      if (frame === undefined || segmentLength < 6) {
        throw new Error(MALFORMED_ERROR);
      }
      sawScan = true;
      inEntropy = true;
    }
  }

  throw new Error(MALFORMED_ERROR);
}

function validatePngStructure(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  let sawHeader = false;
  let sawEnd = false;

  while (offset < bytes.length) {
    const remaining = bytes.length - offset;
    if (remaining < 12) {
      throw new Error(MALFORMED_ERROR);
    }

    const dataLength = view.getUint32(offset, false);
    const typeOffset = offset + 4;
    if (dataLength > remaining - 12) {
      throw new Error(MALFORMED_ERROR);
    }

    if (asciiEqualAt(bytes, typeOffset, 'acTL')) {
      throw new Error(ANIMATION_ERROR);
    }

    if (!sawHeader) {
      if (!asciiEqualAt(bytes, typeOffset, 'IHDR') || dataLength !== 13) {
        throw new Error(MALFORMED_ERROR);
      }
      const dataOffset = offset + 8;
      const width = view.getUint32(dataOffset, false);
      const height = view.getUint32(dataOffset + 4, false);
      assertSafeImageGeometry(width, height);
      sawHeader = true;
    } else if (asciiEqualAt(bytes, typeOffset, 'IHDR')) {
      throw new Error(MALFORMED_ERROR);
    }

    const nextOffset = offset + 12 + dataLength;
    if (asciiEqualAt(bytes, typeOffset, 'IEND')) {
      if (dataLength !== 0 || nextOffset !== bytes.length) {
        throw new Error(MALFORMED_ERROR);
      }
      sawEnd = true;
      offset = nextOffset;
      break;
    }
    offset = nextOffset;
  }

  if (!sawHeader || !sawEnd || offset !== bytes.length) {
    throw new Error(MALFORMED_ERROR);
  }
}

interface ImageDimensions {
  width: number;
  height: number;
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function parseVp8Dimensions(
  bytes: Uint8Array,
  dataOffset: number,
  dataLength: number,
  view: DataView,
): ImageDimensions {
  if (
    dataLength < 10 ||
    (bytes[dataOffset]! & 0x01) !== 0 ||
    bytes[dataOffset + 3] !== 0x9d ||
    bytes[dataOffset + 4] !== 0x01 ||
    bytes[dataOffset + 5] !== 0x2a
  ) {
    throw new Error(MALFORMED_ERROR);
  }

  const width = view.getUint16(dataOffset + 6, true) & 0x3fff;
  const height = view.getUint16(dataOffset + 8, true) & 0x3fff;
  assertSafeImageGeometry(width, height);
  return { width, height };
}

function parseVp8lDimensions(
  bytes: Uint8Array,
  dataOffset: number,
  dataLength: number,
  view: DataView,
): ImageDimensions {
  if (dataLength < 5 || bytes[dataOffset] !== 0x2f) {
    throw new Error(MALFORMED_ERROR);
  }

  const packed = view.getUint32(dataOffset + 1, true);
  if (packed >>> 29 !== 0) {
    throw new Error(MALFORMED_ERROR);
  }
  const width = (packed & 0x3fff) + 1;
  const height = ((packed >>> 14) & 0x3fff) + 1;
  assertSafeImageGeometry(width, height);
  return { width, height };
}

function parseVp8xDimensions(
  bytes: Uint8Array,
  dataOffset: number,
  dataLength: number,
): ImageDimensions {
  if (dataLength !== 10) {
    throw new Error(MALFORMED_ERROR);
  }
  const featureFlags = bytes[dataOffset]!;
  if ((featureFlags & 0x02) !== 0) {
    throw new Error(ANIMATION_ERROR);
  }

  const width = readUint24LittleEndian(bytes, dataOffset + 4) + 1;
  const height = readUint24LittleEndian(bytes, dataOffset + 7) + 1;
  assertSafeImageGeometry(width, height);
  return { width, height };
}

function dimensionsEqual(left: ImageDimensions, right: ImageDimensions): boolean {
  return left.width === right.width && left.height === right.height;
}

function validateWebpStructure(bytes: Uint8Array): void {
  if (bytes.length < 12) {
    throw new Error(MALFORMED_ERROR);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffPayloadLength = view.getUint32(4, true);
  if (riffPayloadLength < 4 || riffPayloadLength !== bytes.length - 8) {
    throw new Error(MALFORMED_ERROR);
  }

  let offset = 12;
  let canvasDimensions: ImageDimensions | undefined;
  let imageDimensions: ImageDimensions | undefined;
  while (offset < bytes.length) {
    const remaining = bytes.length - offset;
    if (remaining < 8) {
      throw new Error(MALFORMED_ERROR);
    }

    const dataLength = view.getUint32(offset + 4, true);
    const paddedLength = dataLength + (dataLength & 1);
    if (dataLength > remaining - 8 || paddedLength > remaining - 8) {
      throw new Error(MALFORMED_ERROR);
    }

    if (asciiEqualAt(bytes, offset, 'ANIM') || asciiEqualAt(bytes, offset, 'ANMF')) {
      throw new Error(ANIMATION_ERROR);
    }

    const dataOffset = offset + 8;
    if (asciiEqualAt(bytes, offset, 'VP8X')) {
      if (canvasDimensions !== undefined) {
        throw new Error(MALFORMED_ERROR);
      }
      canvasDimensions = parseVp8xDimensions(bytes, dataOffset, dataLength);
    } else if (asciiEqualAt(bytes, offset, 'VP8 ')) {
      if (imageDimensions !== undefined) {
        throw new Error(MALFORMED_ERROR);
      }
      imageDimensions = parseVp8Dimensions(bytes, dataOffset, dataLength, view);
    } else if (asciiEqualAt(bytes, offset, 'VP8L')) {
      if (imageDimensions !== undefined) {
        throw new Error(MALFORMED_ERROR);
      }
      imageDimensions = parseVp8lDimensions(bytes, dataOffset, dataLength, view);
    }

    offset += 8 + paddedLength;
  }

  if (
    imageDimensions === undefined ||
    offset !== bytes.length ||
    (canvasDimensions !== undefined && !dimensionsEqual(canvasDimensions, imageDimensions))
  ) {
    throw new Error(MALFORMED_ERROR);
  }
}

/** @internal Shared with preprocessing so a File is read only once. */
export function validateImageBytes(bytes: Uint8Array): SupportedImageFormat {
  assertAllowedSize(bytes.byteLength);

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    validateJpegStructure(bytes);
    return 'jpeg';
  }

  if (bytesEqualAt(bytes, 0, PNG_SIGNATURE)) {
    validatePngStructure(bytes);
    return 'png';
  }

  if (asciiEqualAt(bytes, 0, 'RIFF') && asciiEqualAt(bytes, 8, 'WEBP')) {
    validateWebpStructure(bytes);
    return 'webp';
  }

  throw new Error(FORMAT_ERROR);
}

/** @internal Shared with preprocessing so size checks and the byte read stay single-pass. */
export async function readAndValidateImageFile(
  file: File,
): Promise<{ buffer: ArrayBuffer; format: SupportedImageFormat }> {
  assertAllowedSize(file.size);
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength !== file.size) {
    throw new Error(MALFORMED_ERROR);
  }
  return { buffer, format: validateImageBytes(new Uint8Array(buffer)) };
}

export async function validateImageFile(file: File): Promise<SupportedImageFormat> {
  return (await readAndValidateImageFile(file)).format;
}
