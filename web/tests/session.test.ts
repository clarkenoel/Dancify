import { expect, it } from 'vitest';
import { GameSession } from '../src/core/session';
import { chart, target } from './fixtures';

it('judges the best valid comparison once per half-open window', () => {
  const s = new GameSession(chart(), 'camera'); s.play(); s.tick(1.1);
  s.sample(1.1, s.epoch, target()); s.tick(1.5);
  s.sample(1.4, s.epoch, target()); s.tick(1.8); s.finish(); s.finish();
  expect(s.snapshot().judgments).toEqual({ PERFECT: 1, SUPER: 0, GOOD: 0, MISS: 0, LOST: 1 });
  expect(s.snapshot().score).toBe(1000);
  expect(s.snapshot().coverage).toBe(0.5);
  expect(s.snapshot().accuracy).toBeCloseTo(0.5);
});
it('does not score paused samples or inference from before a pause', () => {
  const s = new GameSession(chart(), 'camera'); s.play(); s.tick(1.1); const epoch = s.epoch;
  s.pause(); s.tick(1.6); s.sample(1.1, epoch, target());
  expect(s.snapshot().results).toHaveLength(0);
  s.play(); s.sample(1.1, epoch, target()); s.tick(1.6);
  expect(s.snapshot().results[0].judgment).toBe('LOST');
});
it('discarded late inference never retroactively scores a closed checkpoint', () => {
  const s = new GameSession(chart(), 'camera'); s.play(); s.tick(1.6); s.sample(1.4, s.epoch, target());
  expect(s.snapshot().results[0].judgment).toBe('LOST');
});
it('keyboard input never contributes to camera scores', () => {
  const s = new GameSession(chart(), 'camera'); s.play(); s.tick(1.1); s.keyboardHit(); s.finish();
  expect(s.snapshot().score).toBe(0);
  expect(s.snapshot().accuracy).toBeNull();
});
it('practice hits work without a camera and each checkpoint scores once', () => {
  const s = new GameSession(chart(), 'keyboard_practice'); s.play(); s.tick(1.1); s.keyboardHit(); s.keyboardHit(); s.finish();
  expect(s.snapshot().score).toBe(1000);
  expect(s.snapshot().judgments.MISS).toBe(1);
  expect(s.result('b', 'Ada').mode).toBe('keyboard_practice');
});
it('seeking creates an unrecordable segment, replay resets all scores and identity', () => {
  const s = new GameSession(chart(), 'keyboard_practice'); s.play(); s.tick(1.1); s.keyboardHit(); s.finish();
  const old = s.result('b', 'Ada').client_session_id;
  s.seek(1.8); s.play(); s.tick(2.1); s.keyboardHit(); s.finish();
  expect(() => s.result('b', 'Ada')).toThrow('Replay');
  s.reset(); s.play(); s.finish();
  expect(s.result('b', 'Ada').client_session_id).not.toBe(old);
  expect(s.snapshot().score).toBe(0);
  expect(s.snapshot().results).toHaveLength(2);
});
