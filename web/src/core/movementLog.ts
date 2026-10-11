import type { LandmarkTuple } from './types';
import { GAMEPLAY_JOINTS, type PoseComparison } from './pose';

export const MAX_MOVEMENT_SAMPLES = 6000;
export const bodyOnly = (pose: LandmarkTuple[] | null | undefined) => GAMEPLAY_JOINTS.map(index => ({ index,
  point: pose?.[index]?.every(Number.isFinite) ? [...pose[index]] as LandmarkTuple : null,
}));
export interface SampleDecision {
  status: 'accepted' | 'wrong_mode' | 'paused' | 'stale_epoch' | 'future_sample' | 'outside_window' | 'closed_window' | 'insufficient_pose';
  checkpointId: string | null;
  comparison: PoseComparison | null;
}
export interface MovementEntry {
  capturedAt: number; receivedAt: number; epoch: number; inferenceMs: number | null;
  decision: SampleDecision;
  normalizedBody: ReturnType<typeof bodyOnly>; imageBody: ReturnType<typeof bodyOnly>;
  movementDelta: number | null;
}

/** Bounded, session-only body diagnostics. Never store frames or facial landmarks. */
export class MovementLog {
  enabled = true;
  private entries: MovementEntry[] = [];
  private next = 0;
  dropped = 0;
  private previous: { time: number; epoch: number; body: ReturnType<typeof bodyOnly> } | null = null;
  clear() { this.entries = []; this.next = 0; this.dropped = 0; this.previous = null; }
  setEnabled(value: boolean) { this.enabled = value; if (!value) this.previous = null; }
  get count() { return this.entries.length; }
  get latest() { return this.entries.length ? this.entries[(this.next + this.entries.length - 1) % this.entries.length] : null; }
  list() { return this.entries.length < MAX_MOVEMENT_SAMPLES ? [...this.entries] : [...this.entries.slice(this.next), ...this.entries.slice(0, this.next)]; }
  record(capturedAt: number, receivedAt: number, epoch: number, pose: LandmarkTuple[] | null, decision: SampleDecision, raw?: LandmarkTuple[], inferenceMs?: number) {
    if (!this.enabled) return;
    const normalizedBody = bodyOnly(pose);
    let movementDelta: number | null = null;
    if (this.previous && this.previous.epoch === epoch && capturedAt > this.previous.time && capturedAt - this.previous.time <= 0.5) {
      const distances = normalizedBody.flatMap((joint, i) => {
        const a = joint.point, b = this.previous!.body[i].point;
        return a && b && a[3] >= 0.35 && b[3] >= 0.35 ? [Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2])] : [];
      });
      if (distances.length >= 6) movementDelta = distances.reduce((a, b) => a + b, 0) / distances.length;
    }
    this.previous = pose ? { time: capturedAt, epoch, body: normalizedBody } : null;
    const entry: MovementEntry = { capturedAt, receivedAt, epoch, inferenceMs: inferenceMs ?? null, decision, normalizedBody, imageBody: bodyOnly(raw), movementDelta };
    if (this.entries.length < MAX_MOVEMENT_SAMPLES) this.entries.push(entry);
    else { this.entries[this.next] = entry; this.dropped++; }
    this.next = this.entries.length < MAX_MOVEMENT_SAMPLES ? this.entries.length : (this.next + 1) % MAX_MOVEMENT_SAMPLES;
  }
}
