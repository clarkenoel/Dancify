export type { Dance, Move, LandmarkTuple, Judgment } from '../../../schema/type';
import type { Dance, Judgment } from '../../../schema/type';

// Historical records/outbox entries may still contain the removed practice mode.
export type Mode = 'camera' | 'keyboard_practice';
export interface Song {
  id: string; title: string; source_url: string | null;
  status: 'pending' | 'processing' | 'ready' | 'failed'; error_message: string | null;
  has_video: boolean; has_chart: boolean; has_audio: boolean; has_report: boolean;
  active_bundle_id: string | null; active_preparation_job_id: string | null;
  duration: number | null; move_count: number | null; play_count: number;
}
export type PreparationError = 'download_failed' | 'unsupported_media' | 'timing_required' | 'tracking_failed' | 'validation_failed' | 'internal' | 'interrupted';
export interface Preparation {
  id: string; song_id: string; status: 'queued' | 'processing' | 'succeeded' | 'failed';
  stage: string; error_code: PreparationError | null; error_message: string | null;
  result_bundle_id: string | null; has_report: boolean; has_diagnostic: boolean; has_diagnostic_video: boolean;
  source_kind: 'upload' | 'url'; start_time: number | null; end_time: number | null;
}
export interface PreparationOptions { source_kind?: 'url' | 'upload'; start_time?: number; end_time?: number }
export interface Report {
  checkpoint_quality?: { selected: number; retained: number; omitted: number };
  version: '1.0';
  normalization: { coordinate_space: 'mediapipe_image'; aspect_ratio: number; x_z_scaled_by_aspect_ratio: true };
  readiness: { cache_ready_by_default: true; synthetic_timing: false; solo_cfr_mvp: true };
  timing: { source: 'audio'; synthetic: false; bpm: number; beat_times: number[] };
  tracking: { valid_frames: number; total_frames: number; valid_frame_ratio: number; longest_invalid_seconds: number; trailing_invalid_seconds: number };
  cache: { bundle_id: string; song_id: string; source_kind: string; verification?: 'local_preparation' | 'manual_report' };
}
export interface Bundle {
  song: Song; id: string; chart: Dance; report: Report; videoUrl: string; audioUrl: string;
}
export interface PlayInput {
  client_session_id: string; bundle_id: string; player_name: string; mode: Mode;
  score: number; accuracy: number | null; max_combo: number;
  tracking_coverage: number | null; judgments: Record<Judgment, number>; notes: string;
}
export interface Play extends PlayInput { id: string; song_id: string; played_at: string }
