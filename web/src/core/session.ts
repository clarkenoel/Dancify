import type { Dance, Judgment, LandmarkTuple, PlayInput } from './types';
import { analyzePose } from './pose';
import { MovementLog, bodyOnly, type SampleDecision } from './movementLog';

export const SCORING_VERSION = 'checkpoint-v2-full-body-provisional';
export const THRESHOLDS = { PERFECT: 0.94, SUPER: 0.85, GOOD: 0.7 };
const points = { PERFECT: 1000, SUPER: 700, GOOD: 400, MISS: 0, LOST: 0 };
export interface MoveResult { id: string; judgment: Judgment; similarity: number | null; bestSampleTime: number | null; source: 'camera' }
export interface SessionSnapshot {
  sessionId: string; mode: 'camera'; time: number; duration: number; playing: boolean; ended: boolean; epoch: number;
  score: number; combo: number; maxCombo: number; accuracy: number | null; coverage: number | null;
  results: MoveResult[]; activeId: string | null; upcomingIds: string[]; seeked: boolean;
  judgments: Record<Judgment, number>;
}
export function judge(score: number): Judgment {
  if (score >= THRESHOLDS.PERFECT) return 'PERFECT';
  if (score >= THRESHOLDS.SUPER) return 'SUPER';
  if (score >= THRESHOLDS.GOOD) return 'GOOD';
  return 'MISS';
}

export class GameSession {
  epoch = 0;
  readonly movementLog = new MovementLog();
  private bestTimes = new Map<string, number>();
  private time = 0;
  private playing = false;
  private ended = false;
  private seeked = false;
  private best = new Map<string, number>();
  private results = new Map<string, MoveResult>();
  private skipped = new Set<string>();
  private combo = 0;
  private maxCombo = 0;
  private sessionId = crypto.randomUUID();
  readonly mode = 'camera' as const;
  constructor(readonly chart: Dance) {}
  play() { if (!this.ended) this.playing = true; }
  pause() { this.playing = false; this.epoch++; }
  reset() {
    this.epoch++; this.time = 0; this.playing = false; this.ended = false; this.seeked = false;
    this.movementLog.clear(); this.bestTimes.clear();
    this.best.clear(); this.results.clear(); this.skipped.clear(); this.combo = this.maxCombo = 0;
    this.sessionId = crypto.randomUUID();
  }
  seek(time: number) {
    this.reset(); this.seeked = true;
    this.time = Math.max(0, Math.min(this.chart.duration, time));
    // A seek starts an unrecordable practice segment; skipped moves aren't misses.
    for (const move of this.chart.moves) if (move.start < this.time) this.skipped.add(move.id);
  }
  private finalize(id: string) {
    const similarity = this.best.get(id) ?? null;
    const judgment: Judgment = similarity === null ? 'LOST' : judge(similarity);
    this.results.set(id, { id, judgment, similarity, bestSampleTime: this.bestTimes.get(id) ?? null, source: this.mode });
    this.combo = ['PERFECT', 'SUPER', 'GOOD'].includes(judgment) ? this.combo + 1 : 0;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
  }
  tick(time: number) {
    if (!this.playing || !Number.isFinite(time)) return;
    if (time + 0.05 < this.time) { this.seek(time); return; }
    this.time = Math.min(time, this.chart.duration);
    for (const move of this.chart.moves) {
      if (move.end <= this.time && !this.results.has(move.id) && !this.skipped.has(move.id)) this.finalize(move.id);
    }
  }
  sample(capturedAt: number, epoch: number, pose: LandmarkTuple[] | null, metadata?: { raw?: LandmarkTuple[]; inferenceMs?: number }) {
    const move = this.chart.moves.find(m => capturedAt >= m.start && capturedAt < m.end);
    const decision: SampleDecision = { status: 'accepted', checkpointId: move?.id ?? null, comparison: null };
    if (!this.playing) decision.status = 'paused';
    else if (epoch !== this.epoch) decision.status = 'stale_epoch';
    else if (!Number.isFinite(capturedAt) || capturedAt > this.time + 0.05) decision.status = 'future_sample';
    else if (!move) decision.status = 'outside_window';
    else if (this.results.has(move.id) || this.skipped.has(move.id) || this.time >= move.end) decision.status = 'closed_window';
    else {
      decision.comparison = analyzePose(move.keyframe_landmarks, pose);
      const similarity = decision.comparison.similarity;
      if (similarity === null) decision.status = 'insufficient_pose';
      else if (!this.best.has(move.id) || similarity > this.best.get(move.id)!) {
        this.best.set(move.id, similarity); this.bestTimes.set(move.id, capturedAt);
      }
    }
    // Do not retain late frames from a previous run in the new run's log.
    if (epoch === this.epoch && !this.ended) {
      this.movementLog.record(capturedAt, this.time, epoch, pose, decision, metadata?.raw, metadata?.inferenceMs);
    }
    return decision;
  }
  finish() {
    if (this.ended) return;
    this.playing = true; this.tick(this.chart.duration); this.playing = false; this.ended = true; this.epoch++;
  }
  snapshot(): SessionSnapshot {
    const results = [...this.results.values()];
    const judgments: Record<Judgment, number> = { PERFECT: 0, SUPER: 0, GOOD: 0, MISS: 0, LOST: 0 };
    let sum = 0, comparable = 0, score = 0;
    for (const r of results) {
      judgments[r.judgment]++; score += points[r.judgment];
      if (r.similarity !== null) { comparable++; sum += r.similarity; }
    }
    return {
      sessionId: this.sessionId, mode: this.mode, time: this.time, duration: this.chart.duration, playing: this.playing, ended: this.ended, epoch: this.epoch,
      results, judgments, score, combo: this.combo, maxCombo: this.maxCombo,
      // Lost tracking remains LOST, but cannot inflate accuracy by shrinking its denominator.
      accuracy: comparable ? sum / Math.max(1, results.length) : null,
      coverage: results.length ? comparable / results.length : null,
      activeId: this.chart.moves.find(m => this.time >= m.start && this.time < m.end)?.id ?? null,
      upcomingIds: this.chart.moves.filter(m => m.end > this.time).slice(0, 4).map(m => m.id),
      seeked: this.seeked,
    };
  }
  diagnostics(bundleId: string) {
    return { version: 'movement-log-v1', bundleId, sessionId: this.sessionId, mode: this.mode,
      scoringVersion: SCORING_VERSION, thresholds: THRESHOLDS, snapshot: this.snapshot(),
      recording: this.movementLog.enabled, droppedSamples: this.movementLog.dropped,
      coordinates: 'Image body: unmirrored normalized image coordinates. Normalized body: aspect-corrected, hip-centered, torso-scaled. Only joints 11–16 and 23–28; no face or video.',
      movementDelta: 'Mean normalized 3D joint displacement between consecutive comparable captures within 0.5s and the same epoch. Not a score or calibrated activity threshold.',
      targets: this.chart.moves.map(m => ({ id: m.id, start: m.start, end: m.end, body: bodyOnly(m.keyframe_landmarks) })),
      samples: this.movementLog.list(),
    };
  }
  result(bundleId: string, playerName: string): PlayInput {
    if (!this.ended || this.seeked) throw new Error('Replay from the beginning before saving a complete result.');
    const s = this.snapshot();
    return {
      client_session_id: this.sessionId, bundle_id: bundleId, player_name: playerName.trim() || 'anonymous', mode: this.mode,
      score: s.score, accuracy: s.accuracy, max_combo: s.maxCombo, tracking_coverage: s.coverage, judgments: s.judgments,
      notes: JSON.stringify({ scoring_version: SCORING_VERSION, pose_runtime: '@mediapipe/pose@0.5.1675469404', thresholds: THRESHOLDS, accuracy_includes_lost: true }),
    };
  }
}
