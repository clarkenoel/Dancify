import vectors from '../../pipeline/fixtures/pose-normalization.json';
import type { Dance, LandmarkTuple, Report } from '../src/core/types';

export const cases = vectors.cases;
export function expand(defaultPoint: number[], overrides: Record<string, number[]>): LandmarkTuple[] {
  const points = Array.from({ length: 33 }, () => [...defaultPoint] as LandmarkTuple);
  for (const [index, value] of Object.entries(overrides)) points[Number(index)] = [...value] as LandmarkTuple;
  return points;
}
export const target = () => expand(cases[0].expected_default, cases[0].expected_overrides);
export const chart = (): Dance => ({
  version: '1.0', bpm: 120, duration: 4, beat_times: [0.5, 1, 1.5, 2, 2.5, 3],
  moves: [
    { id: 'm0', start: 1, end: 1.5, keyframe_landmarks: target(), is_hold: false },
    { id: 'm1', start: 2, end: 2.5, keyframe_landmarks: target(), is_hold: false },
  ],
});
export const report = (): Report => ({
  version: '1.0',
  normalization: { coordinate_space: 'mediapipe_image', aspect_ratio: 16 / 9, x_z_scaled_by_aspect_ratio: true },
  readiness: { cache_ready_by_default: true, synthetic_timing: false, solo_cfr_mvp: true },
  timing: { source: 'audio', synthetic: false, bpm: 120, beat_times: chart().beat_times },
  tracking: { valid_frames: 100, total_frames: 100, valid_frame_ratio: 1, longest_invalid_seconds: 0, trailing_invalid_seconds: 0 },
  cache: { song_id: 'song', bundle_id: 'bundle', source_kind: 'upload' },
});
