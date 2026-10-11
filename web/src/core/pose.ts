import type { LandmarkTuple } from './types';

export const GAMEPLAY_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
export const DEMO_JOINTS = [11, 12, 13, 14, 15, 16];
const TORSO = [11, 12, 23, 24];
const visible = (p: LandmarkTuple | undefined) => p?.length === 4 && p.every(Number.isFinite) && p[3] >= 0.35;
const distance = (a: number[], b: number[]) => Math.hypot(...a.slice(0, 3).map((v, i) => v - b[i]));

export function normalizePose(raw: LandmarkTuple[], width: number, height: number): LandmarkTuple[] | null {
  if (raw.length !== 33 || !Number.isFinite(width / height) || width <= 0 || height <= 0 || !DEMO_JOINTS.every(i => visible(raw[i]))) return null;
  const aspect = width / height;
  const pose: LandmarkTuple[] = raw.map(p => [p[0] * aspect, p[1], p[2] * aspect, p[3]]);
  const shoulder = [0, 1, 2].map(i => (pose[11][i] + pose[12][i]) / 2);
  const torsoVisible = TORSO.every(i => visible(raw[i]));
  const hip = torsoVisible ? [0, 1, 2].map(i => (pose[23][i] + pose[24][i]) / 2) : shoulder;
  const scale = torsoVisible ? distance(shoulder, hip) : distance(pose[11], pose[12]);
  if (!Number.isFinite(scale) || scale < 1e-6) return null;
  return pose.map(p => [(p[0] - hip[0]) / scale, (p[1] - hip[1]) / scale, (p[2] - hip[2]) / scale, p[3]]);
}

const vector = (a: LandmarkTuple, b: LandmarkTuple) => [0, 1, 2].map(i => b[i] - a[i]);
const cosine = (a: number[], b: number[]) => {
  const lengths = Math.hypot(...a) * Math.hypot(...b);
  if (!Number.isFinite(lengths) || lengths < 1e-8) return null;
  const value = a.reduce((sum, v, i) => sum + v * b[i], 0) / lengths;
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : null;
};
// Elbow, shoulder, hip and knee angles; arms receive more weight.
const ANGLES = [[11, 13, 15, 2], [12, 14, 16, 2]];
const BONES = [[11, 13, 2], [13, 15, 2], [12, 14, 2], [14, 16, 2]];

export interface PoseComparison {
  similarity: number | null;
  reason: string;
  matchedJoints: number[];
  components: { kind: 'angle' | 'direction'; joints: number[]; similarity: number; weight: number }[];
}

export function analyzePose(target: LandmarkTuple[], live: LandmarkTuple[] | null): PoseComparison {
  const result: PoseComparison = { similarity: null, reason: 'insufficient_pose_data', matchedJoints: [], components: [] };
  if (!live || live.length !== 33 || target.length !== 33) return result;
  const mutual = (i: number) => visible(target[i]) && visible(live[i]);
  result.matchedJoints = DEMO_JOINTS.filter(mutual);
  // Demo scores both complete arms only; invisible arms never earn points.
  if (result.matchedJoints.length !== DEMO_JOINTS.length) { result.reason = 'incomplete_upper_body'; return result; }
  result.reason = 'invalid_geometry';
  if (!normalizePose(live, 1, 1) || !normalizePose(target, 1, 1)) return result;
  let sum = 0, weights = 0, angleCount = 0, boneCount = 0;
  for (const [a, b, c, weight] of ANGLES) {
    if (![a, b, c].every(mutual)) continue;
    const t = cosine(vector(target[b], target[a]), vector(target[b], target[c]));
    const l = cosine(vector(live[b], live[a]), vector(live[b], live[c]));
    if (t === null || l === null) continue;
    const similarity = Math.max(0, Math.cos(Math.acos(t) - Math.acos(l)));
    result.components.push({ kind: 'angle', joints: [a, b, c], similarity, weight });
    sum += similarity * weight;
    weights += weight; angleCount++;
  }
  // Directions distinguish raised/lowered straight limbs with identical elbow angles.
  for (const [a, b, weight] of BONES) {
    if (![a, b].every(mutual)) continue;
    const c = cosine(vector(target[a], target[b]), vector(live[a], live[b]));
    if (c === null) continue;
    const similarity = Math.max(0, c);
    result.components.push({ kind: 'direction', joints: [a, b], similarity, weight });
    sum += similarity * weight; weights += weight; boneCount++;
  }
  // Every required component must be usable; otherwise collapsed limbs could
  // disappear from the average just like low-confidence limbs did.
  if (angleCount === ANGLES.length && boneCount === BONES.length) { result.similarity = sum / weights; result.reason = 'comparable'; }
  return result;
}

export function comparePoses(target: LandmarkTuple[], live: LandmarkTuple[] | null): number | null {
  return analyzePose(target, live).similarity;
}
