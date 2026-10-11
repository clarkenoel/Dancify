import type { Dance } from './types';
import type { SessionSnapshot } from './session';
import type { WearableClient } from './WearableClient';

/** The video is the only beat clock. This class never changes scores or poses. */
export class WearableFeedback {
  private running = false;
  private sessionId = '';
  private epoch = -1;
  private seen = new Set<string>();
  private lastTime = 0;
  private lastSync = 0;
  private lastObservation = 0;
  private handlers: [string, EventListener][] = [];
  constructor(private video: HTMLVideoElement, private chart: Dance, private wearable: WearableClient,
    private hidden: () => boolean = () => document.hidden, private now: () => number = () => performance.now(),
    private metronomeEnabled = true) {
    for (const type of ['pause', 'waiting', 'seeking', 'ended', 'error', 'ratechange']) {
      const handler = () => this.stop();
      video.addEventListener(type, handler); this.handlers.push([type, handler]);
    }
  }
  private delay = () => {
    if (!this.running || this.hidden() || this.video.paused || this.video.seeking || this.video.playbackRate !== 1) return null;
    const time = this.video.currentTime;
    const beat = this.chart.beat_times.find(beat => beat >= time);
    return beat === undefined ? null : beat - time;
  };
  update(snapshot: SessionSnapshot) {
    const time = this.video.currentTime;
    const now = this.now();
    const changed = this.sessionId !== snapshot.sessionId || this.epoch !== snapshot.epoch;
    // Discontinuities/scheduler suspension must not replay accumulated hits.
    const gap = time - this.lastTime > 1.5 || time < this.lastTime || now - this.lastObservation > 1500;
    if (this.sessionId !== snapshot.sessionId) this.seen.clear();
    this.sessionId = snapshot.sessionId; this.epoch = snapshot.epoch;
    this.lastTime = time; this.lastObservation = now;
    const fresh = snapshot.results.filter(result => !this.seen.has(result.id));
    for (const result of fresh) this.seen.add(result.id);
    const enabled = this.metronomeEnabled && this.wearable.snapshot().status === 'connected' && snapshot.playing && !snapshot.ended &&
      !this.hidden() && !this.video.paused && !this.video.seeking && this.video.readyState >= 2 && this.video.playbackRate === 1 &&
      this.chart.beat_times.some(beat => beat >= time);
    if (!enabled) { this.stop(); return; }
    if (!this.running || changed || gap) {
      this.running = true; this.lastSync = time;
      this.wearable.startFeedback(this.chart.bpm, this.delay);
      return;
    }
    if (time - this.lastSync >= 5) { this.lastSync = time; this.wearable.syncFeedback(this.delay); }
    for (const result of fresh) {
      if (['GOOD', 'SUPER', 'PERFECT'].includes(result.judgment)) this.wearable.hitFeedback();
    }
  }
  stop() {
    if (!this.running) return;
    this.running = false; this.wearable.stopFeedback();
  }
  dispose() {
    this.stop();
    for (const [type, handler] of this.handlers) this.video.removeEventListener(type, handler);
  }
}
