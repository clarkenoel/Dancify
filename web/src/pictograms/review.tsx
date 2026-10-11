import type { Character } from './rig';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PoseTarget } from '../components/PoseTarget';
import { validateChart } from '../core/validation';
import { reviewPoses } from './reviewPoses';

function Review() {
  const [moves, setMoves] = useState(reviewPoses);
  const [error, setError] = useState('');
  const [character, setCharacter] = useState<Character>('lenny');
  return <main><h1>Pictogram review</h1>
    <p>Diagnostic poses, not scored rounds. Each pair shows the same landmarks as the selected character and as a skeleton.</p>
    <label>Target character <select value={character} onChange={e => setCharacter(e.target.value as Character)}><option value="lenny">Lenny</option><option value="human">Human</option></select></label>{' '}
    <label>Load prepared dance.json <input type="file" accept=".json" onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      try { setMoves(validateChart(JSON.parse(await file.text())).moves); setError(''); }
      catch (error) { setError(String(error)); }
    }} /></label>{' '}<button onClick={() => { setMoves(reviewPoses()); setError(''); }}>Known poses</button>
    {error && <p role="alert">{error}</p>}
    <p>Chart coordinates are not mirrored. Artwork left means viewer-left; it follows the dancer’s anatomical right side.</p>
    {moves.map(move => <section key={move.id} aria-label={move.id} style={{ display: 'inline-block', verticalAlign: 'top' }}>
      <h2>{move.id}</h2><div style={{ display: 'flex' }}><PoseTarget move={move} character={character} /><PoseTarget move={move} showSkeleton character={character} /></div>
    </section>)}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Review />);
