import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { bones, bonesFor, layoutPictogram, loadPictogramImages, segments, sprite, transform } from '../src/pictograms/rig';
import { reviewPoses } from '../src/pictograms/reviewPoses';
import manifest from '../src/assets/pictograms/lenny/sprites.json';
import humanManifest from '../src/assets/pictograms/human/sprites.json';
import { cases, expand } from './fixtures';

const near = (a: readonly number[], b: readonly number[]) => a.forEach((n, i) => expect(n).toBeCloseTo(b[i], 8));
for (const character of ['lenny', 'human'] as const) for (const move of reviewPoses()) it(`attaches ${character} limbs to the actual chart endpoints: ${move.id}`, () => {
  const bones = bonesFor(character);
  const pose = move.keyframe_landmarks, before = structuredClone(pose);
  const layout = layoutPictogram(pose, character)!;
  expect(layout.parts).toHaveLength(14);
  for (const [id, child, start, end] of segments) {
    const { matrix } = layout.parts.find(p => p.id === id)!;
    near(transform(matrix, sprite(id, character).pivot), pose[start].slice(0, 2));
    near(transform(matrix, bones[child].attachment), pose[end].slice(0, 2));
  }
  const [x, y, width, height] = layout.viewBox.split(' ').map(Number);
  expect(width).toBeGreaterThan(0); expect(height).toBeGreaterThan(0);
  for (const { matrix, crop: [x0, y0, x1, y1] } of layout.parts) {
    expect(matrix.every(Number.isFinite)).toBe(true);
    for (const corner of [[x0, y0], [x0, y1], [x1, y0], [x1, y1]]) {
      const [px, py] = transform(matrix, corner);
      expect(px).toBeGreaterThanOrEqual(x); expect(px).toBeLessThanOrEqual(x + width);
      expect(py).toBeGreaterThanOrEqual(y); expect(py).toBeLessThanOrEqual(y + height);
    }
  }
  expect(pose).toEqual(before);
});
it('maps anatomical right to viewer-left without mirroring x or swapping sides during crossings', () => {
  const pose = reviewPoses()[2].keyframe_landmarks;
  const parts = layoutPictogram(pose)!.parts;
  const left = parts.find(p => p.id === 'leftHand')!, right = parts.find(p => p.id === 'rightHand')!;
  near(transform(left.matrix, sprite('leftHand').pivot), [-.4, -2.2]);
  near(transform(right.matrix, sprite('rightHand').pivot), [.5, .2]);
  const crossed = layoutPictogram(reviewPoses()[3].keyframe_landmarks)!.parts;
  expect(transform(crossed.find(p => p.id === 'leftHand')!.matrix, sprite('leftHand').pivot)[0]).toBeCloseTo(.5);
});
it('renders the same normalized portrait and landscape geometry without a second aspect correction', () => {
  const layouts = cases.map(c => layoutPictogram(expand(c.expected_default, c.expected_overrides))!);
  for (let i = 0; i < layouts[0].parts.length; i++) near(layouts[0].parts[i].matrix, layouts[1].parts[i].matrix);
});
it('keeps hands and feet attached and uses a stable layer order', () => {
  for (const move of reviewPoses()) {
    const parts = layoutPictogram(move.keyframe_landmarks)!.parts;
    for (const [id, joint] of [['leftHand', 16], ['rightHand', 15], ['leftFoot', 28], ['rightFoot', 27]] as const)
      near(transform(parts.find(p => p.id === id)!.matrix, sprite(id).pivot), move.keyframe_landmarks[joint].slice(0, 2));
    const changed = structuredClone(move.keyframe_landmarks); changed.forEach(p => p[2] += 3);
    expect(layoutPictogram(changed)).toEqual(layoutPictogram(move.keyframe_landmarks));
  }
});
it('falls back on incomplete or collapsed projected poses instead of inventing limb angles', () => {
  for (const kind of ['missing', 'nan', 'collapsed', 'torso']) {
    const p = reviewPoses()[0].keyframe_landmarks;
    if (kind === 'missing') p[16][3] = .1;
    if (kind === 'nan') p[16][0] = NaN;
    if (kind === 'collapsed') p[16] = [...p[14]];
    if (kind === 'torso') { p[11] = [...p[23]]; p[12] = [...p[24]]; }
    expect(layoutPictogram(p)).toBeNull();
  }
});
it.each(['lenny', 'human'] as const)('ships bounded %s runtime images with traceable source hashes', character => {
  let pixels = 0;
  for (const [id, info] of Object.entries(character === 'lenny' ? manifest : humanManifest)) {
    const png = readFileSync(new URL(`../src/assets/pictograms/${character}/${id}.png`, import.meta.url));
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    expect([width, height]).toEqual(info.size);
    expect(Math.max(width, height)).toBeLessThanOrEqual(256);
    pixels += width * height;
    const original = readFileSync(new URL(`../../assets/pictograms/${info.source}`, import.meta.url));
    expect(createHash('sha256').update(original).digest('hex')).toBe(info.sourceSha256);
  }
  expect(pixels * 4).toBeLessThan(3 * 1024 * 1024);
});
it('rejects broken images and bounds hanging loads', async () => {
  const broken = () => {
    const image = { set src(_value: string) { queueMicrotask(() => image.onerror?.()); }, onerror: null as null | (() => void) };
    return image as unknown as HTMLImageElement;
  };
  await expect(loadPictogramImages(broken)).rejects.toThrow('unavailable');
  vi.useFakeTimers();
  try {
    const pending = loadPictogramImages(() => ({} as HTMLImageElement));
    const failed = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(5000); await failed;
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
