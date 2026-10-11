import { describe, expect, it, vi } from 'vitest';
import { SoundEffects, type SoundContext } from '../src/audio/SoundEffects';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(options: { fetchAudio?: (url: string, signal: AbortSignal) => Promise<ArrayBuffer>; now?: () => number; eventVolumes?: { select?: number } } = {}) {
  const voices: Array<{ buffer: AudioBuffer | null; loop: boolean; onended: ((event: Event) => unknown) | null;
    connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  const gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const context: SoundContext = {
    state: 'running', destination: {}, resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => ({}) as AudioBuffer),
    createBufferSource: () => {
      const voice = { buffer: null, loop: false, onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      voices.push(voice);
      return voice;
    },
    createGain: () => {
      const gain = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
      gains.push(gain);
      return gain;
    },
  };
  const createContext = vi.fn(() => context);
  const fetchAudio = options.fetchAudio ?? vi.fn(async () => new ArrayBuffer(0));
  const sound = new SoundEffects({
    urls: { menuMove: '/move.mp3', select: '/select.mp3', loading: '/loading.mp3', win: '/win.mp3' },
    createContext, fetchAudio, now: options.now, eventVolumes: options.eventVolumes,
  });
  return { sound, context, voices, gains, createContext, fetchAudio };
}

describe('presentation audio lifecycle', () => {
  it('creates no audio context or pending playback before a real unlock action', async () => {
    const { sound, createContext } = setup();
    expect(await sound.play('select')).toBe(false);
    expect(await sound.setLoading(true)).toBe(false);
    expect(createContext).not.toHaveBeenCalled();
    expect(await sound.unlock()).toBe(true);
    expect(await sound.play('select')).toBe(true);
  });

  it('resumes synchronously within user activation and catches autoplay rejection', async () => {
    const { sound, context, voices } = setup();
    vi.mocked(context.resume).mockRejectedValueOnce(new Error('NotAllowedError'));
    const pending = sound.unlock();
    expect(context.resume).toHaveBeenCalledOnce();
    expect(await pending).toBe(false);
    expect(voices).toHaveLength(0);
    expect(await sound.unlock()).toBe(true);
  });

  it('deduplicates action IDs while permitting distinct actions and bounded polyphony', async () => {
    const { sound, voices, gains } = setup();
    await sound.unlock();
    expect(await sound.play('menuMove', 'step-1')).toBe(true);
    expect(await sound.play('menuMove', 'step-1')).toBe(false);
    expect(voices).toHaveLength(1);
    expect(await sound.play('menuMove', 'step-2')).toBe(true);
    expect(voices[0].stop).toHaveBeenCalledOnce();
    expect(gains[0].disconnect).toHaveBeenCalledOnce();
    expect(voices[1].stop).not.toHaveBeenCalled();
  });

  it('loads a shared URL only once and ignores unconfigured events', async () => {
    const { sound, fetchAudio } = setup();
    await sound.unlock();
    await sound.play('menuMove');
    await sound.play('menuMove');
    expect(vi.mocked(fetchAudio).mock.calls.filter(([url]) => url === '/move.mp3')).toHaveLength(1);
    expect(await sound.play('miss')).toBe(false);
  });

  it('does not restart a loading loop on rerender and stops it before a response', async () => {
    const { sound, voices } = setup();
    await sound.unlock();
    expect(await sound.setLoading(true)).toBe(true);
    expect(await sound.setLoading(true)).toBe(true);
    expect(voices).toHaveLength(1);
    expect(voices[0].loop).toBe(true);
    expect(await sound.play('win', 'round-1')).toBe(true);
    expect(voices[0].stop).toHaveBeenCalledOnce();
    expect(voices[1].loop).toBe(false);
  });

  it('cancels a loading request when gameplay or navigation has already stopped it', async () => {
    const loading = deferred<ArrayBuffer>();
    const { sound, voices } = setup({ fetchAudio: async url => url === '/loading.mp3' ? loading.promise : new ArrayBuffer(0) });
    await sound.unlock();
    const pending = sound.setLoading(true);
    await sound.setLoading(false);
    loading.resolve(new ArrayBuffer(0));
    expect(await pending).toBe(false);
    expect(voices).toHaveLength(0);
  });

  it('stops preparation music even when the next event has no supplied sound file', async () => {
    const { sound, voices } = setup();
    await sound.unlock();
    await sound.setLoading(true);
    expect(await sound.play('lose')).toBe(false);
    expect(voices[0].stop).toHaveBeenCalledOnce();
  });

  it('serializes unlock attempts and cannot play after disposal during unlock', async () => {
    const resume = deferred<void>();
    const { sound, context, voices } = setup();
    vi.mocked(context.resume).mockReturnValueOnce(resume.promise);
    const first = sound.unlock();
    expect(sound.unlock()).toBe(first);
    const play = sound.play('select');
    sound.dispose();
    resume.resolve();
    expect(await first).toBe(false);
    expect(await play).toBe(false);
    expect(voices).toHaveLength(0);
  });

  it('discards superseded requests rather than playing a burst after slow downloads', async () => {
    const move = deferred<ArrayBuffer>();
    const { sound, voices } = setup({ fetchAudio: async url => url === '/move.mp3' ? move.promise : new ArrayBuffer(0) });
    await sound.unlock();
    const pending = sound.play('menuMove', 'old');
    expect(await sound.play('select', 'new')).toBe(true);
    move.resolve(new ArrayBuffer(0));
    expect(await pending).toBe(false);
    expect(voices).toHaveLength(1);
  });

  it('drops very late one-shots without changing any gameplay clock', async () => {
    let now = 0;
    const move = deferred<ArrayBuffer>();
    const { sound, voices } = setup({ now: () => now, fetchAudio: async url => url === '/move.mp3' ? move.promise : new ArrayBuffer(0) });
    await sound.unlock();
    const pending = sound.play('menuMove');
    now = 2000;
    move.resolve(new ArrayBuffer(0));
    expect(await pending).toBe(false);
    expect(voices).toHaveLength(0);
  });

  it('handles network/decode failures without rejecting playback promises', async () => {
    const { sound, context } = setup({ fetchAudio: async () => { throw new Error('offline'); } });
    await expect(sound.unlock()).resolves.toBe(true);
    await expect(sound.play('select')).resolves.toBe(false);
    await expect(sound.setLoading(true)).resolves.toBe(false);
    expect(context.decodeAudioData).not.toHaveBeenCalled();
    const broken = setup();
    vi.mocked(broken.context.decodeAudioData).mockRejectedValue(new Error('unsupported audio'));
    await broken.sound.unlock();
    await expect(broken.sound.play('select')).resolves.toBe(false);
  });

  it('stops and cancels pending effects when disabled, then requires a new explicit action', async () => {
    const move = deferred<ArrayBuffer>();
    const { sound, voices } = setup({ fetchAudio: async url => url === '/move.mp3' ? move.promise : new ArrayBuffer(0) });
    await sound.unlock();
    await sound.play('select');
    const pending = sound.play('menuMove');
    sound.setEnabled(false);
    move.resolve(new ArrayBuffer(0));
    expect(await pending).toBe(false);
    expect(voices[0].stop).toHaveBeenCalledOnce();
    expect(await sound.play('select')).toBe(false);
    sound.setEnabled(true);
    expect(voices).toHaveLength(1);
    expect(await sound.play('select')).toBe(true);
  });

  it('releases nodes after natural completion and applies safe volume changes', async () => {
    const { sound, voices, gains } = setup();
    await sound.unlock();
    await sound.play('select');
    expect(gains[0].gain.value).toBe(0.3);
    sound.setVolume(5);
    expect(gains[0].gain.value).toBe(1);
    sound.setVolume(-1);
    expect(gains[0].gain.value).toBe(0);
    voices[0].onended!(new Event('ended'));
    expect(gains[0].disconnect).toHaveBeenCalledOnce();
    sound.stop();
    expect(voices[0].stop).toHaveBeenCalledOnce();
  });

  it('retains per-event gain when the shared volume changes', async () => {
    const { sound, gains } = setup({ eventVolumes: { select: 0.25 } });
    await sound.unlock();
    await sound.play('select');
    expect(gains[0].gain.value).toBe(0.075);
    sound.setVolume(0.5);
    expect(gains[0].gain.value).toBe(0.125);
  });

  it('aborts pending downloads, closes once, and never plays after disposal', async () => {
    const download = deferred<ArrayBuffer>();
    const signals: AbortSignal[] = [];
    const { sound, context, voices } = setup({ fetchAudio: async (_url, signal) => { signals.push(signal); return download.promise; } });
    await sound.unlock();
    const pending = sound.play('select');
    sound.dispose();
    sound.dispose();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    download.resolve(new ArrayBuffer(0));
    expect(await pending).toBe(false);
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.decodeAudioData).not.toHaveBeenCalled();
    expect(voices).toHaveLength(0);
    expect(await sound.unlock()).toBe(false);
    expect(await sound.setLoading(true)).toBe(false);
  });
});
