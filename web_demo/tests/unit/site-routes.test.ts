import { describe, expect, it } from 'vitest';

import { routeFromHash } from '../../src/site/routes';

describe('site hash routing', () => {
  it('defaults unknown and empty hashes to detector', () => {
    expect(routeFromHash('')).toBe('detector');
    expect(routeFromHash('#/unknown')).toBe('detector');
  });

  it.each([
    ['#/detector', 'detector'],
    ['#/technology', 'technology'],
    ['#/results', 'results'],
    ['#/errors', 'errors'],
    ['#/about', 'about'],
  ] as const)('maps %s to %s', (hash, route) => {
    expect(routeFromHash(hash)).toBe(route);
  });

  it('keeps the former team hash as an About compatibility alias', () => {
    expect(routeFromHash('#/team')).toBe('about');
  });

  it('ignores query and secondary fragment suffixes', () => {
    expect(routeFromHash('#/results?source=judge')).toBe('results');
    expect(routeFromHash('#/technology#pipeline')).toBe('technology');
  });
});
