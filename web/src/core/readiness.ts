/** Framing readiness is not player identity or multi-person detection. */
export class BodyReadiness {
  private since: number | null = null;
  private last: number | null = null;
  ready = false;
  reset() { this.since = null; this.last = null; this.ready = false; }
  isReady(now: number) { return this.ready && this.last !== null && now - this.last <= 2500; }
  update(fullBody: boolean, now: number) {
    if (!fullBody) { this.reset(); return false; }
    if (this.last !== null && (now < this.last || now - this.last > 2500)) this.reset();
    this.last = now;
    this.since ??= now;
    this.ready = now - this.since >= 1000;
    return this.ready;
  }
}
