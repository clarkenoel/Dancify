import { GameSession } from './session';

/** Rendering/inference schedulers are never gameplay clocks. */
export class PlaybackController {
  countdown: number | null = null;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private frame = 0;
  private replaying = false;
  private disposed = false;
  private compatible = true;
  private armed = false;
  private autoStartPending: boolean;
  private automaticCountdown = false;
  private handlers: [string, EventListener][] = [];
  constructor(readonly video: HTMLVideoElement, readonly session: GameSession, private onChange: () => void, private onError: (message: string) => void, private canStart: () => boolean = () => true, private requireCountdown = false) {
    this.autoStartPending = requireCountdown;
    this.listen('playing', () => { if (!this.compatible || this.countdown !== null || !this.canStart() || (this.requireCountdown && !this.armed)) { video.pause(); return; } session.play(); onChange(); });
    this.listen('pause', () => { this.armed = false; session.pause(); onChange(); });
    this.listen('waiting', () => { session.pause(); onChange(); });
    this.listen('seeking', () => { if (this.countdown !== null && video.currentTime !== 0) { this.cancelCountdown(); this.replaying = false; } session.pause(); if (!this.replaying) session.seek(video.currentTime); onChange(); });
    this.listen('seeked', () => { this.replaying = false; if (!video.paused) session.play(); onChange(); });
    this.listen('ended', () => { session.finish(); onChange(); });
    this.listen('error', () => { this.cancelCountdown(); session.pause(); onError('This video could not be played. Prepare it again or upload a compatible clip.'); });
    const checkMedia = () => {
      if (!Number.isFinite(video.duration) || Math.abs(video.duration - session.chart.duration) > 0.25) {
        this.compatible = false; this.cancelCountdown();
        session.pause(); video.pause(); onError('Video duration does not match this chart. Prepare the song again.');
      }
    };
    this.listen('loadedmetadata', checkMedia);
    if (video.readyState >= 1) checkMedia();
    const tick = () => {
      if (this.disposed) return;
      if (this.countdown === null && !video.paused && !video.seeking && video.readyState >= 2) { session.tick(video.currentTime); onChange(); }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
  private listen(type: string, fn: () => void) {
    this.video.addEventListener(type, fn); this.handlers.push([type, fn]);
  }
  cancelCountdown() {
    this.autoStartPending = false; this.automaticCountdown = false;
    if (this.countdownTimer !== null) clearTimeout(this.countdownTimer);
    this.countdownTimer = null; this.countdown = null;
    if (!this.disposed) this.onChange();
  }
  get waitingForBody() { return this.autoStartPending; }
  /** Called by live pose observations; readiness never supplies the gameplay clock. */
  observeReadiness() {
    if (this.disposed) return;
    if (this.automaticCountdown && !this.canStart()) {
      this.cancelCountdown(); this.autoStartPending = true; this.onChange();
    }
    if (!this.autoStartPending || this.countdown !== null || !this.video.paused || this.video.readyState < 2 || this.session.snapshot().ended || !this.compatible || !this.canStart()) return;
    this.autoStartPending = false; this.automaticCountdown = true; this.beginCountdown();
  }
  async toggle() {
    this.autoStartPending = false;
    if (this.countdown !== null) { this.cancelCountdown(); return; }
    if (!this.compatible) throw new Error('This video is incompatible with its chart.');
    if (this.video.paused) {
      if (this.requireCountdown) this.beginCountdown();
      else await this.video.play();
    } else this.video.pause();
  }
  async replay() {
    if (!this.compatible) throw new Error('This video is incompatible with its chart.');
    if (this.disposed || this.countdown !== null) return;
    this.video.pause(); this.session.reset(); this.replaying = true;
    if (this.video.currentTime !== 0) this.video.currentTime = 0; else this.replaying = false;
    this.autoStartPending = this.requireCountdown;
    this.onChange();
    if (this.requireCountdown) this.observeReadiness(); else this.beginCountdown();
  }
  private beginCountdown() {
    if (this.disposed || this.countdown !== null) return;
    if (!this.canStart()) { this.onError('Stand alone with your whole body visible, then confirm Ready. If the controller disconnected, choose keyboard controls or reconnect.'); return; }
    this.countdown = 3;
    this.onChange();
    // This timer only delays playback. Video currentTime remains the scoring clock.
    const step = () => {
      if (this.disposed || this.countdown === null) return;
      if (!this.canStart()) {
        const retryWhenReady = this.automaticCountdown;
        this.cancelCountdown(); this.autoStartPending = retryWhenReady; this.onChange();
        if (!retryWhenReady) this.onError('Readiness changed. Check your position and confirm Ready again.');
        return;
      }
      if (this.countdown > 1) {
        this.countdown--; this.onChange();
        this.countdownTimer = setTimeout(step, 1000);
      } else {
        this.countdownTimer = null; this.countdown = null;
        this.automaticCountdown = false;
        this.session.pause(); // Invalidate inference captured before the countdown finished.
        this.armed = true; this.onChange();
        void this.video.play().catch(error => this.onError(error instanceof Error ? error.message : 'Could not start replay. Press play to try again.'));
      }
    };
    this.countdownTimer = setTimeout(step, 1000);
  }
  dispose() {
    this.disposed = true; this.cancelCountdown(); cancelAnimationFrame(this.frame);
    for (const [type, handler] of this.handlers) this.video.removeEventListener(type, handler);
    this.video.pause(); this.session.pause();
  }
}
