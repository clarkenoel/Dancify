/** Presentation audio only. Reference video.currentTime remains the gameplay clock. */
export type SoundEvent = 'menuMove' | 'select' | 'miss' | 'win' | 'lose' | 'milestone' | 'countdown';
export type SoundUrls = Partial<Record<SoundEvent | 'loading', string>>;

interface GainHandle {
  gain: { value: number };
  connect(destination: unknown): unknown;
  disconnect(): void;
}
interface SourceHandle {
  buffer: AudioBuffer | null;
  loop: boolean;
  onended: ((event: Event) => unknown) | null;
  connect(destination: unknown): unknown;
  disconnect(): void;
  start(): void;
  stop(): void;
}
export interface SoundContext {
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  createBufferSource(): SourceHandle;
  createGain(): GainHandle;
}
export interface SoundEffectsOptions {
  urls: SoundUrls;
  volume?: number;
  /** Per-asset gain multiplier; does not modify the supplied recordings. */
  eventVolumes?: Partial<Record<SoundEvent | 'loading', number>>;
  createContext?: () => SoundContext;
  fetchAudio?: (url: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  /** Only used to reject late UI sounds, never to advance gameplay. */
  now?: () => number;
}
interface Voice { source: SourceHandle; gain: GainHandle; level: number }

const MAX_IDS = 512;
const MAX_CUE_DELAY_MS = 1000;

export class SoundEffects {
  private context: SoundContext | null = null;
  private unlocking: Promise<boolean> | null = null;
  private disposed = false;
  private enabled = true;
  private volume: number;
  private sequence = 0;
  private loadingSequence = 0;
  private loading = false;
  private effect: Voice | null = null;
  private music: Voice | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly ids = new Set<string>();
  private readonly downloads = new AbortController();
  private readonly urls: SoundUrls;
  private readonly now: () => number;

  constructor(private readonly options: SoundEffectsOptions) {
    this.urls = { ...options.urls };
    this.volume = this.clampVolume(options.volume ?? 0.3);
    this.now = options.now ?? Date.now;
  }

  /** Call directly from a click/key/Bluetooth-chooser gesture. Failures are nonfatal. */
  unlock(): Promise<boolean> {
    if (this.disposed || !this.enabled) return Promise.resolve(false);
    if (this.unlocking) return this.unlocking;
    try {
      this.context ??= this.options.createContext?.() ?? new AudioContext();
      const context = this.context;
      // Resume is invoked synchronously while the real user activation is present.
      this.unlocking = context.resume().then(() => {
        if (this.disposed || !this.enabled || context.state !== 'running') return false;
        for (const url of Object.values(this.urls)) if (url) void this.load(url);
        return true;
      }).catch(() => false).finally(() => { this.unlocking = null; });
      return this.unlocking;
    } catch {
      return Promise.resolve(false);
    }
  }

  /** Optional IDs identify actual actions/judgments, not React render passes. */
  async play(event: SoundEvent, id?: string): Promise<boolean> {
    if (this.disposed || !this.enabled || !this.context) return false;
    // Also stop when this response has no configured asset (for example results).
    if (!['menuMove', 'select'].includes(event)) void this.setLoading(false);
    const url = this.urls[event];
    if (!url) return false;
    const key = id === undefined ? null : `${event}:${id}`;
    if (key !== null && this.ids.has(key)) return false;
    if (key !== null) {
      this.ids.add(key);
      if (this.ids.size > MAX_IDS) this.ids.delete(this.ids.values().next().value!);
    }
    const sequence = ++this.sequence;
    const requestedAt = this.now();
    this.stopVoice(this.effect);
    this.effect = null;
    if (this.unlocking) await this.unlocking;
    const buffer = await this.load(url);
    if (!buffer || this.disposed || !this.enabled || sequence !== this.sequence ||
      this.context.state !== 'running' || this.now() - requestedAt > MAX_CUE_DELAY_MS) return false;
    this.effect = this.startVoice(buffer, false, event);
    return this.effect !== null;
  }

  /** Call false before gameplay, pause, navigation, results, or leaving preparation. */
  async setLoading(loading: boolean): Promise<boolean> {
    if (!loading) {
      this.loading = false;
      ++this.loadingSequence;
      this.stopVoice(this.music);
      this.music = null;
      return false;
    }
    if (this.disposed || !this.enabled || !this.context || !this.urls.loading) return false;
    if (this.loading) return this.music !== null;
    this.loading = true;
    const sequence = ++this.loadingSequence;
    if (this.unlocking) await this.unlocking;
    const buffer = await this.load(this.urls.loading);
    if (this.disposed || !this.enabled || !this.loading || sequence !== this.loadingSequence) return false;
    if (!buffer || this.context.state !== 'running') {
      this.loading = false;
      return false;
    }
    this.music = this.startVoice(buffer, true, 'loading');
    if (!this.music) this.loading = false;
    return this.music !== null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  setVolume(volume: number): void {
    this.volume = this.clampVolume(volume);
    for (const voice of [this.effect, this.music]) if (voice) voice.gain.gain.value = this.volume * voice.level;
  }

  /** Stops active and pending audio; a later explicit action can play again. */
  stop(): void {
    ++this.sequence;
    this.stopVoice(this.effect);
    this.effect = null;
    void this.setLoading(false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.downloads.abort();
    this.buffers.clear();
    this.ids.clear();
    try { void this.context?.close().catch(() => {}); } catch { /* Already closed. */ }
  }

  private clampVolume(volume: number): number {
    return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.3;
  }

  private load(url: string): Promise<AudioBuffer | null> {
    if (this.disposed || !this.context) return Promise.resolve(null);
    const cached = this.buffers.get(url);
    if (cached) return cached;
    const context = this.context;
    const fetchAudio = this.options.fetchAudio ?? (async (path: string, signal: AbortSignal) => {
      const response = await fetch(path, { signal });
      if (!response.ok) throw new Error(`Audio unavailable: ${response.status}`);
      return response.arrayBuffer();
    });
    const pending = Promise.resolve().then(() => fetchAudio(url, this.downloads.signal))
      .then(data => this.disposed ? null : context.decodeAudioData(data))
      .catch(() => { this.buffers.delete(url); return null; });
    this.buffers.set(url, pending);
    return pending;
  }

  private startVoice(buffer: AudioBuffer, loop: boolean, event: SoundEvent | 'loading'): Voice | null {
    let voice: Voice | null = null;
    let source: SourceHandle | null = null;
    let gain: GainHandle | null = null;
    try {
      source = this.context!.createBufferSource();
      gain = this.context!.createGain();
      const level = this.clampVolume(this.options.eventVolumes?.[event] ?? 1);
      voice = { source, gain, level };
      source.buffer = buffer;
      source.loop = loop;
      gain.gain.value = this.volume * level;
      source.connect(gain);
      gain.connect(this.context!.destination);
      source.onended = () => {
        this.stopVoice(voice);
        if (this.effect === voice) this.effect = null;
        if (this.music === voice) { this.music = null; this.loading = false; }
      };
      source.start();
      return voice;
    } catch {
      if (voice) this.stopVoice(voice);
      else {
        try { source?.disconnect(); } catch { /* Partial allocation. */ }
        try { gain?.disconnect(); } catch { /* Partial allocation. */ }
      }
      return null;
    }
  }

  private stopVoice(voice: Voice | null): void {
    if (!voice) return;
    voice.source.onended = null;
    try { voice.source.stop(); } catch { /* The node may already have ended. */ }
    try { voice.source.disconnect(); } catch { /* Detached node. */ }
    try { voice.gain.disconnect(); } catch { /* Detached gain. */ }
  }
}
