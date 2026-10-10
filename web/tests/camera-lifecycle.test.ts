import { afterEach, expect, it, vi } from 'vitest';
import { CameraTracker } from '../src/core/camera';

afterEach(() => vi.unstubAllGlobals());
it('stops a late permission result without clearing a replacement camera stream', async () => {
  let resolve!: (stream: MediaStream) => void;
  const pending = new Promise<MediaStream>(r => { resolve = r; });
  const getUserMedia = vi.fn(() => pending);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('document', { createElement: () => ({ width: 640, height: 480 }) });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const replacement = {} as MediaStream;
  const video = { srcObject: replacement, play: vi.fn() } as unknown as HTMLVideoElement;
  const onPose = vi.fn();
  const tracker = new CameraTracker(video, () => ({ time: 3, epoch: 1 }), onPose, vi.fn());
  const start = tracker.start('selected-device');
  tracker.stop();
  const stop = vi.fn();
  resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await start;
  expect(stop).toHaveBeenCalledTimes(1);
  expect(video.srcObject).toBe(replacement);
  expect(video.play).not.toHaveBeenCalled(); expect(onPose).not.toHaveBeenCalled();
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ deviceId: { exact: 'selected-device' } }) }));
});
