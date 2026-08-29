export type SupportedImageFormat = 'jpeg' | 'png' | 'webp';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
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
      if (view.getUint32(dataOffset, false) === 0 || view.getUint32(dataOffset + 4, false) === 0) {
        throw new Error(MALFORMED_ERROR);
      }
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
  let sawChunk = false;
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

    if (asciiEqualAt(bytes, offset, 'VP8X')) {
      if (dataLength !== 10) {
        throw new Error(MALFORMED_ERROR);
      }
      const featureFlags = bytes[offset + 8];
      if (featureFlags === undefined || (featureFlags & 0x02) !== 0) {
        throw new Error(ANIMATION_ERROR);
      }
    }

    sawChunk = true;
    offset += 8 + paddedLength;
  }

  if (!sawChunk || offset !== bytes.length) {
    throw new Error(MALFORMED_ERROR);
  }
}

/** @internal Shared with preprocessing so a File is read only once. */
export function validateImageBytes(bytes: Uint8Array): SupportedImageFormat {
  assertAllowedSize(bytes.byteLength);

  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
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
