import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { DancifyApi, preparationHelp } from './core/api';
import { ResultOutbox } from './core/outbox';
import type { Bundle, Mode, Play, PreparationOptions, Song } from './core/types';
import { usePreparation } from './hooks/usePreparation';
import { GamePanel } from './components/GamePanel';
import { WearablePanel } from './components/WearablePanel';
import { WearableClient } from './core/WearableClient';
import { MenuNavigation } from './core/menuNavigation';

const api = new DancifyApi();
const outbox = new ResultOutbox(api, localStorage);
const message = (e: unknown) => e instanceof Error ? e.message : 'Unexpected error';

export default function App() {
  const [wearable] = useState(() => new WearableClient());
  const menu = useRef(new MenuNavigation());
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const unsubscribe = wearable.subscribe(event => {
      if (!root.current || document.hidden) return;
      if (event.type === 'navigate') menu.current.move(root.current, event.direction === 'up' || event.direction === 'left' ? -1 : 1);
      if (event.type === 'activate') menu.current.activate(root.current);
    });
    return () => { unsubscribe(); wearable.disconnect(); };
  }, [wearable]);
  const [screen, setScreen] = useState<'main' | 'library'>('main');
  const [roundEnded, setRoundEnded] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]);
  const [selected, setSelected] = useState('');
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [mode, setMode] = useState<Mode>('keyboard_practice');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<'url' | 'upload'>('url');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [history, setHistory] = useState<Play[]>([]);
  const [pending, setPending] = useState(outbox.list());
  const [sending, setSending] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const bundleRef = useRef(bundle); bundleRef.current = bundle;
  const refresh = useCallback(async () => { const list = await api.listSongs(); if (mounted.current) setSongs(list); }, []);
  const load = useCallback(async (id: string) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBundle(null); setError(''); setLoading(true);
    try { const result = await api.bundle(id, controller.signal); if (!controller.signal.aborted) setBundle(result); }
    catch (e) { if (!controller.signal.aborted) setError(message(e)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  const preparation = usePreparation(api, id => {
    void refresh().catch(e => setError(message(e)));
    if (selectedRef.current === id && !bundleRef.current) void load(id);
  });
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(e => { if (mounted.current) setError(`Cannot reach the local song service. ${message(e)}`); });
    return () => { mounted.current = false; request.current?.abort(); };
  }, [refresh]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController(); setHistory([]);
    void api.plays(selected, controller.signal).then(setHistory).catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [selected, pending]);
  const options = (): PreparationOptions => {
    const a = start === '' ? undefined : Number(start), b = end === '' ? undefined : Number(end);
    if ((a !== undefined && (!Number.isFinite(a) || a < 0)) || (b !== undefined && (!Number.isFinite(b) || b <= (a ?? 0)))) throw new Error('Use a nonnegative start and an end after the start.');
    return { start_time: a, end_time: b };
  };
  const act = async (fn: () => Promise<void>) => {
    setError(''); setBusy(true);
    try { await fn(); } catch (e) { setError(message(e)); } finally { if (mounted.current) setBusy(false); }
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      const range = options();
      if (source === 'upload' && (!file || file.size === 0 || file.size > 500 * 1024 * 1024)) throw new Error('Choose a nonempty video file under 500 MiB.');
      const song = source === 'url' ? await api.createUrl(title, url) : await api.upload(title, file!);
      request.current?.abort(); setSelected(song.id); setBundle(null); setLoading(false); await refresh();
      const job = await api.prepare(song.id, { ...range, source_kind: source }); preparation.watch(job);
    });
  };
  const select = (song: Song) => {
    request.current?.abort(); setSelected(song.id); setBundle(null); setLoading(false); setError('');
    if (song.status === 'ready') void load(song.id);
  };
  const leaveGame = (destination: 'main' | 'library') => {
    request.current?.abort(); setSelected(''); setBundle(null); setLoading(false);
    setHistory([]); setError(''); setScreen(destination); setRoundEnded(false);
    window.scrollTo(0, 0);
  };
  const active = songs.find(s => s.id === selected);
  const job = preparation.job;
  const activeJob = job && (job.status === 'queued' || job.status === 'processing');
  return <main ref={root} onKeyDown={event => {
    if (event.ctrlKey || event.altKey || event.metaKey || (event.target as HTMLElement).closest('input, textarea, select, video, [contenteditable="true"]')) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault(); menu.current.move(root.current!, event.key === 'ArrowUp' ? -1 : 1);
    }
  }}>
    <h1>Dancify</h1>
    <p>Development interface — visual components will be connected to the same game logic when the designs arrive.</p>
    <WearablePanel wearable={wearable} />
    {error && <p role="alert">{error}</p>}
    {!bundle && <h2>{screen === 'main' ? 'Main menu' : 'Choose a song'}</h2>}
    {!bundle && screen === 'library' && <button data-controller onClick={() => leaveGame('main')}>Main menu</button>}
    <section hidden={!!bundle || screen === 'library'} aria-label="Prepare a song"><h2>Prepare a song</h2>
      <form onSubmit={create}>
        <p><label>Song title <input required maxLength={256} value={title} onChange={e => setTitle(e.target.value)} /></label></p>
        <p><label>Source <select aria-label="Source" value={source} onChange={e => setSource(e.target.value as 'url' | 'upload')}><option value="url">Video URL</option><option value="upload">Upload video with music</option></select></label></p>
        {source === 'url' ? <p key="url"><label>Video URL <input type="url" required value={url} onChange={e => setUrl(e.target.value)} /></label></p> : <p key="upload"><label>Video file <input type="file" accept="video/*" required onChange={e => setFile(e.target.files?.[0] ?? null)} /></label></p>}
        <p>Choose a continuous solo-dancer clip with music. A file upload bypasses download failures, but must still pass timing and tracking checks.</p>
        <fieldset><legend>Optional choreography range (seconds)</legend>
          <label>Start time <input type="number" min="0" step="0.1" value={start} onChange={e => setStart(e.target.value)} /></label>{' '}
          <label>End time <input type="number" min="0.1" step="0.1" value={end} onChange={e => setEnd(e.target.value)} /></label>
        </fieldset>
        <p><button disabled={busy || !!activeJob}>Create and prepare</button></p>
      </form>
      {job && <section aria-label="Preparation progress">
        <p role="status">Preparation: {job.status} · {job.stage}</p>
        {job.error_code && <p role="alert">{preparationHelp[job.error_code]} {job.error_message}</p>}
        {job.has_diagnostic_video && <p><a href={api.artifact(job, 'diagnostic-video')} target="_blank" rel="noreferrer">View tracking diagnostic video</a></p>}
        {job.has_diagnostic && <p><a href={api.artifact(job, 'diagnostic')} target="_blank" rel="noreferrer">Tracking details</a></p>}
        {job.status === 'failed' && <><button disabled={busy} onClick={() => void act(async () => preparation.watch(await api.retry(job)))}>Retry preparation</button>{' '}<button onClick={() => setSource('upload')}>Use upload fallback</button></>}
        {preparation.error && <p role="alert">Polling stopped: {preparation.error} <button onClick={() => preparation.watch(job)}>Reconnect to preparation</button></p>}
      </section>}
    </section>
    <section hidden={!!bundle} aria-label="Song library"><h2>Songs</h2>
      <button onClick={() => void act(refresh)} disabled={busy}>Refresh songs</button>
      <ul>{songs.map(song => <li key={song.id}><button data-controller aria-pressed={selected === song.id} onClick={() => select(song)}>{song.title}</button> — {song.status}{song.status === 'ready' && (!song.has_report || !song.active_bundle_id) ? ' (needs regeneration)' : ''}</li>)}</ul>
      {active && <p><button disabled={busy || !!activeJob} onClick={() => void act(async () => preparation.watch(await api.prepare(active.id, options())))}>Prepare selected song / new range</button>{' '}
        <button disabled={loading || active.status !== 'ready'} onClick={() => void load(active.id)}>Load latest prepared bundle</button></p>}
      {loading && <p role="status">Loading prepared bundle…</p>}
    </section>
    {bundle && <><div hidden={roundEnded}><button data-controller onClick={() => setMode(mode === 'camera' ? 'keyboard_practice' : 'camera')}>Switch to {mode === 'camera' ? 'keyboard practice' : 'camera scoring'}</button></div><label hidden={roundEnded}>Game mode <select value={mode} onChange={e => setMode(e.target.value as Mode)}><option value="keyboard_practice">Keyboard practice</option><option value="camera">Camera scoring</option></select></label>
      <GamePanel key={`${bundle.id}:${mode}`} bundle={bundle} mode={mode} wearable={wearable} outbox={outbox} onResult={() => setPending(outbox.list())} onChooseSong={() => leaveGame('library')} onMainMenu={() => leaveGame('main')} onEndedChange={setRoundEnded} /></>}
    <section hidden={!!bundle} aria-label="Pending results"><h2>Pending results</h2>
      {pending.length === 0 ? <p>No unsaved results.</p> : pending.map(item => <p key={item.result.client_session_id}>{item.result.player_name}: {item.result.score} ({item.result.mode}){' '}
        <button disabled={sending === item.result.client_session_id} onClick={() => { setSending(item.result.client_session_id); void act(async () => { await outbox.send(item); setPending(outbox.list()); }).finally(() => setSending(null)); }}>Retry pending result</button></p>)}
    </section>
    {selected && !bundle && <section aria-label="Play history"><h2>Play history</h2><ul>{history.map(play => <li key={play.id}>{play.player_name}: {play.score} · {play.mode || 'camera'} · {play.played_at}</li>)}</ul></section>}
  </main>;
}
