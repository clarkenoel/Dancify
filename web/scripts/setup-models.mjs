import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Official Google package, locked by npm integrity. These full-model weights
// are byte-identical to the Python MediaPipe 0.10.18 model used by the pipeline.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = `${root}node_modules/@mediapipe/pose`;
const expected = 'e9a5c5cb17f736fafd4c2ec1da3b3d331d6edbe8a0d32395855aeb2cdfd64b9f';
const model = await readFile(`${source}/pose_landmark_full.tflite`);
if (createHash('sha256').update(model).digest('hex') !== expected) throw new Error('Pose model checksum mismatch; restore the pinned dependency with npm ci.');
await mkdir(`${root}public/mediapipe`, { recursive: true });
for (const name of await readdir(source)) {
  if (name.startsWith('pose') && !name.includes('_heavy') && !name.includes('_lite')) await cp(`${source}/${name}`, `${root}public/mediapipe/${name}`);
}
console.log(`Local MediaPipe runtime and full model ready. SHA-256 ${expected}`);
