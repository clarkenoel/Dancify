import type { Pose } from '@mediapipe/pose';
import type { LandmarkTuple } from './types';
import { normalizePose } from './pose';

export interface CaptureStamp { time: number; epoch: number }
export interface PoseSample extends CaptureStamp { pose: LandmarkTuple[] | null; raw: LandmarkTuple[]; inferenceMs: number; frame: HTMLCanvasElement }
export type PoseConstructor = new (config: { locateFile: (name: string) => string }) => Pose;
export const INFERENCE_TIMEOUT_MS = 2500;
const WARMUP_TIMEOUT_MS = 30000;
let runtime: Promise<PoseConstructor> | null = null;

function loadRuntime(): Promise<PoseConstructor> {
  if (runtime) return runtime;
  runtime = new Promise<PoseConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${import.meta.env.BASE_URL}mediapipe/pose.js`;
    script.onload = () => {
      const Constructor = (window as unknown as { Pose?: PoseConstructor }).Pose;
      if (Constructor) resolve(Constructor); else { script.remove(); reject(new Error('Local pose runtime is missing. Run npm run setup:models.')); }
    };
    script.onerror = () => { script.remove(); reject(new Error('Local pose runtime is missing. Run npm run setup:models.')); };
    document.head.append(script);
  }).catch(error => { runtime = null; throw error; });
  return runtime;
}

/** All assets and camera frames remain local. One inference runs at a time. */
export class CameraTracker {
  private detector?: Pose;
  private stream?: MediaStream;
  private frame = 0;
  private stopped = false;
  private lastFrame = -1;
  private lastInference = -Infinity;
  private operation: Promise<void> | null = null;
  private canvas = document.createElement('canvas');
  private stamp: CaptureStamp = { time: 0, epoch: -1 };
  private startedAt = 0;
  private lastProgress = 0;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private deadline = Infinity;
  private timeoutMessage = '';
  private warmed = false;
  private armTimeout(ms: number, message: string) {
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.deadline = performance.now() + ms; this.timeoutMessage = message;
    this.watchdog = setTimeout(() => this.fail(message), ms);
  }
  private fail(message: string) {
    if (this.stopped) return;
    this.stop(); this.onError(message);
  }
  private expired() {
    if (performance.now() < this.deadline) return false;
    this.fail(this.timeoutMessage); return true;
  }
  constructor(private video: HTMLVideoElement, private capture: () => CaptureStamp, private onPose: (sample: PoseSample) => void, private onError: (message: string) => void, private runtimeLoader = loadRuntime) {}
  async start(deviceId?: string) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires localhost or HTTPS. Keyboard practice is available.');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }), width: { ideal: 640 }, height: { ideal: 480 } } });
      if (this.stopped) { this.stop(); return; }
      this.stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => { if (!this.stopped) { this.stop(); this.onError('Camera disconnected. Reconnect it or switch to keyboard practice.'); } }));
      this.armTimeout(60000, 'Camera model startup timed out. Enable the camera again or use keyboard practice.');
      this.video.srcObject = this.stream; await this.video.play();
      const Constructor = await this.runtimeLoader();
      if (this.stopped || this.expired()) return;
      const detector = new Constructor({ locateFile: name => `${import.meta.env.BASE_URL}mediapipe/${name}` });
      this.detector = detector;
      detector.setOptions({ selfieMode: false, modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      detector.onResults(result => {
        if (this.stopped || this.expired()) return;
        const raw: LandmarkTuple[] = (result.poseLandmarks ?? []).map(p => [p.x, p.y, p.z, p.visibility ?? 0]);
        this.onPose({ ...this.stamp, raw, pose: normalizePose(raw, this.canvas.width, this.canvas.height), inferenceMs: performance.now() - this.startedAt, frame: this.canvas });
      });
      this.operation = detector.initialize(); await this.operation; this.operation = null;
      if (this.stopped || this.expired()) return;
      this.armTimeout(WARMUP_TIMEOUT_MS, 'Camera tracking startup timed out. Enable the camera again or use keyboard practice.');
      this.lastProgress = performance.now();
      this.frame = requestAnimationFrame(this.loop);
    } catch (error) { this.stop(); throw error; }
  }
  private loop = (now: number) => {
    if (this.stopped) return;
    if (now - this.lastProgress > 2500) { this.stop(); this.onError('Camera frames stopped arriving. Enable the camera again or choose another device.'); return; }
    if (!this.detector || this.video.readyState < 2 || this.video.currentTime === this.lastFrame || now - this.lastInference < 1000 / 15) {
      this.frame = requestAnimationFrame(this.loop); return;
    }
    this.lastFrame = this.video.currentTime; this.lastInference = now; this.lastProgress = now;
    this.canvas.width = this.video.videoWidth; this.canvas.height = this.video.videoHeight;
    this.stamp = this.capture(); this.startedAt = performance.now();
    this.canvas.getContext('2d')!.drawImage(this.video, 0, 0);
    // Freeze the webcam frame until inference completes. `now` is solely the
    // model's monotonic timestamp; stamp.time comes from the reference video.
    this.armTimeout(this.warmed ? INFERENCE_TIMEOUT_MS : WARMUP_TIMEOUT_MS,
      'Body tracking stopped responding. The round is paused. Enable the camera again or use keyboard practice.');
    try { this.operation = this.detector.send({ image: this.canvas }, now); }
    catch (error) { this.fail(error instanceof Error ? error.message : 'Pose tracking failed'); return; }
    void this.operation.then(() => {
      this.operation = null;
      if (this.stopped || this.expired()) return;
      this.warmed = true; this.lastProgress = performance.now();
      this.armTimeout(INFERENCE_TIMEOUT_MS, 'Camera frames stopped arriving. Enable the camera again or choose another device.');
      if (!this.stopped) this.frame = requestAnimationFrame(this.loop);
    }).catch(error => { if (!this.stopped) { this.stop(); this.onError(error instanceof Error ? error.message : 'Pose tracking failed'); } });
  };
  stop() {
    this.stopped = true; cancelAnimationFrame(this.frame);
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.stream?.getTracks().forEach(track => track.stop());
    if (this.video.srcObject === this.stream) this.video.srcObject = null;
    // Discard the frozen camera pixels when this tracker is closed.
    this.canvas.width = this.canvas.height = 0;
    const detector = this.detector; this.detector = undefined;
    if (detector) void Promise.resolve(this.operation).catch(() => {}).then(() => detector.close()).catch(() => {});
  }
}
