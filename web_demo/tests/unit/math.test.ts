import { describe, expect, it } from 'vitest';

import { classifyProbability, sigmoid } from '../../src/runtime/math';

describe('sigmoid', () => {
  it('is numerically stable for extreme negative, zero, and extreme positive logits', () => {
    expect(sigmoid(-1000)).toBe(0);
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(1000)).toBe(1);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects the non-finite logit %s',
    (logit) => {
      expect(() => sigmoid(logit)).toThrow(/finite logit/i);
    },
  );
});

describe('classifyProbability', () => {
  it('uses the frozen inclusive AIGC threshold exactly', () => {
    expect(classifyProbability(0.55657112)).toBe('Real');
    expect(classifyProbability(0.55657113)).toBe('AIGC');
    expect(classifyProbability(0.55657114)).toBe('AIGC');
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -Number.EPSILON,
    1 + Number.EPSILON,
  ])('rejects the invalid probability %s', (probability) => {
    expect(() => classifyProbability(probability)).toThrow(/probability.*\[0, 1\]/i);
  });
});
