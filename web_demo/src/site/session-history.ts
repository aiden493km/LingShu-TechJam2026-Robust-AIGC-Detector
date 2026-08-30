const THUMBNAIL_WIDTH = 160;
const THUMBNAIL_HEIGHT = 100;

export interface RecentDetection {
  readonly id: string;
  readonly thumbnailUrl: string;
  readonly fileName: string;
  readonly label: DetectionLabel;
  readonly confidence: number;
}

export interface ThumbnailPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function appendRecentDetection(
  history: readonly RecentDetection[],
  next: RecentDetection,
): readonly RecentDetection[] {
  return [next, ...history.filter(({ id }) => id !== next.id)].slice(0, 3);
}

export function calculateThumbnailPlacement(
  sourceWidth: number,
  sourceHeight: number,
): ThumbnailPlacement {
  const scale = Math.min(
    THUMBNAIL_WIDTH / sourceWidth,
    THUMBNAIL_HEIGHT / sourceHeight,
  );
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  return {
    x: Math.round((THUMBNAIL_WIDTH - width) / 2),
    y: Math.round((THUMBNAIL_HEIGHT - height) / 2),
    width,
    height,
  };
}

export async function createRecentThumbnail(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = THUMBNAIL_WIDTH;
    canvas.height = THUMBNAIL_HEIGHT;
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('The browser could not create a thumbnail canvas.');
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    const placement = calculateThumbnailPlacement(bitmap.width, bitmap.height);
    context.drawImage(
      bitmap,
      placement.x,
      placement.y,
      placement.width,
      placement.height,
    );
    return canvas.toDataURL('image/jpeg', 0.78);
  } finally {
    bitmap.close();
  }
}
import type { DetectionLabel } from '../runtime/math';
