import { useEffect, useRef, useState } from 'react';
import type { Bundle, Mode } from '../core/types';
import { useGame } from '../hooks/useGame';
import type { ResultOutbox } from '../core/outbox';
import { PoseTarget } from './PoseTarget';
import { TimingOverlay } from './TimingOverlay';
import { CameraPanel } from './CameraPanel';

export function GamePanel({ bundle, mode, outbox, onResult, onChooseSong, onMainMenu, onEndedChange }: { bundle: Bundle; mode: Mode; outbox: ResultOutbox; onResult: () => void; onChooseSong: () => void; onMainMenu: () => void; onEndedChange: (ended: boolean) => void }) {
  const game = useGame(bundle, mode);
  const s = game.snapshot;
  const [showTiming, setShowTiming] = useState(true);
  const recorded = useRef<string | null>(null);
  const resultsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    onEndedChange(s.ended);
    if (s.ended) resultsRef.current?.focus();
    return () => onEndedChange(false);
  }, [s.ended, onEndedChange]);
  useEffect(() => {
    if (!s.ended || s.seeked || recorded.current === s.sessionId) return;
    recorded.current = s.sessionId;
    // History is best effort and never gates the locally computed result screen.
    try {
      const item = outbox.enqueue(bundle.song.id, game.result('anonymous'));
      onResult();
      void outbox.send(item).catch(() => {}).finally(onResult);
    } catch { /* Storage unavailable: the score and navigation still work. */ }
  }, [s.ended, s.seeked, s.sessionId, bundle.song.id, game, outbox, onResult]);
  const replay = () => { void game.replay(); };
  return <section aria-label="Game">
    <h2>{bundle.song.title}</h2>
    {s.ended && <section aria-label="Results" ref={resultsRef} tabIndex={-1}>
      <h3>Session complete</h3>
      <p aria-label="Final score"><strong>Final score: {s.score}</strong></p>
      <p>Best combo: {s.maxCombo} · Accuracy: {s.accuracy === null ? 'No comparable poses' : `${(s.accuracy * 100).toFixed(1)}%`}</p>
      <p>{Object.entries(s.judgments).map(([j, n]) => `${j}: ${n}`).join(' · ')}</p>
      {s.seeked && <p>Practice segment — replay from the beginning for a complete round.</p>}
      <p><button onClick={replay}><strong>Play again</strong></button>{' '}
        <button onClick={onChooseSong}>Choose another song</button>{' '}
        <button onClick={onMainMenu}>Main menu</button></p>
    </section>}
    <div hidden={s.ended}>
    <p>{mode === 'camera' ? 'Camera scoring' : 'Keyboard practice — separate from camera scores'}</p>
    {bundle.report.cache.source_kind === 'manual' && <p>This bundle was supplied manually with a validated report; its media provenance was not verified by the preparation worker.</p>}
    <div aria-label="Practice video feeds" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 28rem), 1fr))', gap: '1rem', alignItems: 'start', maxWidth: mode === 'camera' ? 1280 : 640 }}>
      <section aria-label="Reference player" style={{ minWidth: 0 }}>
        <h3>Reference dance</h3>
        <div style={{ position: 'relative', width: '100%' }}>
          <video ref={game.videoRef} src={bundle.videoUrl} controls playsInline preload="metadata" width="640" style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'contain' }} aria-label="Reference video" />
          {showTiming && <TimingOverlay chart={bundle.chart} snapshot={s} mode={mode} />}
        </div>
        <label><input type="checkbox" checked={showTiming} onChange={e => setShowTiming(e.target.checked)} /> Show timing overlay</label>
        <p><button onClick={() => void game.toggle()}>Play / pause</button>{' '}<button onClick={replay}>Replay round</button></p>
        {game.error && <p role="alert">{game.error}</p>}
        <p>Diamonds mark detected music beats. Pose bars mark scoring windows; press Enter during a bar in keyboard practice. Arrow keys still seek. Use this view to check the chart against the music; it does not prove beat detection is correct. Native video fullscreen hides the overlay.</p>
      </section>
      {mode === 'camera' && <CameraPanel camera={game.camera} target={bundle.chart.moves.find(m => m.id === (s.activeId ?? s.upcomingIds[0]))} active={s.activeId !== null} />}
    </div>
    {mode === 'keyboard_practice' && <p><button onClick={game.hit} disabled={!s.playing}>Hit checkpoint</button> Press Enter during a checkpoint window, or use this button.</p>}
    <p>Space: play/pause. R: replay. Left/right arrows: seek for practice. Form controls keep their normal keyboard behavior.</p>
    <p aria-label="Playback position">{s.time.toFixed(1)} / {s.duration.toFixed(1)} seconds</p>
    <p>Beat {bundle.chart.beat_times.filter(t => t <= s.time).length} / {bundle.chart.beat_times.length}</p>
    <p aria-label="Score">Score: {s.score} · Combo: {s.combo} · Best combo: {s.maxCombo}</p>
    <p aria-live="polite">{s.results.at(-1)?.judgment ?? 'Ready for the first checkpoint'}</p>
    <p>Accuracy: {s.accuracy === null ? 'No comparable poses yet' : `${(s.accuracy * 100).toFixed(1)}%`}{mode === 'camera' && ` · Tracking coverage: ${s.coverage === null ? '—' : `${(s.coverage * 100).toFixed(1)}%`}`}</p>
    {s.seeked && <p>This is a practice segment. Replay from the beginning to record a complete result.</p>}
    </div>
    {mode === 'camera' && <details open={!s.ended}><summary>Movement diagnostics</summary>
      <p>Camera scoring matches static checkpoints, not continuous choreography. All 12 body joints must be visible in both poses; missing limbs produce LOST rather than an inflated match. Thresholds remain provisional.</p>
      <label><input type="checkbox" checked={game.movementLog?.enabled ?? true} onChange={e => game.setRecording(e.target.checked)} /> Record body movements locally</label>{' '}
      <button onClick={game.downloadLog}>Download movement log</button>{' '}<button onClick={game.clearLog}>Clear movement log</button>
      <p>Samples: {game.movementLog?.count ?? 0} · Older samples dropped: {game.movementLog?.dropped ?? 0} · Latest: {game.movementLog?.latest?.decision.status ?? 'Waiting for camera'}</p>
      <p>Comparison: {game.movementLog?.latest?.decision.comparison?.reason ?? '—'} · Matched joints: {game.movementLog?.latest?.decision.comparison?.matchedJoints.length ?? 0}/12 · Movement delta: {game.movementLog?.latest?.movementDelta?.toFixed(4) ?? '—'}</p>
      <p>The log keeps up to 6,000 samples in memory. It includes body coordinates, confidence, comparison components and checkpoint results; no face landmarks or video. Replay clears it. Movement delta is diagnostic, not an activity score.</p>
      <table><caption>Checkpoint scoring evidence</caption><thead><tr><th>Checkpoint</th><th>Judgment</th><th>Similarity</th><th>Best sample (seconds)</th></tr></thead>
        <tbody>{s.results.map(r => <tr key={r.id}><td>{r.id}</td><td>{r.judgment}</td><td>{r.similarity?.toFixed(4) ?? '—'}</td><td>{r.bestSampleTime?.toFixed(3) ?? '—'}</td></tr>)}</tbody></table>
    </details>}
    <div hidden={s.ended}><details><summary>Simulate wearable controls</summary>
      <button onClick={() => game.wearable.simulate({ type: 'togglePlayback' })}>Wearable play / pause</button>{' '}
      <button onClick={() => game.wearable.simulate({ type: 'navigate', direction: 'up' })}>Wearable volume up</button>
      <p>Wearable events control playback only. They never score a checkpoint.</p>
    </details>
    <section aria-label="Upcoming checkpoints"><h3>Upcoming checkpoints</h3>
      {s.upcomingIds.map(id => <PoseTarget key={id} move={bundle.chart.moves.find(m => m.id === id)!} />)}
    </section></div>

  </section>;
}
