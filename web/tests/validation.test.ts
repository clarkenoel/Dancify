import { expect, it } from 'vitest';
import { validateChart, validateReport } from '../src/core/validation';
import { chart, report } from './fixtures';

it('accepts the current prepared bundle contract', () => {
  expect(validateChart(chart())).toEqual(chart());
  expect(validateReport(report(), chart(), 'song', 'bundle')).toEqual(report());
});
it.each(['overlap', 'duplicate', 'hold', 'nonfinite', 'beats'])('rejects %s charts', kind => {
  const c = chart();
  if (kind === 'overlap') c.moves[1].start = 1.4;
  if (kind === 'duplicate') c.moves[1].id = 'm0';
  if (kind === 'hold') c.moves[0].is_hold = true;
  if (kind === 'nonfinite') c.moves[0].keyframe_landmarks[11][0] = Infinity;
  if (kind === 'beats') c.beat_times.reverse();
  expect(() => validateChart(c)).toThrow();
});
it('rejects legacy normalization, synthetic timing and mixed bundle IDs', () => {
  const r = report();
  expect(() => validateReport({ ...r, normalization: undefined }, chart(), 'song', 'bundle')).toThrow();
  expect(() => validateReport({ ...r, timing: { ...r.timing, synthetic: true } }, chart(), 'song', 'bundle')).toThrow();
  expect(() => validateReport(r, chart(), 'song', 'new-bundle')).toThrow('identity');
});
