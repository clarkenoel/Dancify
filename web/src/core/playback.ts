import { GameSession } from './session';

/** Rendering/inference schedulers are never gameplay clocks. */
export class PlaybackController {
  private frame = 0;
  private replaying = false;
  private disposed = false;
  private compatible = true;
  private handlers: [string, EventListener][] = [];
  constructor(readonly video: HTMLVideoElement, readonly session: GameSession, private onChange: () => void, private onError: (message: string) => void) {
    this.listen('playing', () => { if (!this.compatible) { video.pause(); return; } session.play(); onChange(); });
    this.listen('pause', () => { session.pause(); onChange(); });
    this.listen('waiting', () => { session.pause(); onChange(); });
    this.listen('seeking', () => { session.pause(); if (!this.replaying) session.seek(video.currentTime); onChange(); });
    this.listen('seeked', () => { this.replaying = false; if (!video.paused) session.play(); onChange(); });
    this.listen('ended', () => { session.finish(); onChange(); });
    this.listen('error', () => { session.pause(); onError('This video could not be played. Prepare it again or upload a compatible clip.'); });
    const checkMedia = () => {
      if (!Number.isFinite(video.duration) || Math.abs(video.duration - session.chart.duration) > 0.25) {
        this.compatible = false;
        session.pause(); video.pause(); onError('Video duration does not match this chart. Prepare the song again.');
      }
    };
    this.listen('loadedmetadata', checkMedia);
    if (video.readyState >= 1) checkMedia();
    const tick = () => {
      if (this.disposed) return;
      if (!video.paused && !video.seeking && video.readyState >= 2) { session.tick(video.currentTime); onChange(); }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
  private listen(type: string, fn: () => void) {
    this.video.addEventListener(type, fn); this.handlers.push([type, fn]);
  }
  async toggle() {
    if (!this.compatible) throw new Error('This video is incompatible with its chart.');
    if (this.video.paused) await this.video.play(); else this.video.pause();
  }
  async replay() {
    if (!this.compatible) throw new Error('This video is incompatible with its chart.');
    this.video.pause(); this.session.reset(); this.replaying = true;
    if (this.video.currentTime !== 0) this.video.currentTime = 0; else this.replaying = false;
    this.onChange(); await this.video.play();
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame);
    for (const [type, handler] of this.handlers) this.video.removeEventListener(type, handler);
    this.video.pause(); this.session.pause();
  }
}
