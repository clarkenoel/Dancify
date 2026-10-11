import { expect, it } from 'vitest';
import fixture from '../../pipeline/fixtures/scorable-targets.json';
import { chart, target } from './fixtures';
import { analyzePose } from '../src/core/pose';
import { validateChart } from '../src/core/validation';
import type { LandmarkTuple } from '../src/core/types';

it.each(fixture.cases)('agrees with Python/API on $name', example => {
  const pose = target();
  for (const [index, value] of Object.entries(example.overrides)) pose[Number(index)] = value as LandmarkTuple;
  expect(analyzePose(pose, pose).similarity !== null).toBe(example.expected);
  const document = chart(); document.moves[0].keyframe_landmarks = pose;
  if (example.expected) expect(() => validateChart(document)).not.toThrow();
  else expect(() => validateChart(document)).toThrow(/Prepare this song again/);
});
