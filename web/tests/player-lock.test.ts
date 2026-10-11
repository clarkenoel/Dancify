import { expect, it } from 'vitest';
import { PlayerLock, type Candidate, type IdentityFrame } from '../src/core/identity/playerLock';
const candidate = (x = 0.1, identity = 0.1): Candidate => ({ box: { x, y: 0.1, width: 0.25, height: 0.8 }, fullBody: true, face: { descriptor: new Float32Array(128).fill(identity), quality: true } });
const frame = (lock: PlayerLock, capturedAt: number, candidates = [candidate()]): IdentityFrame => ({ generation: lock.snapshot().generation, capturedAt, candidates, faceCount: candidates.filter(c => c.face).length });
function paired() { const lock = new PlayerLock(); expect(lock.pair(frame(lock, 0), 0, true)).toBe(true); return lock; }
it('requires consent, one body, one face, full framing and valid descriptor data', () => {
  const lock = new PlayerLock(); expect(lock.pair(frame(lock, 0), 0, false)).toBe(false);
  expect(lock.pair(frame(lock, 0, [candidate(), candidate(0.6)]), 0, true)).toBe(false);
  expect(lock.pair({ ...frame(lock, 0), faceCount: 2 }, 0, true)).toBe(false);
  const bad = candidate(); bad.fullBody = false; expect(lock.pair(frame(lock, 0, [bad]), 0, true)).toBe(false);
  bad.fullBody = true; bad.face!.descriptor[0] = NaN; expect(lock.pair(frame(lock, 0, [bad]), 0, true)).toBe(false);
  expect(lock.pair(frame(lock, 0), 0, true)).toBe(true);
});
it('keeps the paired track when a spectator is first in detector order', () => {
  const lock = paired(); expect(lock.observe(frame(lock, 100, [candidate(0.65, 0.9), candidate(0.11)]), 100)).toBe(1);
});
it('permits a turned-away face only with unambiguous continuous body tracking', () => {
  const lock = paired(); const turned = candidate(0.12); delete turned.face;
  expect(lock.observe(frame(lock, 100, [turned]), 100)).toBe(0);
  expect(lock.observe(frame(lock, 800, [turned]), 800)).toBeNull();
  expect(lock.snapshot().status).toBe('uncertain');
});
it('crossings pause and overlapping faces cannot be confirmed', () => {
  const lock = paired(); const crossing = frame(lock, 100, [candidate(0.11), candidate(0.12, 0.9)]);
  expect(lock.observe(crossing, 100)).toBeNull(); expect(lock.confirmReturn(crossing, 100)).toBe(false);
});
it('rejects multiple face matches even when only one body continues the previous track', () => {
  const lock = paired(); const ambiguous = frame(lock, 100, [candidate(0.11), candidate(0.65)]);
  expect(lock.observe(ambiguous, 100)).toBeNull();
  expect(lock.snapshot().status).toBe('uncertain');
  expect(lock.confirmReturn(ambiguous, 100)).toBe(false);
});
it('a spectator replacing the player cannot inherit scoring even at the same location', () => {
  const lock = paired(); expect(lock.observe(frame(lock, 100, [candidate(0.1, 0.9)]), 100)).toBeNull();
  expect(lock.observe(frame(lock, 200, [candidate(0.1, 0.9)]), 200)).toBeNull();
});
it('requires explicit confirmation after exit and return and never updates the enrolled face silently', () => {
  const lock = paired(); expect(lock.observe(frame(lock, 100, []), 100)).toBeNull();
  const returned = frame(lock, 200); expect(lock.observe(returned, 200)).toBeNull();
  expect(lock.snapshot().status).toBe('confirm_return'); expect(lock.confirmReturn(returned, 200)).toBe(true);
  expect(lock.observe(frame(lock, 300), 300)).toBe(0);
  expect(lock.pair(frame(lock, 400, [candidate(0.1, 0.9)]), 400, true)).toBe(false);
});
it('rejects stale generations, old/out-of-order/future observations and clears on new session', () => {
  const lock = paired(); const old = frame(lock, 100); lock.suspend();
  expect(lock.observe(old, 100)).toBeNull(); expect(lock.confirmReturn(old, 100)).toBe(false);
  const current = frame(lock, 200); expect(lock.observe(current, 200)).toBeNull(); expect(lock.confirmReturn(current, 200)).toBe(true);
  expect(lock.observe(frame(lock, 150), 200)).toBeNull();
  expect(lock.observe(frame(lock, 3000), 200)).toBeNull();
  expect(lock.observe(frame(lock, 300), 5000)).toBeNull();
  lock.clear(); expect(lock.observe(current, 5000)).toBeNull(); expect(lock.snapshot().status).toBe('unpaired');
});
it('copies enrollment data and never exposes descriptors through snapshots or JSON', () => {
  const lock = new PlayerLock(); const original = candidate(); lock.pair(frame(lock, 0, [original]), 0, true);
  original.face!.descriptor.fill(0.9);
  expect(lock.observe(frame(lock, 100), 100)).toBe(0);
  expect(Object.keys(lock.snapshot()).sort()).toEqual(['generation', 'reason', 'status']);
  expect(JSON.stringify(lock)).not.toMatch(/descriptor|reference|Float32Array/);
});
