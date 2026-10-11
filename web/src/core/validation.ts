import type { Dance, Report, LandmarkTuple } from './types';
import { analyzePose } from './pose';

export class CompatibilityError extends Error {}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CompatibilityError(message);
}
function object(value: unknown): Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
  return value as Record<string, unknown>;
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function validateChart(value: unknown): Dance {
  const chart = object(value);
  requireValue(chart.version === '1.0', 'Unsupported chart version');
  requireValue(finite(chart.duration) && chart.duration > 0, 'Invalid chart duration');
  requireValue(finite(chart.bpm) && chart.bpm > 0, 'Invalid chart BPM');
  requireValue(Array.isArray(chart.beat_times) && chart.beat_times.length > 0, 'Missing beat grid');
  let previous = -1;
  for (const beat of chart.beat_times) {
    requireValue(finite(beat) && beat >= 0 && beat <= chart.duration && beat > previous, 'Invalid beat order');
    previous = beat;
  }
  requireValue(Array.isArray(chart.moves) && chart.moves.length > 0, 'Missing checkpoints');
  const ids = new Set<string>();
  let previousEnd = 0;
  for (const raw of chart.moves) {
    const move = object(raw);
    requireValue(typeof move.id === 'string' && move.id.trim() && !ids.has(move.id), 'Duplicate or missing checkpoint ID');
    ids.add(move.id);
    requireValue(finite(move.start) && finite(move.end) && move.start >= previousEnd && move.end > move.start && move.end <= chart.duration, 'Overlapping or invalid checkpoint windows');
    previousEnd = move.end;
    requireValue(move.is_hold === false, 'Hold checkpoints are not supported yet');
    requireValue(Array.isArray(move.keyframe_landmarks) && move.keyframe_landmarks.length === 33, 'Expected 33 landmarks');
    const pose = move.keyframe_landmarks;
    for (const p of pose) requireValue(Array.isArray(p) && p.length === 4 && p.every(finite) && p[3] >= 0 && p[3] <= 1, 'Invalid landmark');
    requireValue(analyzePose(pose as LandmarkTuple[], pose as LandmarkTuple[]).similarity !== null,
      `Checkpoint ${move.id} cannot be scored: all 12 body joints and usable limb geometry are required. Prepare this song again with the current pipeline or choose a clearer clip.`);
  }
  return chart as unknown as Dance;
}

export function validateReport(value: unknown, chart: Dance, songId: string, bundleId: string): Report {
  const r = object(value);
  const upgrade = 'This chart needs preparation with the current pipeline before playing.';
  requireValue(r.version === '1.0' && r.status !== 'failed', upgrade);
  requireValue(r.normalization && typeof r.normalization === 'object', upgrade);
  const normalization = object(r.normalization);
  requireValue(normalization.coordinate_space === 'mediapipe_image' && normalization.x_z_scaled_by_aspect_ratio === true && finite(normalization.aspect_ratio) && normalization.aspect_ratio > 0, upgrade);
  const readiness = object(r.readiness);
  requireValue(readiness.cache_ready_by_default === true && readiness.synthetic_timing === false && readiness.solo_cfr_mvp === true, 'This preparation did not pass gameplay checks.');
  const timing = object(r.timing);
  requireValue(timing.source === 'audio' && timing.synthetic === false && finite(timing.bpm) && Math.abs(timing.bpm - chart.bpm) <= 0.001, 'Chart and audio timing disagree');
  requireValue(Array.isArray(timing.beat_times) && timing.beat_times.length === chart.beat_times.length && timing.beat_times.every((b, i) => finite(b) && Math.abs(b - chart.beat_times[i]) <= 0.00011), 'Chart and report beat grids disagree');
  const tracking = object(r.tracking);
  const valid = tracking.valid_frames, total = tracking.total_frames, ratio = tracking.valid_frame_ratio;
  requireValue(finite(valid) && Number.isInteger(valid) && finite(total) && Number.isInteger(total) && valid > 0 && valid <= total, 'Invalid tracking counts');
  requireValue(finite(ratio) && ratio >= 0.5 && ratio <= 1 && Math.abs(ratio - valid / total) < 0.0001, 'Unusable tracking coverage');
  for (const name of ['longest_invalid_seconds', 'trailing_invalid_seconds']) requireValue(finite(tracking[name]) && tracking[name] >= 0 && tracking[name] <= 2.000001, 'Reference tracking is unstable');
  if (r.checkpoint_quality !== undefined) {
    const q = object(r.checkpoint_quality);
    requireValue([q.selected, q.retained, q.omitted].every(v => finite(v) && Number.isSafeInteger(v) && v >= 0), 'Invalid checkpoint counts');
    requireValue(q.retained === chart.moves.length && (q.selected as number) === (q.retained as number) + (q.omitted as number), 'Checkpoint counts disagree with chart');
  }
  const cache = object(r.cache);
  requireValue(cache.song_id === songId && cache.bundle_id === bundleId, 'Bundle identity changed while loading');
  return r as unknown as Report;
}
