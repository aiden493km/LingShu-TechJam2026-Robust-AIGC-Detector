import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

import { shouldAnimateRouteClick } from '../../src/site/RouteLink';

describe('animated route links', () => {
  it('animates an ordinary primary-button navigation', () => {
    expect(shouldAnimateRouteClick({ button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toBe(true);
  });

  it('preserves modified, non-primary, and already-handled clicks', () => {
    const base = { button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    expect(shouldAnimateRouteClick({ ...base, button: 1 })).toBe(false);
    expect(shouldAnimateRouteClick({ ...base, ctrlKey: true })).toBe(false);
    expect(shouldAnimateRouteClick({ ...base, defaultPrevented: true })).toBe(false);
  });

  it('commits the route synchronously inside the view-transition update callback', async () => {
    const source = await readFile(new URL('../../src/site/RouteLink.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('requestAnimationFrame');
    expect(source).toContain('flushSync');
    expect(source).toContain('history.pushState');
  });
});
