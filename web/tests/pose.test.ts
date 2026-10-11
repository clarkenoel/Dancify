import { describe, expect, it } from 'vitest';
import { comparePoses, normalizePose } from '../src/core/pose';
import { cases, expand, target } from './fixtures';

describe('Python/browser pose contract', () => {
  for (const c of cases) it(`matches the Python ${c.name} vectors`, () => {
    const got = normalizePose(expand(c.default_landmark, c.raw_overrides), c.frame.width, c.frame.height)!;
    const expected = expand(c.expected_default, c.expected_overrides);
    for (let i = 0; i < 33; i++) for (let j = 0; j < 4; j++) expect(got[i][j]).toBeCloseTo(expected[i][j], 6);
  });
  it('compares portrait reference and landscape camera as the same pose', () => {
    const poses = cases.map(c => normalizePose(expand(c.default_landmark, c.raw_overrides), c.frame.width, c.frame.height)!);
    expect(comparePoses(poses[0], poses[1])).toBeCloseTo(1, 6);
  });
  it('returns null for missing torso, low visibility, nonfinite or degenerate geometry', () => {
    const p = target(); p[11][3] = 0.1;
    expect(normalizePose(p, 640, 480)).toBeNull();
    expect(comparePoses(target(), p)).toBeNull();
    const flat = target().map(() => [0, 0, 0, 1] as [number, number, number, number]);
    expect(normalizePose(flat, 640, 480)).toBeNull();
    const bad = target(); bad[23][0] = NaN;
    expect(comparePoses(target(), bad)).toBeNull();
    expect(comparePoses(target(), null)).toBeNull();
  });
  it('distinguishes raising straight arms from lowering them', () => {
    const raised = target();
    for (const i of [13, 14, 15, 16]) raised[i][1] = -2 - (i >= 15 ? 1 : 0);
    expect(comparePoses(target(), raised)).toBeLessThan(0.7);
  });
});

it('rejects collapsed limbs instead of scoring only the remaining geometry', () => {
  const collapsed = target();
  for (const [shoulder, elbow, wrist] of [[11, 13, 15], [12, 14, 16]]) {
    collapsed[elbow] = [...collapsed[shoulder]];
    collapsed[wrist] = [...collapsed[shoulder]];
  }
  expect(comparePoses(target(), collapsed)).toBeNull();
  expect(comparePoses(collapsed, target())).toBeNull();
});
it('never produces a nonfinite similarity from finite but extreme coordinates', () => {
  const huge = target().map(p => [p[0] * 1e160, p[1] * 1e160, p[2] * 1e160, p[3]] as [number, number, number, number]);
  const score = comparePoses(huge, huge);
  expect(score === null || Number.isFinite(score)).toBe(true);
});
