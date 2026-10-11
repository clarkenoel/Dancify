import type { Move } from '../core/types';
import type { Character } from '../pictograms/rig';
import { PoseTarget } from './PoseTarget';

const PREVIEW_SECONDS = 6;
const MARKER_PERCENT = 14;
const ENTRY_PERCENT = 88;

// Artist rig: https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-24
// Sliding layout approved for the 2026-10-11 demo; dimensions are provisional,
// not Figma measurements. Time comes from the reference-video snapshot.
export function PictographTimeline({ moves, time, character, showSkeleton = false }: {
  moves: Move[]; time: number; character: Character; showSkeleton?: boolean;
}) {
  const visible = moves.filter(move => move.end > time && move.start <= time + PREVIEW_SECONDS).slice(0, 4);
  return <section className="pictograph-timeline" aria-label="Upcoming dance moves">
    <span className="pictograph-marker" aria-hidden="true"><span>NOW</span></span>
    <div className="pictograph-cues">
      {visible.map(move => {
        const active = move.start <= time && time < move.end;
        const position = active ? MARKER_PERCENT
          : MARKER_PERCENT + (move.start - time) / PREVIEW_SECONDS * (ENTRY_PERCENT - MARKER_PERCENT);
        return <div key={move.id} className={'pictograph-cue' + (active ? ' is-current' : '')}
          style={{ left: position + '%' }} aria-label={active ? 'Current move' : 'Upcoming move'}
          aria-current={active ? 'step' : undefined}>
          <span className="pictograph-static-label">{active ? 'NOW' : 'NEXT'}</span>
          <PoseTarget move={move} compact timeline character={character} showSkeleton={showSkeleton} />
        </div>;
      })}
    </div>
    {visible.length === 0 && <span className="pictograph-empty">{moves.some(move => move.end > time) ? 'Next moves coming up' : 'All moves complete'}</span>}
  </section>;
}
