import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/App';

describe('frontend scaffold', () => {
  it('uses the frozen product name', () => {
    expect(APP_NAME).toBe('LingShu Robust AIGC Detector');
  });
});
