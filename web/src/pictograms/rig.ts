import sourceRig from '../../../assets/pictograms/rig.json';
import lennySprites from '../assets/pictograms/lenny/sprites.json';
import humanSprites from '../assets/pictograms/human/sprites.json';
export type Character = 'lenny' | 'human';
const manifests = { lenny: lennySprites, human: humanSprites };
import type { LandmarkTuple } from '../core/types';
import { GAMEPLAY_JOINTS } from '../core/pose';

// Artwork/pivots: https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-24
// Source-side names are viewer-relative. MediaPipe indices are anatomical.
// Preserve chart x/y exactly; the mirrored webcam preview does not mirror targets.
export const segments = [
  ['leftUpperArm', 'leftForearm', 12, 14], ['leftForearm', 'leftHand', 14, 16],
  ['rightUpperArm', 'rightForearm', 11, 13], ['rightForearm', 'rightHand', 13, 15],
  ['leftUpperLeg', 'leftLowerLeg', 24, 26], ['leftLowerLeg', 'leftFoot', 26, 28],
  ['rightUpperLeg', 'rightLowerLeg', 23, 25], ['rightLowerLeg', 'rightFoot', 25, 27],
] as const;
export type Part = keyof typeof lennySprites;
export type Point = readonly number[];
export type Matrix = [number, number, number, number, number, number];
export const bonesFor = (character: Character) => Object.fromEntries(sourceRig.characters[character].bones.map(b => [b.id, b]));
export const bones = bonesFor('lenny');
export const sprite = (id: Part, character: Character = 'lenny') => Object.values(bonesFor(character)[id].variants)[0]!;
export const transform = (m: Matrix, p: Point): [number, number] => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const midpoint = (a: Point, b: Point) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const length = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Map both source endpoints exactly, preserving a torso-scaled limb thickness. */
export function segmentMatrix(a: Point, b: Point, start: Point, end: Point, thickness: number): Matrix | null {
  const sourceLength = length(a, b), targetLength = length(start, end);
  if (![sourceLength, targetLength, thickness].every(n => Number.isFinite(n) && n > 1e-6)) return null;
  const u = [(b[0] - a[0]) / sourceLength, (b[1] - a[1]) / sourceLength];
  const v = [(end[0] - start[0]) / targetLength, (end[1] - start[1]) / targetLength];
  const scale = targetLength / sourceLength;
  const m: Matrix = [scale * v[0] * u[0] + thickness * v[1] * u[1],
    scale * v[1] * u[0] - thickness * v[0] * u[1],
    scale * v[0] * u[1] - thickness * v[1] * u[0],
    scale * v[1] * u[1] + thickness * v[0] * u[0], 0, 0];
  m[4] = start[0] - m[0] * a[0] - m[2] * a[1];
  m[5] = start[1] - m[1] * a[0] - m[3] * a[1];
  return m;
}

// Stable painter order avoids flickering from noisy chart z values.
const layers: Part[] = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
  'body', 'head', 'leftUpperArm', 'leftForearm', 'leftHand', 'rightUpperArm', 'rightForearm', 'rightHand'];
export interface PictogramLayout { parts: { id: Part; matrix: Matrix; crop: number[] }[]; viewBox: string }

/** Presentation only. Never modifies or normalizes the already-normalized chart. */
export function layoutPictogram(pose: LandmarkTuple[], character: Character = 'lenny'): PictogramLayout | null {
  if (pose.length !== 33 || !GAMEPLAY_JOINTS.every(i => pose[i]?.every(Number.isFinite) && pose[i][3] >= 0.35)) return null;
  const bones = bonesFor(character), sprites = manifests[character];
  const partSprite = (id: Part) => sprite(id, character);
  const hips = midpoint(pose[23], pose[24]), shoulders = midpoint(pose[11], pose[12]);
  const sourceShoulders = midpoint(bones.leftUpperArm.attachment, bones.rightUpperArm.attachment);
  const sourceHips = midpoint(bones.leftUpperLeg.attachment, bones.rightUpperLeg.attachment);
  const bodyScale = length(hips, shoulders) / length(sourceHips, sourceShoulders);
  const widthScale = length(pose[11], pose[12]) / length(bones.leftUpperArm.attachment, bones.rightUpperArm.attachment);
  const body = segmentMatrix(sourceHips, sourceShoulders, hips, shoulders, widthScale);
  if (!body) return null;
  const matrices = new Map<Part, Matrix>([['body', body]]);
  for (const [id, child, a, b] of segments) {
    const m = segmentMatrix(partSprite(id).pivot, bones[child].attachment, pose[a], pose[b], bodyScale);
    if (!m) return null; // Foreshortened/collapsed 2D segments retain the skeleton fallback.
    matrices.set(id, m);
  }
  // Head, hands and feet are decorative. No facial/gesture claim is inferred.
  for (const [id, parent] of [['head', 'body'], ['leftHand', 'leftForearm'], ['rightHand', 'rightForearm'],
    ['leftFoot', 'leftLowerLeg'], ['rightFoot', 'rightLowerLeg']] as const) {
    const parentMatrix = matrices.get(parent)!;
    const attachment = transform(parentMatrix, bones[id].attachment);
    // Preserve neutral orientation relative to parent, but don't stretch end pieces.
    const sourceAxis = parent === 'body' ? sourceShoulders : bones[id].attachment;
    const sourceStart = parent === 'body' ? sourceHips : partSprite(parent).pivot;
    const targetStart = transform(parentMatrix, sourceStart), targetEnd = transform(parentMatrix, sourceAxis);
    const rotation = Math.atan2(targetEnd[1] - targetStart[1], targetEnd[0] - targetStart[0])
      - Math.atan2(sourceAxis[1] - sourceStart[1], sourceAxis[0] - sourceStart[0]);
    const a = bodyScale * Math.cos(rotation), b = bodyScale * Math.sin(rotation), [px, py] = partSprite(id).pivot;
    matrices.set(id, [a, b, -b, a, attachment[0] - a * px + b * py, attachment[1] - b * px - a * py]);
  }
  const parts = layers.map(id => ({ id, matrix: matrices.get(id)!, crop: sprites[id].crop }));
  const corners = parts.flatMap(({ matrix, crop: [x0, y0, x1, y1] }) =>
    [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(p => transform(matrix, p)));
  const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
  const x = Math.min(...xs) - 0.1, y = Math.min(...ys) - 0.1;
  return { parts, viewBox: `${x} ${y} ${Math.max(...xs) - x + 0.1} ${Math.max(...ys) - y + 0.1}` };
}

const urls = import.meta.glob('../assets/pictograms/*/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const spriteUrl = (id: Part, character: Character = 'lenny') => urls[`../assets/pictograms/${character}/${id}.png`];
const pending = new Map<Character, Promise<void>>();
/** One shared preload per page, bounded failures, no partial paper dolls. */
export function loadPictogramImages(createImage = () => new Image(), timeoutMs = 5000, character: Character = 'lenny'): Promise<void> {
  const sprites = manifests[character];
  return Promise.all(layers.map(id => new Promise<void>((resolve, reject) => {
    const image = createImage();
    const finish = (error?: Error) => {
      clearTimeout(timer); image.onload = null; image.onerror = null;
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error(`Pictogram timed out: ${id}`)), timeoutMs);
    image.onload = () => finish(image.naturalWidth === sprites[id].size[0] && image.naturalHeight === sprites[id].size[1]
      ? undefined : new Error(`Wrong pictogram size: ${id}`));
    image.onerror = () => finish(new Error(`Pictogram unavailable: ${id}`));
    image.src = spriteUrl(id, character);
  }))).then(() => undefined);
}
export function preloadPictograms(character: Character = 'lenny') {
  if (!pending.has(character)) pending.set(character, loadPictogramImages(undefined, undefined, character).catch(error => { pending.delete(character); throw error; }));
  return pending.get(character)!;
}
