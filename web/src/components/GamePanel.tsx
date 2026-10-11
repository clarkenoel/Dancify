import type { Character } from '../pictograms/rig';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Bundle } from '../core/types';
import { useGame } from '../hooks/useGame';
import type { ResultOutbox } from '../core/outbox';
import { PoseTarget } from './PoseTarget';
import type { WearableClient } from '../core/WearableClient';
import { CameraPanel, CameraSettings } from './CameraPanel';
import { ToolsDialog } from './ToolsDialog';
import { WearablePanel } from './WearablePanel';
import { ConfirmDialog } from './ConfirmDialog';
import { starRating } from '../core/starRating';
import type { SoundEvent } from '../audio/SoundEffects';
import { ScoreStars } from './RinkArtwork';

export function GamePanel({ bundle, wearable, outbox, onSound, onStopSounds, onResult, onChooseSong, onMainMenu }: { bundle: Bundle; wearable: WearableClient; outbox: ResultOutbox; onSound: (event: SoundEvent, id?: string) => void; onStopSounds: () => void; onResult: () => void; onChooseSong: () => void; onMainMenu: () => void; }) {
  const [confirmation, setConfirmation] = useState<'restart' | 'library' | 'main' | null>(null);
  const [tools, setTools] = useState<'settings' | 'developer' | null>(null);
  const wearableState = useSyncExternalStore(wearable.subscribeState, wearable.snapshot);
  const game = useGame(bundle, wearable, confirmation !== null || tools !== null);
  const openTools = (screen: 'settings' | 'developer') => { game.pause(); setTools(screen); };
  const s = game.snapshot;
  const finalStars = starRating(s.accuracy, s.ended, s.seeked);
  const [volume, setVolume] = useState(1);
  const confirm = (action: 'restart' | 'library' | 'main') => { game.pause(); setConfirmation(action); };
  const [showTargetSkeleton, setShowTargetSkeleton] = useState(false);
  const [character, setCharacter] = useState<Character>('lenny');
  const recorded = useRef<string | null>(null);
  const announcedResult = useRef<string | null>(null);
  const soundJudgments = useRef({ session: '', seen: new Set<string>() });
  const resultsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!s.playing) onStopSounds();
  }, [s.playing, onStopSounds]);
  useEffect(() => () => onStopSounds(), [onStopSounds]);
  useEffect(() => {
    if (soundJudgments.current.session !== s.sessionId) soundJudgments.current = { session: s.sessionId, seen: new Set() };
    const fresh = s.results.filter(result => !soundJudgments.current.seen.has(result.id));
    for (const result of fresh) soundJudgments.current.seen.add(result.id);
    // LOST is missing tracking, not a dance mistake. Never replay old misses on
    // seek, resume or results, or use sounds to change the scoring clock.
    if (document.hidden || !s.playing || s.ended || s.seeked) return;
    for (const result of fresh) if (result.judgment === 'MISS') onSound('miss', `${s.sessionId}:${result.id}`);
  }, [s.sessionId, s.results, s.playing, s.ended, s.seeked, onSound]);
  useEffect(() => {
    if (s.ended) resultsRef.current?.focus();
  }, [s.ended]);
  useEffect(() => {
    if (!s.ended || announcedResult.current === s.sessionId) return;
    // Mark every completed session, even if disconnected/hidden, so reconnecting
    // or returning to the tab cannot replay an old celebration.
    announcedResult.current = s.sessionId;
    if (finalStars !== null && !document.hidden) onSound(finalStars > 0 ? 'win' : 'lose', `${s.sessionId}:results`);
    if (finalStars !== null && finalStars > 0 && !document.hidden && wearable.snapshot().status === 'connected') {
      wearable.selectionFeedback();
    }
  }, [s.ended, s.sessionId, finalStars, wearable, onSound]);
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
  return <section className="game-page" aria-label="Game">
    <div className="game-heading"><p className="eyebrow">On the dance floor</p><h1>{bundle.song.title}</h1></div>
    {!!bundle.report.checkpoint_quality?.omitted && <p role="status">Preparation omitted {bundle.report.checkpoint_quality.omitted} of {bundle.report.checkpoint_quality.selected} checkpoints because their body tracking could not be scored. {bundle.report.checkpoint_quality.retained} playable checkpoints remain.</p>}
    {s.ended && <section className="results-panel panel" aria-label="Results" ref={resultsRef} tabIndex={-1}>
      <p className="eyebrow">That’s a wrap</p><h2>Session complete</h2>
      {finalStars !== null && <ScoreStars rating={finalStars} />}
      <p className="final-score" aria-label="Final score"><strong>Final score: {s.score}</strong></p>
      <p className="final-score star-rating" aria-label="Star rating">{finalStars === null
        ? s.seeked ? 'No rating for a practice segment' : 'Not enough tracking for a rating'
        : <strong>{finalStars} / 5 stars</strong>}</p>
      <p>Best combo: {s.maxCombo} · Accuracy: {s.accuracy === null ? 'No comparable poses' : `${(s.accuracy * 100).toFixed(1)}%`}</p>
      <p>{Object.entries(s.judgments).map(([j, n]) => `${j}: ${n}`).join(' · ')}</p>
      {s.seeked && <p>Practice segment — replay from the beginning for a complete round.</p>}
      <p className="action-row"><button className="primary" data-controller onClick={replay}><strong>Play again</strong></button>{' '}
        <button data-controller onClick={onChooseSong}>Choose another song</button>{' '}
        <button data-controller onClick={onMainMenu}>Main menu</button></p>
    </section>}
    <div hidden={s.ended}>
    {game.controllerWarning && <p role="alert">{game.controllerWarning} <button data-controller onClick={game.continueWithoutController}>Continue without controller</button></p>}
    {!s.playing && game.countdown === null && <p role="status">{game.waitingForBody ? 'Stand alone with your whole body in frame. After one second of stable tracking, the countdown and video start automatically.' : game.ready ? 'Framing ready. Confirm Ready to start or resume.' : 'Stand alone and keep shoulders, wrists, hips, knees and ankles in view for one second.'}</p>}
    <p className="mode-label">Camera scoring · Match the dancer</p>
    {bundle.report.cache.source_kind === 'manual' && <p>This bundle was supplied manually with a validated report; its media provenance was not verified by the preparation worker.</p>}
    <div className="game-hud">
    <p aria-label="Playback position">{s.time.toFixed(1)} / {s.duration.toFixed(1)} seconds</p>
    <p>Beat {bundle.chart.beat_times.filter(t => t <= s.time).length} / {bundle.chart.beat_times.length}</p>
    <p className="score-bar" aria-label="Score">Score: {s.score} · Combo: {s.combo} · Best combo: {s.maxCombo}</p>
    <p className="judgment" aria-live="polite">{s.results.at(-1)?.judgment ?? 'Ready for the first checkpoint'}</p>
    <p>Accuracy: {s.accuracy === null ? 'No comparable poses yet' : `${(s.accuracy * 100).toFixed(1)}%`}{` · Tracking coverage: ${s.coverage === null ? '—' : `${(s.coverage * 100).toFixed(1)}%`}`}</p>
    </div>
    <div className="video-feeds" aria-label="Dance video feeds">
      <section className="video-panel" aria-label="Reference player">
        <h3>Reference dance</h3>
        <div className="video-stage" style={{ position: 'relative', width: '100%' }}>
          {game.countdown !== null && <h2 className="countdown" role="status" aria-label="Replay countdown">Get ready — {game.countdown}</h2>}
          <video ref={game.videoRef} src={bundle.videoUrl} playsInline preload="metadata" width="640" style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'contain' }} aria-label="Reference video" />
        </div>

        <p><button data-controller disabled={!s.playing && game.countdown === null && !game.ready} onClick={() => void game.toggle()}>{game.countdown !== null ? 'Cancel countdown' : s.playing ? 'Pause round' : 'Ready — start / resume'}</button>{' '}<button data-controller disabled={game.countdown !== null} onClick={() => confirm('restart')}>Replay round</button></p>
        {game.error && <p role="alert">{game.error}</p>}
      </section>
      <CameraPanel camera={game.camera} target={bundle.chart.moves.find(m => m.id === (s.activeId ?? s.upcomingIds[0]))} active={s.activeId !== null} showTargetSkeleton={showTargetSkeleton} character={character} />
    </div>

    {s.seeked && <p>This is a practice segment. Replay from the beginning to record a complete result.</p>}
    </div>
    <div hidden={s.ended}><p><button data-controller onClick={() => confirm('library')}>Choose another song</button>{' '}<button data-controller onClick={() => confirm('main')}>Main menu</button></p></div>

    <div className="action-row game-tools-actions"><button data-controller onClick={() => openTools('settings')}>Settings</button><button data-controller onClick={() => openTools('developer')}>Developer tools</button></div>
    {tools === 'settings' && <ToolsDialog title="Settings" subtitle="Set up your camera, music, and dance character." onClose={() => setTools(null)}>
      <div className="settings-grid"><CameraSettings camera={game.camera} /><section aria-label="Music and character settings">
    <label className="volume-control">Music volume <input type="range" min="0" max="1" step="0.05" value={volume} onChange={event => { const value = Number(event.target.value); setVolume(value); if (game.videoRef.current) game.videoRef.current.volume = value; }} /></label>
    <label>Target character <select value={character} onChange={e => setCharacter(e.target.value as Character)}><option value="lenny">Lenny</option><option value="human">Human</option></select></label>{' '}
    <label><input type="checkbox" checked={showTargetSkeleton} onChange={e => setShowTargetSkeleton(e.target.checked)} /> Show target skeleton instead of artwork</label>

      </section></div>
      <div className="action-row centered"><button data-controller disabled={!wearable.supported || wearableState.status !== 'disconnected'} onClick={() => void wearable.connect()}>Connect wearable</button></div>
      <p role="status">Wearable · {wearableState.status}{wearableState.simulated ? ' (simulated)' : ''}</p>
      {!wearable.supported && <p className="help">Bluetooth requires desktop Chrome or Edge on localhost or HTTPS. The controller is optional.</p>}
      {wearableState.error && <p role="alert">{wearableState.error}</p>}
      <p className="help">The round stays paused when you return. Confirm Ready to resume.</p>
    </ToolsDialog>}
    <ToolsDialog open={tools === 'developer'} title="Developer tools" subtitle="Testing controls kept separate from the player experience." onClose={() => setTools(null)}>
      <div className="developer-grid"><section>    <details><summary>Movement diagnostics</summary>
      <p>Camera scoring matches static checkpoints, not continuous choreography. All 12 body joints must be visible in both poses; missing limbs produce LOST rather than an inflated match. Thresholds remain provisional.</p>
      <label><input type="checkbox" checked={game.movementLog?.enabled ?? true} onChange={e => game.setRecording(e.target.checked)} /> Record body movements locally</label>{' '}
      <button onClick={game.downloadLog}>Download movement log</button>{' '}<button onClick={game.clearLog}>Clear movement log</button>
      <p>Samples: {game.movementLog?.count ?? 0} · Older samples dropped: {game.movementLog?.dropped ?? 0} · Latest: {game.movementLog?.latest?.decision.status ?? 'Waiting for camera'}</p>
      <p>Comparison: {game.movementLog?.latest?.decision.comparison?.reason ?? '—'} · Matched joints: {game.movementLog?.latest?.decision.comparison?.matchedJoints.length ?? 0}/12 · Movement delta: {game.movementLog?.latest?.movementDelta?.toFixed(4) ?? '—'}</p>
      <p>The log keeps up to 6,000 samples in memory. It includes body coordinates, confidence, comparison components and checkpoint results; no face landmarks or video. Replay clears it. Movement delta is diagnostic, not an activity score.</p>
      <table><caption>Checkpoint scoring evidence</caption><thead><tr><th>Checkpoint</th><th>Judgment</th><th>Similarity</th><th>Best sample (seconds)</th></tr></thead>
        <tbody>{s.results.map(r => <tr key={r.id}><td>{r.id}</td><td>{r.judgment}</td><td>{r.similarity?.toFixed(4) ?? '—'}</td><td>{r.bestSampleTime?.toFixed(3) ?? '—'}</td></tr>)}</tbody></table>
    </details>
</section><section><WearablePanel wearable={wearable} /><details><summary>Simulate wearable controls</summary>
      <button onClick={() => game.wearable.simulate({ type: 'togglePlayback' })}>Wearable play / pause</button>{' '}
      <button onClick={() => game.wearable.simulate({ type: 'navigate', direction: 'down' })}>Wearable next item</button>
      <p>Wearable events control navigation and playback only. They never score a checkpoint.</p>
    </details>
</section></div>
      <details><summary>Chart diagnostics</summary><section aria-label="Upcoming checkpoints"><h3>Upcoming checkpoints</h3>
      {s.upcomingIds.map(id => <PoseTarget key={id} move={bundle.chart.moves.find(m => m.id === id)!} showSkeleton={showTargetSkeleton} character={character} />)}
    </section></details>
    </ToolsDialog>
    {confirmation && <ConfirmDialog title={confirmation === 'restart' ? 'Restart this dance?' : confirmation === 'library' ? 'Choose another song?' : 'Return to main menu?'} onCancel={() => setConfirmation(null)} onConfirm={() => { const action = confirmation; setConfirmation(null); if (action === 'restart') replay(); else if (action === 'library') onChooseSong(); else onMainMenu(); }} />}
  </section>;
}

