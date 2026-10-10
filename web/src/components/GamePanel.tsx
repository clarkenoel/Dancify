import { useState } from 'react';
import type { Bundle, Mode } from '../core/types';
import { useGame } from '../hooks/useGame';
import type { ResultOutbox } from '../core/outbox';
import { PoseTarget } from './PoseTarget';
import { TimingOverlay } from './TimingOverlay';

export function GamePanel({ bundle, mode, outbox, onResult }: { bundle: Bundle; mode: Mode; outbox: ResultOutbox; onResult: () => void }) {
  const game = useGame(bundle, mode);
  const s = game.snapshot;
  const [name, setName] = useState('');
  const [showTiming, setShowTiming] = useState(true);
  const [saveState, setSaveState] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const save = async () => {
    if (saving || saved) return;
    setSaving(true); setSaveState('Saving…');
    try {
      const existing = outbox.list().find(p => p.result.client_session_id === pendingId);
      const item = existing ?? outbox.enqueue(bundle.song.id, game.result(name));
      setPendingId(item.result.client_session_id); onResult();
      await outbox.send(item); setSaved(true); setSaveState('Result saved'); onResult();
    } catch (e) { setSaveState(`${e instanceof Error ? e.message : 'Save failed'}. Your pending result can be retried.`); onResult(); }
    finally { setSaving(false); }
  };
  const replay = () => { setSaved(false); setSaveState(''); setPendingId(null); void game.replay(); };
  return <section aria-label="Game">
    <h2>{bundle.song.title}</h2>
    <p>{mode === 'camera' ? 'Camera scoring' : 'Keyboard practice — separate from camera scores'}</p>
    {bundle.report.cache.source_kind === 'manual' && <p>This bundle was supplied manually with a validated report; its media provenance was not verified by the preparation worker.</p>}
    <label><input type="checkbox" checked={showTiming} onChange={e => setShowTiming(e.target.checked)} /> Show timing overlay</label>
    <div style={{ position: 'relative', width: 640, maxWidth: '100%' }}>
      <video ref={game.videoRef} src={bundle.videoUrl} controls playsInline preload="metadata" width="640" style={{ display: 'block', width: '100%' }} aria-label="Reference video" />
      {showTiming && <TimingOverlay chart={bundle.chart} snapshot={s} mode={mode} />}
    </div>
    <p>Diamonds mark detected music beats. Pose bars mark scoring windows; press Enter during a bar in keyboard practice. Arrow keys still seek. Use this view to check the chart against the music; it does not prove beat detection is correct. Native video fullscreen hides the overlay.</p>
    {game.error && <p role="alert">{game.error}</p>}
    <p><button onClick={() => void game.toggle()}>Play / pause</button>{' '}<button onClick={replay}>Replay from beginning</button></p>
    {mode === 'camera' ? <div>
      <video ref={game.cameraRef} muted playsInline width="320" style={{ maxWidth: '100%', transform: 'scaleX(-1)' }} aria-label="Webcam preview" />
      <p><button onClick={() => void game.startCamera()} disabled={game.cameraState !== 'off'}>{game.cameraState === 'starting' ? 'Starting camera…' : game.cameraState === 'ready' ? 'Camera on' : 'Enable camera'}</button></p>
      <p role="status">{game.tracking}</p><p>Your camera frames stay in this browser.</p>
    </div> : <p><button onClick={game.hit} disabled={!s.playing}>Hit checkpoint</button> Press Enter during a checkpoint window, or use this button.</p>}
    <p>Space: play/pause. R: replay. Left/right arrows: seek for practice. Form controls keep their normal keyboard behavior.</p>
    <p aria-label="Playback position">{s.time.toFixed(1)} / {s.duration.toFixed(1)} seconds</p>
    <p>Beat {bundle.chart.beat_times.filter(t => t <= s.time).length} / {bundle.chart.beat_times.length}</p>
    <p aria-label="Score">Score: {s.score} · Combo: {s.combo} · Best combo: {s.maxCombo}</p>
    <p aria-live="polite">{s.results.at(-1)?.judgment ?? 'Ready for the first checkpoint'}</p>
    <p>Accuracy: {s.accuracy === null ? 'No comparable poses yet' : `${(s.accuracy * 100).toFixed(1)}%`}{mode === 'camera' && ` · Tracking coverage: ${s.coverage === null ? '—' : `${(s.coverage * 100).toFixed(1)}%`}`}</p>
    {s.seeked && <p>This is a practice segment. Replay from the beginning to record a complete result.</p>}
    <details><summary>Simulate wearable controls</summary>
      <button onClick={() => game.wearable.simulate({ type: 'togglePlayback' })}>Wearable play / pause</button>{' '}
      <button onClick={() => game.wearable.simulate({ type: 'navigate', direction: 'up' })}>Wearable volume up</button>
      <p>Wearable events control playback only. They never score a checkpoint.</p>
    </details>
    <section aria-label="Upcoming checkpoints"><h3>Upcoming checkpoints</h3>
      {s.upcomingIds.map(id => <PoseTarget key={id} move={bundle.chart.moves.find(m => m.id === id)!} />)}
    </section>
    {s.ended && <section aria-label="Results">
      <h3>Session complete</h3>
      <p>{Object.entries(s.judgments).map(([j, n]) => `${j}: ${n}`).join(' · ')}</p>
      <p>Judgment thresholds are provisional. Tracking loss remains distinct from a missed pose and is included in the accuracy denominator.</p>
      <label>Player name <input value={name} onChange={e => setName(e.target.value)} maxLength={128} disabled={!!pendingId} /></label>{' '}
      <button onClick={() => void save()} disabled={s.seeked || saving || saved}>{saved ? 'Saved' : pendingId ? 'Retry saving result' : 'Save result'}</button>
      <p role="status">{saveState}</p>
    </section>}
  </section>;
}
