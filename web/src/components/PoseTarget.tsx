import type { Move } from '../core/types';
const edges = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

/** Functional skeleton placeholder. Figma artwork can replace this renderer. */
export function PoseTarget({ move }: { move: Move }) {
  const pose = move.keyframe_landmarks;
  return <figure>
    <svg width="160" height="180" viewBox="-3 -3 6 6" role="img" aria-label={`Target pose ${move.id}`}>
      {edges.filter(([a, b]) => pose[a][3] >= 0.35 && pose[b][3] >= 0.35).map(([a, b]) => <line key={`${a}-${b}`} x1={pose[a][0]} y1={pose[a][1]} x2={pose[b][0]} y2={pose[b][1]} stroke="currentColor" strokeWidth="0.06" />)}
    </svg>
    <figcaption>{move.id}: {move.start.toFixed(2)}–{move.end.toFixed(2)} seconds</figcaption>
  </figure>;
}
