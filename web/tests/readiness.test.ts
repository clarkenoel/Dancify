import { expect, it } from 'vitest';
import { BodyReadiness } from '../src/core/readiness';
it('requires continuous full-body observations and resets after loss, long gaps or shutdown', () => {
  const readiness = new BodyReadiness();
  expect(readiness.update(true, 0)).toBe(false);
  expect(readiness.update(true, 500)).toBe(false);
  expect(readiness.update(true, 1000)).toBe(true);
  expect(readiness.update(false, 1100)).toBe(false);
  expect(readiness.update(true, 1200)).toBe(false);
  expect(readiness.update(true, 4500)).toBe(false);
  expect(readiness.update(true, 5000)).toBe(false);
  expect(readiness.update(true, 5500)).toBe(true);
  readiness.reset(); expect(readiness.ready).toBe(false);
});
