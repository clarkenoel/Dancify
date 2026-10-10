import { expect, it, vi } from 'vitest';
import { cameraErrorMessage, cameraFeedback, paintCameraPreview } from '../src/core/cameraPreview';
import type { LandmarkTuple } from '../src/core/types';

const raw = () => Array.from({ length: 33 }, () => [0.25, 0.75, 0, 1] as LandmarkTuple);
it('distinguishes all joints in frame from minimal scoring eligibility', () => {
  const p = raw();
  expect(cameraFeedback(p, true)).toMatchObject({ visible: 12, fullBody: true, comparable: true });
  p[15][0] = 1.2; p[27][3] = 0.1; p[11][1] = NaN;
  expect(cameraFeedback(p, true)).toMatchObject({ visible: 9, fullBody: false, comparable: true });
  expect(cameraFeedback([], false)).toMatchObject({ visible: 0, fullBody: false, comparable: false });
});
it('draws the frozen frame before landmarks using actual image dimensions and suppresses invalid joints', () => {
  const ctx = { clearRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const frame = { width: 640, height: 360 } as HTMLCanvasElement;
  const p = raw(); p[15][0] = NaN;
  paintCameraPreview(canvas, frame, p, true);
  expect(canvas.width).toBe(640); expect(canvas.height).toBe(360);
  expect(ctx.drawImage).toHaveBeenCalledWith(frame, 0, 0);
  expect(ctx.moveTo).toHaveBeenCalledWith(160, 270);
  expect(ctx.arc).toHaveBeenCalledTimes(11);
  expect(ctx.drawImage.mock.invocationCallOrder[0]).toBeLessThan(ctx.moveTo.mock.invocationCallOrder[0]);
  ctx.moveTo.mockClear(); ctx.arc.mockClear();
  paintCameraPreview(canvas, frame, p, false);
  expect(ctx.moveTo).not.toHaveBeenCalled(); expect(ctx.arc).not.toHaveBeenCalled();
});
it('provides recovery instructions for permission, missing-device and busy-camera failures', () => {
  expect(cameraErrorMessage(new DOMException('', 'NotAllowedError'))).toContain('permission was denied');
  expect(cameraErrorMessage(new DOMException('', 'NotFoundError'))).toContain('choose another camera');
  expect(cameraErrorMessage(new DOMException('', 'NotReadableError'))).toContain('Close other apps');
});
