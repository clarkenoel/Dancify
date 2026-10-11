import { expect, it } from 'vitest';
import { MovementLog, MAX_MOVEMENT_SAMPLES } from '../src/core/movementLog';
import { GameSession } from '../src/core/session';
import { analyzePose, GAMEPLAY_JOINTS } from '../src/core/pose';
import { chart, target } from './fixtures';

it('never awards a partial-body perfect when unmatched arms are invisible', () => {
  const raised = target();
  for (const i of [13, 14, 15, 16]) raised[i][1] = -2 - (i >= 15 ? 1 : 0);
  const still = target();
  expect(analyzePose(raised, still).similarity).toBeLessThan(0.7);
  for (const i of [13, 14, 15, 16]) still[i][3] = 0;
  expect(analyzePose(raised, still)).toMatchObject({ similarity: null, reason: 'incomplete_body' });
  const dance = chart(); dance.moves.forEach(m => { m.keyframe_landmarks = raised; });
  const s = new GameSession(dance, 'camera'); s.play();
  for (const time of [1.1, 2.1]) { s.tick(time); s.sample(time, s.epoch, still); }
  s.finish(); expect(s.snapshot().score).toBe(0); expect(s.snapshot().judgments.LOST).toBe(2);
});
it('retains legitimate still matches with timestamp evidence and clears on replay', () => {
  const s = new GameSession(chart(), 'camera'); s.play(); s.tick(1.1);
  s.sample(1.1, s.epoch, target(), { raw: target(), inferenceMs: 12 });
  s.tick(1.2); s.sample(1.2, s.epoch, target()); s.finish();
  expect(s.snapshot().results[0]).toMatchObject({ judgment: 'PERFECT', bestSampleTime: 1.1, source: 'camera' });
  expect(s.movementLog.latest?.movementDelta).toBe(0);
  const log = s.diagnostics('bundle');
  expect(log.samples[0].normalizedBody.map(j => j.index)).toEqual(GAMEPLAY_JOINTS);
  expect(log.samples[0].imageBody.map(j => j.index)).toEqual(GAMEPLAY_JOINTS);
  expect(log.targets[0].body.map(j => j.index)).toEqual(GAMEPLAY_JOINTS);
  expect(log.samples[0].decision.comparison?.components.length).toBeGreaterThan(0);
  const id = s.snapshot().sessionId; s.reset();
  expect(s.movementLog.count).toBe(0); expect(s.snapshot().sessionId).not.toBe(id);
  s.sample(1.2, s.epoch - 1, target()); expect(s.movementLog.count).toBe(0);
});
it('bounds memory chronologically, copies body data, and honors disabled recording', () => {
  const log = new MovementLog(); const pose = target();
  for (let i = 0; i < MAX_MOVEMENT_SAMPLES + 3; i++) log.record(i / 15, i / 15, 0, pose, { status: 'outside_window', checkpointId: null, comparison: null });
  expect(log.count).toBe(MAX_MOVEMENT_SAMPLES); expect(log.dropped).toBe(3);
  expect(log.list()[0].capturedAt).toBe(3 / 15);
  expect(log.latest?.capturedAt).toBe((MAX_MOVEMENT_SAMPLES + 2) / 15);
  const old = log.latest!.normalizedBody[0].point![0]; pose[11][0] = 999;
  expect(log.latest!.normalizedBody[0].point![0]).toBe(old);
  log.setEnabled(false); log.clear(); log.record(1, 1, 0, pose, { status: 'paused', checkpointId: null, comparison: null });
  expect(log.count).toBe(0);
});
