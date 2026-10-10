/**
 * Mirror of dance.schema.json.
 * If the schema changes, this file changes in the same commit.
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** MediaPipe pose landmark as [x, y, z, visibility]. */
export type LandmarkTuple = [number, number, number, number];

export interface Move {
  id: string;
  start: number;
  end: number;
  /** 33 landmarks, normalized to hip-center origin, torso-length scale. */
  keyframe_landmarks: LandmarkTuple[];
  is_hold: boolean;
}

export interface Dance {
  version: "1.0";
  bpm: number;
  beat_times: number[];
  duration: number;
  moves: Move[];
}

export type Judgment = "PERFECT" | "SUPER" | "GOOD" | "MISS" | "LOST";

export interface PoseComparisonResult {
  score: number;
  judgment: Judgment;
}