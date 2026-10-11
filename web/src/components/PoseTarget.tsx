import { useEffect, useMemo, useState } from 'react';
import type { Move } from '../core/types';
import type { Character } from '../pictograms/rig';
import { layoutPictogram, preloadPictograms, spriteUrl } from '../pictograms/rig';
const edges = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

export function PoseTarget({ move, compact = false, showSkeleton = false, character = 'lenny' }: { move: Move; compact?: boolean; showSkeleton?: boolean; character?: Character }) {
  const pose = move.keyframe_landmarks;
  const layout = useMemo(() => layoutPictogram(pose, character), [pose, character]);
  const [loaded, setLoaded] = useState<{ character: Character; status: 'ready' | 'failed' } | null>(null);
  const assets = loaded?.character === character ? loaded.status : 'loading';
  useEffect(() => {
    let alive = true;
    void preloadPictograms(character).then(() => { if (alive) setLoaded({ character, status: 'ready' }); }, () => { if (alive) setLoaded({ character, status: 'failed' }); });
    return () => { alive = false; };
  }, [character]);
  const illustrated = assets === 'ready' && !!layout && !showSkeleton;
  const visibleEdges = edges.filter(([a, b]) => [pose[a], pose[b]].every(p => p?.every(Number.isFinite) && p[3] >= 0.35));
  const points = visibleEdges.flatMap(([a, b]) => [pose[a], pose[b]]);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x = Math.min(...xs, -0.5) - 0.2, y = Math.min(...ys, -0.5) - 0.2;
  const fallbackBox = `${x} ${y} ${Math.max(...xs, 0.5) - x + 0.2} ${Math.max(...ys, 0.5) - y + 0.2}`;
  return <figure style={compact ? { margin: 4 } : undefined} data-pose-id={move.id}>
    <svg width={compact ? 100 : 160} height={compact ? 110 : 180} style={{ maxWidth: '100%', background: 'Canvas', color: 'CanvasText', colorScheme: 'light' }}
      viewBox={layout?.viewBox ?? fallbackBox} role="img" aria-label={`Target pose ${move.id}`} data-renderer={illustrated ? character : 'skeleton'}>
      {illustrated ? layout.parts.map(({ id, matrix, crop: [x0, y0, x1, y1] }) =>
        <image key={`${character}-${id}`} data-part={id} href={spriteUrl(id, character)} x={x0} y={y0} width={x1 - x0} height={y1 - y0}
          preserveAspectRatio="none" transform={`matrix(${matrix.join(' ')})`} onError={() => setLoaded({ character, status: 'failed' })} />)
        : visibleEdges.map(([a, b]) => <line key={`${a}-${b}`} x1={pose[a][0]} y1={pose[a][1]} x2={pose[b][0]} y2={pose[b][1]} stroke="currentColor" strokeWidth="0.035" />)}
    </svg>
    <figcaption>{move.id}: {move.start.toFixed(2)}–{move.end.toFixed(2)} seconds
      {!showSkeleton && assets === 'failed' && <small> · Artwork unavailable; showing skeleton.</small>}
      {!showSkeleton && !layout && <small> · Showing skeleton for this pose.</small>}
    </figcaption>
  </figure>;
}
