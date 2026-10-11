import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlaybackController } from '../src/core/playback';
import { GameSession } from '../src/core/session';
import { chart, target } from './fixtures';
import { BodyReadiness } from '../src/core/readiness';

class Video extends EventTarget {
  currentTime = 0; duration = 4; readyState = 2; paused = true; seeking = false;
  play = vi.fn(async () => { this.paused = false; this.dispatchEvent(new Event('playing')); });
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() {
  const video = new Video(); const session = new GameSession(chart(), 'camera'); const error = vi.fn();
  const controller = new PlaybackController(video as unknown as HTMLVideoElement, session, vi.fn(), error);
  return { video, session, controller, error };
}
it('counts 3–2–1 before starting video and rejects scoring during the countdown', async () => {
  const { video, session, controller } = setup();
  await controller.replay(); expect(controller.countdown).toBe(3);
  session.sample(1.1, session.epoch, target()); expect(session.snapshot().playing).toBe(false);
  await vi.advanceTimersByTimeAsync(1000); expect(controller.countdown).toBe(2);
  await vi.advanceTimersByTimeAsync(1000); expect(controller.countdown).toBe(1);
  expect(video.play).not.toHaveBeenCalled();
  const countdownEpoch = session.epoch;
  await vi.advanceTimersByTimeAsync(1000); expect(controller.countdown).toBeNull();
  expect(video.play).toHaveBeenCalledTimes(1); expect(session.snapshot().playing).toBe(true);
  expect(session.epoch).toBeGreaterThan(countdownEpoch);
  session.tick(1.1); expect(session.sample(1.1, countdownEpoch, target()).status).toBe('stale_epoch');
  expect(session.snapshot().score).toBe(0); controller.dispose();
});
it('repeated replay does not stack timers and native play cannot bypass the countdown', async () => {
  const { video, session, controller } = setup();
  await controller.replay(); const id = session.snapshot().sessionId;
  await controller.replay(); expect(session.snapshot().sessionId).toBe(id);
  await video.play(); expect(video.paused).toBe(true); expect(session.snapshot().playing).toBe(false);
  video.play.mockClear(); await vi.advanceTimersByTimeAsync(3000);
  expect(video.play).toHaveBeenCalledTimes(1); controller.dispose();
});
it('cancels pending playback on pause, external cancellation, seek, and disposal', async () => {
  for (const action of ['toggle', 'cancel', 'seek', 'dispose']) {
    const { video, controller } = setup(); await controller.replay();
    if (action === 'toggle') await controller.toggle();
    if (action === 'cancel') controller.cancelCountdown();
    if (action === 'seek') { video.currentTime = 2; video.dispatchEvent(new Event('seeking')); }
    if (action === 'dispose') controller.dispose();
    await vi.advanceTimersByTimeAsync(4000); expect(video.play).not.toHaveBeenCalled();
    expect(controller.countdown).toBeNull(); controller.dispose();
  }
});
it('surfaces autoplay rejection without leaving a running countdown', async () => {
  const { video, controller, error } = setup(); video.play.mockRejectedValue(new Error('Playback blocked'));
  await controller.replay(); await vi.advanceTimersByTimeAsync(3000);
  expect(error).toHaveBeenCalledWith('Playback blocked'); expect(controller.countdown).toBeNull(); controller.dispose();
});
it('requires readiness on camera start and cancels countdown when readiness is lost', async () => {
  const video = new Video(); const session = new GameSession(chart(), 'camera'); const error = vi.fn();
  let ready = false;
  const controller = new PlaybackController(video as unknown as HTMLVideoElement, session, vi.fn(), error, () => ready, true);
  await controller.toggle(); expect(controller.countdown).toBeNull(); expect(video.play).not.toHaveBeenCalled();
  ready = true; await video.play(); expect(video.paused).toBe(true); // Native play cannot bypass confirmation.
  video.play.mockClear(); await controller.toggle(); expect(controller.countdown).toBe(3);
  ready = false; await vi.advanceTimersByTimeAsync(1000);
  expect(controller.countdown).toBeNull(); expect(video.play).not.toHaveBeenCalled();
  ready = true; await controller.toggle(); await vi.advanceTimersByTimeAsync(3000);
  expect(video.paused).toBe(false); controller.dispose();
});

function automaticSetup() {
  const video = new Video(); const session = new GameSession(chart(), 'camera');
  const readiness = new BodyReadiness(); const error = vi.fn();
  const controller = new PlaybackController(video as unknown as HTMLVideoElement, session, vi.fn(), error, () => readiness.isReady(Date.now()), true);
  const observe = (fullBody = true) => { readiness.update(fullBody, Date.now()); controller.observeReadiness(); };
  return { video, session, controller, readiness, error, observe };
}
it('automatically counts down after stable full-body tracking, without repeated starts', async () => {
  const { video, controller, observe } = automaticSetup();
  observe(); await vi.advanceTimersByTimeAsync(500); observe(); expect(controller.countdown).toBeNull();
  await vi.advanceTimersByTimeAsync(500); observe(); expect(controller.countdown).toBe(3);
  for (const count of [2, 1]) { await vi.advanceTimersByTimeAsync(1000); observe(); expect(controller.countdown).toBe(count); }
  expect(video.play).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000); observe();
  expect(video.play).toHaveBeenCalledTimes(1); expect(video.paused).toBe(false);
  observe(); expect(controller.countdown).toBeNull(); controller.dispose();
});
it('restarts the entire automatic countdown after lost framing becomes stable again', async () => {
  const { video, controller, observe } = automaticSetup();
  observe(); await vi.advanceTimersByTimeAsync(1000); observe();
  await vi.advanceTimersByTimeAsync(1000); observe(false);
  expect(controller.countdown).toBeNull(); expect(controller.waitingForBody).toBe(true);
  await vi.advanceTimersByTimeAsync(4000); expect(video.play).not.toHaveBeenCalled();
  observe(); await vi.advanceTimersByTimeAsync(1000); observe();
  expect(controller.countdown).toBe(3); controller.dispose();
});
it('manual cancellation, safety cancellation and completed rounds do not auto-restart', async () => {
  for (const action of ['manual', 'safety', 'ended']) {
    const { video, session, controller, observe } = automaticSetup();
    if (action === 'manual') { observe(); await vi.advanceTimersByTimeAsync(1000); observe(); await controller.toggle(); }
    if (action === 'safety') controller.cancelCountdown();
    if (action === 'ended') session.finish();
    for (let i = 0; i < 5; i++) { observe(); await vi.advanceTimersByTimeAsync(1000); }
    expect(video.play).not.toHaveBeenCalled(); expect(controller.countdown).toBeNull(); controller.dispose();
  }
});
it('camera replay waits for readiness and blocked autoplay does not retry in a loop', async () => {
  const { video, controller, observe, error } = automaticSetup();
  controller.cancelCountdown(); await controller.replay();
  expect(controller.waitingForBody).toBe(true); expect(error).not.toHaveBeenCalled();
  video.play.mockRejectedValue(new Error('Playback blocked'));
  for (let i = 0; i < 8; i++) { observe(); await vi.advanceTimersByTimeAsync(1000); }
  expect(video.play).toHaveBeenCalledTimes(1); expect(error).toHaveBeenCalledWith('Playback blocked');
  expect(controller.waitingForBody).toBe(false); controller.dispose();
});
it('keyboard practice never auto-starts from readiness observations', async () => {
  const video = new Video(); const session = new GameSession(chart(), 'keyboard_practice');
  const controller = new PlaybackController(video as unknown as HTMLVideoElement, session, vi.fn(), vi.fn());
  controller.observeReadiness(); await vi.advanceTimersByTimeAsync(5000);
  expect(video.play).not.toHaveBeenCalled(); controller.dispose();
});
