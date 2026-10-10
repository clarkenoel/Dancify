import type { LandmarkTuple } from './types';

export const GAMEPLAY_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const TORSO = [11, 12, 23, 24];
const visible = (p: LandmarkTuple | undefined) => p?.length === 4 && p.every(Number.isFinite) && p[3] >= 0.35;
const distance = (a: number[], b: number[]) => Math.hypot(...a.slice(0, 3).map((v, i) => v - b[i]));

export function normalizePose(raw: LandmarkTuple[], width: number, height: number): LandmarkTuple[] | null {
  if (raw.length !== 33 || !Number.isFinite(width / height) || width <= 0 || height <= 0 || !TORSO.every(i => visible(raw[i])) || GAMEPLAY_JOINTS.filter(i => visible(raw[i])).length < 6) return null;
  const aspect = width / height;
  const pose: LandmarkTuple[] = raw.map(p => [p[0] * aspect, p[1], p[2] * aspect, p[3]]);
  const hip = [0, 1, 2].map(i => (pose[23][i] + pose[24][i]) / 2);
  const shoulder = [0, 1, 2].map(i => (pose[11][i] + pose[12][i]) / 2);
  const scale = distance(shoulder, hip);
  if (!Number.isFinite(scale) || scale < 1e-6) return null;
  return pose.map(p => [(p[0] - hip[0]) / scale, (p[1] - hip[1]) / scale, (p[2] - hip[2]) / scale, p[3]]);
}

const vector = (a: LandmarkTuple, b: LandmarkTuple) => [0, 1, 2].map(i => b[i] - a[i]);
const cosine = (a: number[], b: number[]) => {
  const lengths = Math.hypot(...a) * Math.hypot(...b);
  return lengths < 1e-8 ? null : Math.max(-1, Math.min(1, a.reduce((sum, v, i) => sum + v * b[i], 0) / lengths));
};
// Elbow, shoulder, hip and knee angles; arms receive more weight.
const ANGLES = [[11, 13, 15, 2], [12, 14, 16, 2], [23, 11, 13, 2], [24, 12, 14, 2], [11, 23, 25, 1], [12, 24, 26, 1], [23, 25, 27, 1], [24, 26, 28, 1]];
const BONES = [[11, 13, 2], [13, 15, 2], [12, 14, 2], [14, 16, 2], [23, 25, 1], [25, 27, 1], [24, 26, 1], [26, 28, 1]];

export function comparePoses(target: LandmarkTuple[], live: LandmarkTuple[] | null): number | null {
  if (!live || live.length !== 33 || target.length !== 33) return null;
  const mutual = (i: number) => visible(target[i]) && visible(live[i]);
  if (!TORSO.every(mutual) || GAMEPLAY_JOINTS.filter(mutual).length < 6) return null;
  if (!normalizePose(live, 1, 1) || !normalizePose(target, 1, 1)) return null;
  let sum = 0, weights = 0, angleCount = 0, boneCount = 0;
  for (const [a, b, c, weight] of ANGLES) {
    if (![a, b, c].every(mutual)) continue;
    const t = cosine(vector(target[b], target[a]), vector(target[b], target[c]));
    const l = cosine(vector(live[b], live[a]), vector(live[b], live[c]));
    if (t === null || l === null) continue;
    sum += Math.max(0, Math.cos(Math.acos(t) - Math.acos(l))) * weight;
    weights += weight; angleCount++;
  }
  // Directions distinguish raised/lowered straight limbs with identical elbow angles.
  for (const [a, b, weight] of BONES) {
    if (![a, b].every(mutual)) continue;
    const c = cosine(vector(target[a], target[b]), vector(live[a], live[b]));
    if (c === null) continue;
    sum += Math.max(0, c) * weight; weights += weight; boneCount++;
  }
  return angleCount >= 2 && boneCount >= 2 ? sum / weights : null;
}
