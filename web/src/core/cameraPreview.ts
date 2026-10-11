import type { LandmarkTuple } from './types';
import { GAMEPLAY_JOINTS, DEMO_JOINTS } from './pose';

export const BODY_EDGES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
export const inFrame = (p: LandmarkTuple | undefined) => !!p && p.every(Number.isFinite) && p[3] >= 0.35 && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1;

export function cameraFeedback(raw: LandmarkTuple[], comparable: boolean) {
  const visible = GAMEPLAY_JOINTS.filter(i => inFrame(raw[i])).length;
  const fullBody = visible === GAMEPLAY_JOINTS.length;
  const upperBody = DEMO_JOINTS.every(i => inFrame(raw[i]));
  return { visible, fullBody, upperBody, comparable, guidance: upperBody
    ? 'Upper body in view. Legs are optional for this demo.'
    : 'Keep shoulders, elbows and wrists in view for scoring. You can press Start at any time.' };
}

/** Draw the skeleton on the exact frozen frame used by inference. Mirroring is presentation-only. */
export function paintCameraPreview(canvas: HTMLCanvasElement, frame: HTMLCanvasElement, raw: LandmarkTuple[], skeleton: boolean) {
  if (canvas.width !== frame.width) canvas.width = frame.width;
  if (canvas.height !== frame.height) canvas.height = frame.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  const w = canvas.width, h = canvas.height;
  context.clearRect(0, 0, w, h);
  context.drawImage(frame, 0, 0);
  if (!skeleton) return;
  // High-contrast diagnostic lines, not the pending Figma visual design.
  for (const [color, width] of [['black', 6], ['white', 3]] as const) {
    context.strokeStyle = color; context.lineWidth = width; context.lineCap = 'round';
    context.beginPath();
    for (const [a, b] of BODY_EDGES) {
      if (!inFrame(raw[a]) || !inFrame(raw[b])) continue;
      context.moveTo(raw[a][0] * w, raw[a][1] * h); context.lineTo(raw[b][0] * w, raw[b][1] * h);
    }
    context.stroke();
  }
  for (const i of GAMEPLAY_JOINTS) {
    if (!inFrame(raw[i])) continue;
    context.beginPath(); context.arc(raw[i][0] * w, raw[i][1] * h, 4, 0, Math.PI * 2);
    context.fillStyle = 'white'; context.fill(); context.strokeStyle = 'black'; context.lineWidth = 1; context.stroke();
  }
}

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was denied. Allow camera access in your browser site settings, then try again. You can still start the dance; camera scoring resumes when tracking is available.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'The selected camera is unavailable. Refresh the camera list and choose another camera.';
  if (name === 'NotReadableError') return 'The camera could not be opened. Close other apps using it, then try again.';
  return error instanceof Error ? error.message : 'Camera access failed. Check camera access and try again.';
}
