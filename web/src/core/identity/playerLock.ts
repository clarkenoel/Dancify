/** Model-independent, memory-only identity gate. Not wired to the current single-person camera. */
export interface BodyBox { x: number; y: number; width: number; height: number }
export interface Candidate {
  box: BodyBox;
  fullBody: boolean;
  /** Supplied only after the runtime has uniquely associated one good-quality face. */
  face?: { descriptor: Float32Array; quality: boolean };
}
export interface IdentityFrame {
  generation: number;
  /** Monotonic capture timestamp, independent of reference-video time. */
  capturedAt: number;
  faceCount: number;
  candidates: Candidate[];
}
export type LockStatus = 'unpaired' | 'tracking' | 'uncertain' | 'confirm_return';
export interface LockSnapshot { generation: number; status: LockStatus; reason: string }
export const IDENTITY_DEFAULTS = Object.freeze({ descriptorLength: 128, maxFaceDistance: 0.45, continuityGapMs: 500, minBoxOverlap: 0.35, maxObservationAgeMs: 1000 });
const validBox = (b: BodyBox) => [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 && b.x + b.width <= 1.001 && b.y + b.height <= 1.001;
const overlap = (a: BodyBox, b: BodyBox) => {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / (a.width * a.height + b.width * b.height - intersection);
};

/** Descriptors never enter snapshots, errors, JSON, movement logs, or result payloads. */
export class PlayerLock {
  #reference: Float32Array | null = null;
  #box: BodyBox | null = null;
  #lastAccepted = -Infinity;
  #lastFrame = -Infinity;
  #status: LockStatus = 'unpaired';
  #reason = 'Pair while alone with your body and face visible.';
  #generation = 0;
  constructor(private readonly settings = IDENTITY_DEFAULTS) {}
  snapshot(): LockSnapshot { return { generation: this.#generation, status: this.#status, reason: this.#reason }; }
  toJSON() { return this.snapshot(); }
  private goodFace(candidate: Candidate) {
    const face = candidate.face;
    return !!face?.quality && face.descriptor.length === this.settings.descriptorLength && face.descriptor.every(Number.isFinite) && Math.hypot(...face.descriptor) > 1e-6;
  }
  private matches(candidate: Candidate) {
    if (!this.#reference || !this.goodFace(candidate)) return false;
    const descriptor = candidate.face!.descriptor;
    const distance = Math.hypot(...descriptor.map((value, i) => value - this.#reference![i]));
    return distance <= this.settings.maxFaceDistance;
  }
  private fresh(frame: IdentityFrame, now: number) {
    return frame.generation === this.#generation && Number.isFinite(frame.capturedAt) && Number.isFinite(now)
      && frame.capturedAt <= now && now - frame.capturedAt <= this.settings.maxObservationAgeMs
      && frame.capturedAt >= this.#lastFrame;
  }
  private accept(candidate: Candidate, capturedAt: number) {
    this.#box = { ...candidate.box }; this.#lastAccepted = capturedAt;
    this.#status = 'tracking'; this.#reason = 'Paired player tracked.';
  }
  clear(reason = 'Pair while alone with your body and face visible.') {
    // Release only app-owned references. JavaScript cannot promise secure memory erasure.
    this.#reference = null; this.#box = null; this.#lastAccepted = this.#lastFrame = -Infinity;
    this.#generation++; this.#status = 'unpaired'; this.#reason = reason;
  }
  suspend(reason = 'Confirm the paired player before resuming.') {
    // Invalidates in-flight frames while retaining this session's enrolled reference.
    this.#generation++; this.#box = null; this.#lastAccepted = this.#lastFrame = -Infinity;
    this.#status = this.#reference ? 'uncertain' : 'unpaired'; this.#reason = reason;
  }
  pair(frame: IdentityFrame, now: number, consent: boolean): boolean {
    // Re-pairing requires the caller to start a fresh run and clear the old lock first.
    if (this.#reference || !consent || !this.fresh(frame, now) || frame.candidates.length !== 1 || frame.faceCount !== 1) return false;
    const candidate = frame.candidates[0];
    if (!validBox(candidate.box) || !candidate.fullBody || !this.goodFace(candidate)) return false;
    this.#reference = new Float32Array(candidate.face!.descriptor);
    this.#lastFrame = frame.capturedAt; this.accept(candidate, frame.capturedAt); return true;
  }
  /** Returns a candidate index only when permitted to score. Never chooses by array order. */
  observe(frame: IdentityFrame, now: number): number | null {
    if (!this.fresh(frame, now)) return null;
    this.#lastFrame = frame.capturedAt;
    if (!this.#reference) return null;
    const valid = frame.candidates.map((candidate, index) => ({ candidate, index })).filter(({ candidate }) => validBox(candidate.box));
    if (valid.length !== frame.candidates.length) { this.#status = 'uncertain'; this.#reason = 'Invalid candidate geometry.'; return null; }
    const matching = valid.filter(({ candidate }) => candidate.fullBody && this.matches(candidate));
    if (matching.length > 1) { this.#status = 'uncertain'; this.#reason = 'Multiple candidates match the paired player.'; return null; }
    if (this.#status === 'tracking' && this.#box && frame.capturedAt - this.#lastAccepted <= this.settings.continuityGapMs) {
      const nearby = valid.filter(({ candidate }) => overlap(this.#box!, candidate.box) >= this.settings.minBoxOverlap);
      // Crossing/overlapping candidates are ambiguous even if one visible face matches.
      if (nearby.length === 1) {
        const { candidate, index } = nearby[0];
        if (!this.goodFace(candidate) || this.matches(candidate)) {
          this.accept(candidate, frame.capturedAt); return index;
        }
      }
    }
    this.#status = matching.length === 1 ? 'confirm_return' : 'uncertain';
    this.#reason = matching.length === 1 ? 'Possible paired player found. Confirm before resuming.' : 'Player identity uncertain. Playback must pause.';
    return null;
  }
  confirmReturn(frame: IdentityFrame, now: number): boolean {
    if (this.#status !== 'confirm_return' || !this.fresh(frame, now)) return false;
    // Re-evaluate current evidence; a stale UI confirmation cannot select an old candidate.
    const matching = frame.candidates.filter(candidate => validBox(candidate.box) && candidate.fullBody && this.matches(candidate));
    if (matching.length !== 1 || frame.candidates.some(candidate => !validBox(candidate.box))) return false;
    const chosen = matching[0];
    if (frame.candidates.some(candidate => candidate !== chosen && overlap(chosen.box, candidate.box) >= this.settings.minBoxOverlap)) return false;
    this.#lastFrame = frame.capturedAt; this.accept(chosen, frame.capturedAt); return true;
  }
}
