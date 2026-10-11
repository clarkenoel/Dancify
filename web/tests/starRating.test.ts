import { describe, expect, it } from 'vitest';
import { starRating } from '../src/core/starRating';

describe('completed-round star presentation', () => {
  it.each([[0, 0], [0.1999, 0], [0.20, 1], [0.3499, 1], [0.35, 2], [0.4999, 2], [0.50, 3], [0.6499, 3], [0.65, 4], [0.8499, 4], [0.85, 5], [1, 5]])('rates accuracy %s as %s stars', (accuracy, stars) => {
    expect(starRating(accuracy, true, false)).toBe(stars);
  });
  it('does not rate missing tracking, incomplete or seeked rounds, or invalid data', () => {
    expect(starRating(null, true, false)).toBeNull();
    expect(starRating(1, false, false)).toBeNull();
    expect(starRating(1, true, true)).toBeNull();
    for (const accuracy of [NaN, Infinity, -0.1, 1.1]) expect(starRating(accuracy, true, false)).toBeNull();
  });
});
