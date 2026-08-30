import { describe, expect, it } from 'vitest';

import {
  appendRecentDetection,
  calculateThumbnailPlacement,
  type RecentDetection,
} from '../../src/site/session-history';

function item(id: string): RecentDetection {
  return {
    id,
    thumbnailUrl: `data:image/jpeg;base64,${id}`,
    fileName: `${id}.png`,
    label: 'AIGC',
    confidence: 0.9,
  };
}

describe('recent detection history', () => {
  it('keeps earlier successful detections when a new result arrives', () => {
    expect(
      appendRecentDetection([item('one')], item('two')).map(({ id }) => id),
    ).toEqual(['two', 'one']);
  });

  it('keeps only the three newest unique detections', () => {
    const history = ['one', 'two', 'three', 'four'].reduce<
      readonly RecentDetection[]
    >((current, id) => appendRecentDetection(current, item(id)), []);

    expect(history.map(({ id }) => id)).toEqual(['four', 'three', 'two']);
  });

  it('does not duplicate the same completed result', () => {
    expect(appendRecentDetection([item('one')], item('one'))).toHaveLength(1);
  });

  it('contains wide and tall images inside the fixed recent-image slot', () => {
    expect(calculateThumbnailPlacement(400, 200)).toEqual({
      x: 0,
      y: 10,
      width: 160,
      height: 80,
    });
    expect(calculateThumbnailPlacement(100, 200)).toEqual({
      x: 55,
      y: 0,
      width: 50,
      height: 100,
    });
  });
});
