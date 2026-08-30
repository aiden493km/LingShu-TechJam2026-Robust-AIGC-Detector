function bytesEqualAt(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
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

function readExifTiffOrientation(
  bytes: Uint8Array,
  view: DataView,
  payloadStart: number,
  segmentEnd: number,
): number {
  if (!bytesEqualAt(bytes, payloadStart, [0x45, 0x78, 0x69, 0x66, 0, 0])) {
    return 1;
  }

  const tiffStart = payloadStart + 6;
  if (tiffStart + 8 > segmentEnd) {
    return 1;
  }

  const littleEndian =
    bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49
      ? true
      : bytes[tiffStart] === 0x4d && bytes[tiffStart + 1] === 0x4d
        ? false
        : undefined;
  if (littleEndian === undefined || view.getUint16(tiffStart + 2, littleEndian) !== 42) {
    return 1;
  }

  const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
  if (ifdOffset < 8 || ifdOffset > segmentEnd - tiffStart - 2) {
    return 1;
  }

  const ifdStart = tiffStart + ifdOffset;
  const entryCount = view.getUint16(ifdStart, littleEndian);
  const entriesStart = ifdStart + 2;
  const availableForEntriesAndNextIfd = segmentEnd - entriesStart;
  if (availableForEntriesAndNextIfd < 4) {
    return 1;
  }
  if (entryCount > Math.floor((availableForEntriesAndNextIfd - 4) / 12)) {
    return 1;
  }

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = entriesStart + index * 12;
    if (view.getUint16(entryOffset, littleEndian) !== 0x0112) {
      continue;
    }

    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    if (type !== 3 || count !== 1) {
      return 1;
    }

    const orientation = view.getUint16(entryOffset + 8, littleEndian);
    return orientation >= 1 && orientation <= 8 ? orientation : 1;
  }

  return 1;
}

export function readJpegOrientation(buffer: ArrayBuffer): number {
  try {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return 1;
    }

    const view = new DataView(buffer);
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        return 1;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) {
        offset += 1;
      }
      if (offset >= bytes.length) {
        return 1;
      }

      const marker = bytes[offset];
      offset += 1;
      if (marker === undefined || marker === 0x00) {
        return 1;
      }
      if (marker === 0xd9 || marker === 0xda) {
        return 1;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }

      if (offset + 2 > bytes.length) {
        return 1;
      }
      const segmentLength = view.getUint16(offset, false);
      if (segmentLength < 2) {
        return 1;
      }

      const payloadStart = offset + 2;
      const payloadLength = segmentLength - 2;
      if (payloadLength > bytes.length - payloadStart) {
        return 1;
      }
      const segmentEnd = payloadStart + payloadLength;

      if (
        marker === 0xe1 &&
        bytesEqualAt(bytes, payloadStart, [0x45, 0x78, 0x69, 0x66, 0, 0])
      ) {
        return readExifTiffOrientation(bytes, view, payloadStart, segmentEnd);
      }
      offset = segmentEnd;
    }
  } catch {
    return 1;
  }

  return 1;
}

function normalizeOrientation(orientation: number): number {
  return Number.isInteger(orientation) && orientation >= 1 && orientation <= 8
    ? orientation
    : 1;
}

export function applyExifOrientation(image: ImageData, orientation: number): ImageData {
  const normalized = normalizeOrientation(orientation);
  const swapsDimensions = normalized >= 5;
  const outputWidth = swapsDimensions ? image.height : image.width;
  const outputHeight = swapsDimensions ? image.width : image.height;
  const output = new Uint8ClampedArray(image.data.length);

  for (let sourceY = 0; sourceY < image.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < image.width; sourceX += 1) {
      let destinationX = sourceX;
      let destinationY = sourceY;

      switch (normalized) {
        case 2:
          destinationX = image.width - 1 - sourceX;
          break;
        case 3:
          destinationX = image.width - 1 - sourceX;
          destinationY = image.height - 1 - sourceY;
          break;
        case 4:
          destinationY = image.height - 1 - sourceY;
          break;
        case 5:
          destinationX = sourceY;
          destinationY = sourceX;
          break;
        case 6:
          destinationX = image.height - 1 - sourceY;
          destinationY = sourceX;
          break;
        case 7:
          destinationX = image.height - 1 - sourceY;
          destinationY = image.width - 1 - sourceX;
          break;
        case 8:
          destinationX = sourceY;
          destinationY = image.width - 1 - sourceX;
          break;
      }

      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const destinationOffset = (destinationY * outputWidth + destinationX) * 4;
      output.set(image.data.subarray(sourceOffset, sourceOffset + 4), destinationOffset);
    }
  }

  return new ImageData(output, outputWidth, outputHeight);
}
