import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { DancifyApi, preparationHelp } from './core/api';
import { ResultOutbox } from './core/outbox';
import type { Bundle, Play, PreparationOptions, Song } from './core/types';
import { usePreparation } from './hooks/usePreparation';
import { GamePanel } from './components/GamePanel';
import { WearablePanel } from './components/WearablePanel';
import { WearableClient } from './core/WearableClient';
import { MenuNavigation } from './core/menuNavigation';

const api = new DancifyApi();
const outbox = new ResultOutbox(api, localStorage);
const message = (e: unknown) => e instanceof Error ? e.message : 'Unexpected error';
type Screen = 'main' | 'library' | 'prepare';

// Figma main 15-237, library 15-358, prepare 15-259/15-281.
// https://www.figma.com/design/73KXHiJcCoHRsR5XK54kQ7/Dancify-Roller-Rink-Redesign
export default function App() {
  const [wearable] = useState(() => new WearableClient());
  const menu = useRef(new MenuNavigation());
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const menuRoot = () => root.current?.querySelector<HTMLElement>('dialog[open]') ?? root.current;
  useEffect(() => {
    const unsubscribe = wearable.subscribe(event => {
      const scope = menuRoot();
      if (!scope || document.hidden) return;
      if (event.type === 'navigate') menu.current.move(scope, event.direction === 'up' || event.direction === 'left' ? -1 : 1);
      if (event.type === 'activate') menu.current.activate(scope);
    });
    return () => { unsubscribe(); wearable.disconnect(); };
  }, [wearable]);
  const [screen, setScreen] = useState<Screen>('main');
  const [songs, setSongs] = useState<Song[]>([]);
  const [selected, setSelected] = useState('');
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(true);
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
  const refresh = useCallback(async () => {
    setLibraryLoading(true);
    try { const list = await api.listSongs(); if (mounted.current) setSongs(list); }
    finally { if (mounted.current) setLibraryLoading(false); }
  }, []);
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
  useEffect(() => { if (!bundle) heading.current?.focus(); }, [screen, bundle]);
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
  const navigate = (destination: Screen) => {
    request.current?.abort(); setSelected(''); selectedRef.current = ''; setBundle(null); setLoading(false);
    setHistory([]); setError(''); setScreen(destination); window.scrollTo(0, 0);
  };
  const active = songs.find(s => s.id === selected);
  const job = preparation.job;
  const activeJob = job && (job.status === 'queued' || job.status === 'processing');
  return <main ref={root} className="app-shell" onClickCapture={event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-controller]');
    if (button && !button.disabled && !document.hidden) wearable.selectionFeedback();
  }} onKeyDown={event => {
    if (event.ctrlKey || event.altKey || event.metaKey || (event.target as HTMLElement).closest('input, textarea, select, video, [contenteditable="true"]')) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault(); const scope = menuRoot(); if (scope) menu.current.move(scope, event.key === 'ArrowUp' ? -1 : 1);
    }
  }}>
    <header className="site-header"><span className="wordmark">Dancify</span><span className="header-note">Find your rhythm</span>
      {!bundle && screen !== 'main' && <button className="quiet" data-controller onClick={() => navigate('main')}>Main menu</button>}
    </header>
    {error && <div className="service-error" role="alert"><p>{error}</p><button data-controller onClick={() => void act(refresh)} disabled={busy}>Retry connection</button></div>}
    {!bundle && <div className={`page page-${screen}`}>
      <div className="page-heading"><p className="eyebrow">{screen === 'main' ? 'The dance floor is yours' : screen === 'library' ? 'Pick your next dance' : 'Bring your own beat'}</p>
        <h1 ref={heading} tabIndex={-1}>{screen === 'main' ? 'Main menu' : screen === 'library' ? 'Choose a song' : 'Prepare a song'}</h1>
      </div>
      {screen === 'main' && <section className="main-menu" aria-label="Main menu actions">
        <p className="menu-intro">Your music. Your moves.</p>
        <div className="menu-actions"><button className="primary menu-button" data-controller onClick={() => navigate('library')}>Choose a song</button>
          <button className="menu-button" data-controller onClick={() => navigate('prepare')}>Import video</button></div>
        <p className="menu-note">A camera, some room, and a song you love.<br />No controller needed to get started.</p>
      </section>}
      <section hidden={screen !== 'prepare'} className="panel prepare-panel" aria-label="Prepare a song">
        <form onSubmit={create}>
          <label>Song title <input required maxLength={256} value={title} onChange={e => setTitle(e.target.value)} placeholder="Name your dance" /></label>
          <label>Source <select aria-label="Source" value={source} onChange={e => { setSource(e.target.value as 'url' | 'upload'); setFile(null); }}><option value="url">Video URL</option><option value="upload">Upload video with music</option></select></label>
          {source === 'url' ? <label key="url">Video URL <input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></label> : <label key="upload">Video file <input type="file" accept="video/*" required onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>}
          <p className="help">Choose a continuous solo-dancer clip with music. Uploading bypasses download failures; timing and tracking checks still apply.</p>
          <fieldset><legend>Optional choreography range (seconds)</legend><div className="field-pair">
            <label>Start time <input type="number" min="0" step="0.1" value={start} onChange={e => setStart(e.target.value)} /></label>
            <label>End time <input type="number" min="0.1" step="0.1" value={end} onChange={e => setEnd(e.target.value)} /></label>
          </div></fieldset>
          <button className="primary wide" data-controller disabled={busy || !!activeJob}>Create and prepare</button>
        </form>
        {job && <section className="preparation-status" aria-label="Preparation progress">
          <p role="status">Preparation: {job.status} · {job.stage}</p>
          {activeJob && <progress aria-label="Preparing video" />}
          {job.error_code && <p role="alert">{preparationHelp[job.error_code]} {job.error_message}</p>}
          {job.has_diagnostic_video && <p><a href={api.artifact(job, 'diagnostic-video')} target="_blank" rel="noreferrer">View tracking diagnostic video</a></p>}
          {job.has_diagnostic && <p><a href={api.artifact(job, 'diagnostic')} target="_blank" rel="noreferrer">Tracking details</a></p>}
          {job.status === 'failed' && <div className="action-row"><button data-controller disabled={busy} onClick={() => void act(async () => preparation.watch(await api.retry(job)))}>Retry preparation</button><button data-controller onClick={() => setSource('upload')}>Use upload fallback</button></div>}
          {preparation.error && <p role="alert">Polling stopped: {preparation.error} <button data-controller onClick={() => preparation.watch(job)}>Reconnect to preparation</button></p>}
        </section>}
        {loading && <p role="status">Loading prepared bundle…</p>}
      </section>
      <section hidden={screen !== 'library'} className="library-panel" aria-label="Song library">
        <div className="library-toolbar"><p>{songs.length} {songs.length === 1 ? 'song' : 'songs'} in your library</p><div className="action-row"><button data-controller className="quiet" onClick={() => void act(refresh)} disabled={busy || libraryLoading}>Refresh songs</button><button data-controller onClick={() => navigate('prepare')}>Import video</button></div></div>
        {libraryLoading && <p role="status">Loading songs…</p>}
        {!libraryLoading && songs.length === 0 && <div className="empty-state"><h2>Your dance floor is waiting</h2><p>Import your first video to start a song collection.</p></div>}
        <ul className="song-list">{songs.map((song, index) => <li key={song.id} className={selected === song.id ? 'selected' : ''}>
          <span className="song-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <button className="song-choice" data-controller aria-pressed={selected === song.id} onClick={() => select(song)}>{song.title}</button>
          <span className="song-status">{song.status === 'ready' && (!song.has_report || !song.active_bundle_id) ? 'Needs regeneration' : song.status}{song.duration ? ` · ${Math.ceil(song.duration)}s` : ''}</span>
        </li>)}</ul>
        {active && <div className="panel"><h2>{active.title}</h2><div className="action-row"><button data-controller disabled={busy || !!activeJob} onClick={() => { setScreen('prepare'); void act(async () => preparation.watch(await api.prepare(active.id, options()))); }}>Prepare selected song / new range</button><button data-controller disabled={loading || active.status !== 'ready'} onClick={() => void load(active.id)}>Load latest prepared bundle</button></div></div>}
        {loading && <p role="status">Loading prepared bundle…</p>}
      </section>
      {selected && history.length > 0 && <section className="panel" aria-label="Play history"><h2>Play history</h2><ul>{history.map(play => <li key={play.id}>{play.player_name}: {play.score} · {play.mode === 'keyboard_practice' ? 'Legacy practice result' : 'Camera'} · {play.played_at}</li>)}</ul></section>}
      {pending.length > 0 && <section className="panel" aria-label="Pending results"><h2>History waiting to sync</h2><p>Your completed scores are available even when saving fails.</p>
        {pending.map(item => <p key={item.result.client_session_id}>{item.result.player_name}: {item.result.score}{' '}
          <button data-controller disabled={sending === item.result.client_session_id} onClick={() => { setSending(item.result.client_session_id); void act(async () => { await outbox.send(item); setPending(outbox.list()); }).finally(() => setSending(null)); }}>Retry pending result</button></p>)}
      </section>}
    </div>}
    {bundle && <GamePanel key={bundle.id} bundle={bundle} wearable={wearable} outbox={outbox} onResult={() => setPending(outbox.list())} onChooseSong={() => navigate('library')} onMainMenu={() => navigate('main')} />}
    <footer className="site-footer"><WearablePanel wearable={wearable} /><p>Camera tracking stays on this device.</p></footer>
  </main>;
}
