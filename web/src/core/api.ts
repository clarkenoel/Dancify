import type { Bundle, Play, PlayInput, Preparation, PreparationOptions, Song } from './types';
import { CompatibilityError, validateChart, validateReport } from './validation';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class ApiConnectionError extends Error {
  constructor(base: string) {
    super(`Cannot reach the local song service at ${base}. File uploads also need this service. Check that the backend is running and VITE_DANCIFY_API_URL matches its port, then restart Vite if you changed that setting. Open the app at http://localhost:5173 or http://127.0.0.1:5173; other origins may be blocked by CORS. The browser could not confirm whether the request reached the service; refresh songs before retrying an upload.`);
    this.name = 'ApiConnectionError';
  }
}

export class DancifyApi {
  readonly base: string;
  constructor(base = import.meta.env.VITE_DANCIFY_API_URL || 'http://127.0.0.1:8000', private fetcher: typeof fetch = (...args) => globalThis.fetch(...args)) {
    this.base = base.replace(/\/$/, '');
  }
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${path}`, { ...init, cache: 'no-store' });
    } catch (error) {
      if (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      if (error instanceof TypeError) throw new ApiConnectionError(this.base);
      throw error;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const detail = typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status})`;
      throw new ApiError(response.status, detail);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
  listSongs(signal?: AbortSignal) { return this.request<Song[]>('/songs', { signal }); }
  deleteSong(id: string) { return this.request<void>(`/songs/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  song(id: string, signal?: AbortSignal) { return this.request<Song>(`/songs/${encodeURIComponent(id)}`, { signal }); }
  private json(method: string, body: unknown, signal?: AbortSignal): RequestInit {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal };
  }
  createUrl(title: string, source_url: string, signal?: AbortSignal) {
    const url = new URL(source_url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS video URL without credentials.');
    return this.request<Song>('/songs/json', this.json('POST', { title, source_url }, signal));
  }
  upload(title: string, file: File, signal?: AbortSignal) {
    const body = new FormData(); body.set('title', title); body.set('video', file);
    return this.request<Song>('/songs', { method: 'POST', body, signal });
  }
  prepare(id: string, options: PreparationOptions, signal?: AbortSignal) {
    return this.request<Preparation>(`/songs/${id}/preparations`, this.json('POST', options, signal));
  }
  job(songId: string, jobId: string, signal?: AbortSignal) {
    return this.request<Preparation>(`/songs/${songId}/preparations/${jobId}`, { signal });
  }
  retry(job: Preparation, signal?: AbortSignal) {
    return this.request<Preparation>(`/songs/${job.song_id}/preparations/${job.id}/retry`, { method: 'POST', signal });
  }
  artifact(job: Preparation, asset: 'report' | 'diagnostic' | 'diagnostic-video') {
    return `${this.base}/songs/${job.song_id}/preparations/${job.id}/${asset}`;
  }
  async bundle(songId: string, signal?: AbortSignal): Promise<Bundle> {
    const song = await this.song(songId, signal);
    if (song.status !== 'ready' || !song.active_bundle_id || !song.has_video || !song.has_chart || !song.has_audio || !song.has_report) {
      throw new CompatibilityError('Prepare this song with the current pipeline before playing.');
    }
    const id = song.active_bundle_id;
    const path = `/songs/${songId}/bundles/${id}`;
    const [rawChart, rawReport] = await Promise.all([this.request<unknown>(`${path}/chart`, { signal }), this.request<unknown>(`${path}/report`, { signal })]);
    const chart = validateChart(rawChart);
    const report = validateReport(rawReport, chart, songId, id);
    return { song, id, chart, report, videoUrl: `${this.base}${path}/video`, audioUrl: `${this.base}${path}/audio` };
  }
  plays(id: string, signal?: AbortSignal) { return this.request<Play[]>(`/songs/${id}/plays`, { signal }); }
  savePlay(songId: string, result: PlayInput) {
    // The backend deduplicates client_session_id, including an ambiguous retry.
    return this.request<Play>(`/songs/${songId}/plays`, this.json('POST', result));
  }
}

export const preparationHelp = {
  download_failed: 'The source could not be downloaded. Upload a video file with its music, or retry after configuring source access.',
  unsupported_media: 'Use a readable video containing its intended music.',
  timing_required: 'No reliable music timing was found. Choose a clip with audible music.',
  tracking_failed: 'A stable solo dancer could not be tracked. Inspect the diagnostic video and choose a cleaner clip or time range.',
  validation_failed: 'The generated bundle is incompatible. Keep the previous song and report this preparation failure.',
  internal: 'Preparation could not finish. Check the local service and retry.',
  interrupted: 'Preparation was interrupted. Retry to start another job.',
} as const;

export async function pollPreparation(api: DancifyApi, initial: Preparation, onChange: (job: Preparation) => void, signal: AbortSignal, interval = 1000) {
  let job = initial;
  while (!signal.aborted) {
    onChange(job);
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, interval);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    job = await api.job(job.song_id, job.id, signal);
  }
  throw new DOMException('Aborted', 'AbortError');
}
