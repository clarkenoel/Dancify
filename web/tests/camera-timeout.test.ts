import { afterEach, expect, it, vi } from 'vitest';
import { CameraTracker, INFERENCE_TIMEOUT_MS, type PoseConstructor } from '../src/core/camera';
import { GameSession } from '../src/core/session';
import { chart } from './fixtures';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function setup(initializationStalls = false) {
  vi.useFakeTimers();
  let animation!: FrameRequestCallback;
  let results!: (result: { poseLandmarks: [] }) => void;
  let finish!: () => void;
  const stalled = new Promise<void>(resolve => { finish = resolve; });
  const send = vi.fn().mockResolvedValueOnce(undefined).mockReturnValue(stalled);
  const close = vi.fn(async () => {});
  class Detector {
    setOptions() {}
    onResults(callback: typeof results) { results = callback; }
    initialize() { return initializationStalls ? stalled : Promise.resolve(); }
    send = send; close = close;
  }
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }], getVideoTracks: () => [{ addEventListener: vi.fn() }] };
  const video = { srcObject: null, currentTime: 1, readyState: 2, videoWidth: 640, videoHeight: 480, play: vi.fn(async () => {}) };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }) }) });
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { animation = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const session = new GameSession(chart()); session.play();
  const error = vi.fn((_message: string) => session.pause());
  const sample = vi.fn();
  const tracker = new CameraTracker(video as unknown as HTMLVideoElement, () => ({ time: 1, epoch: session.epoch }), sample, error, async () => Detector as unknown as PoseConstructor);
  const started = tracker.start();
  // Flush startup promises without advancing any safety deadline.
  await vi.advanceTimersByTimeAsync(0);
  return { tracker, started, session, error, sample, stop, video, close, results: () => results({ poseLandmarks: [] }), finish,
    frame: async () => { animation(performance.now()); await vi.advanceTimersByTimeAsync(0); } };
}

it('a stalled inference pauses through the error callback, releases camera and ignores late results', async () => {
  const s = await setup(); await s.started;
  await s.frame(); // Successful warmup.
  await vi.advanceTimersByTimeAsync(100); s.video.currentTime = 2;
  await s.frame(); // Inference promise never settles until explicitly released below.
  const epoch = s.session.epoch;
  await vi.advanceTimersByTimeAsync(INFERENCE_TIMEOUT_MS);
  expect(s.error).toHaveBeenCalledOnce();
  expect(s.error.mock.calls[0][0]).toContain('stopped responding');
  expect(s.session.snapshot().playing).toBe(false);
  expect(s.session.epoch).toBeGreaterThan(epoch);
  expect(s.stop).toHaveBeenCalledOnce(); expect(s.video.srcObject).toBeNull();
  s.results(); s.finish(); await vi.advanceTimersByTimeAsync(0);
  expect(s.sample).not.toHaveBeenCalled(); expect(s.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(10000); expect(s.error).toHaveBeenCalledOnce();
});

it('camera startup cannot hang indefinitely and late initialization cannot revive it', async () => {
  const s = await setup(true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(s.error).toHaveBeenCalledOnce(); expect(s.video.srcObject).toBeNull();
  s.finish(); await s.started; s.results();
  expect(s.sample).not.toHaveBeenCalled();
  expect(requestAnimationFrame).not.toHaveBeenCalled();
});

it('explicit stop cancels timeouts and a replacement tracker starts normally', async () => {
  const s = await setup(); await s.started; await s.frame();
  s.tracker.stop(); await vi.advanceTimersByTimeAsync(60000);
  expect(s.error).not.toHaveBeenCalled();
  const replacement = await setup(); await replacement.started; await replacement.frame();
  replacement.results(); expect(replacement.sample).toHaveBeenCalledOnce();
  replacement.tracker.stop();
});

it('unchanging camera frames trigger recovery even without another animation frame', async () => {
  const s = await setup(); await s.started; await s.frame();
  await vi.advanceTimersByTimeAsync(INFERENCE_TIMEOUT_MS);
  expect(s.error).toHaveBeenCalledOnce(); expect(s.error.mock.calls[0][0]).toContain('frames stopped');
});

it('rejects an overdue result even before a delayed timeout callback runs', async () => {
  const s = await setup(); await s.started; await s.frame();
  await vi.advanceTimersByTimeAsync(100); s.video.currentTime = 2; await s.frame();
  vi.spyOn(performance, 'now').mockReturnValue(performance.now() + INFERENCE_TIMEOUT_MS + 1);
  s.results(); expect(s.sample).not.toHaveBeenCalled(); expect(s.error).toHaveBeenCalledOnce();
  s.finish(); await vi.advanceTimersByTimeAsync(0);
});
