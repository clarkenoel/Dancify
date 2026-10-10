/** Fake Phase-1 transport. Future Web Bluetooth calls belong only in this file. */
export type WearableEvent = { type: 'navigate'; direction: 'up' | 'down' | 'left' | 'right' } | { type: 'togglePlayback' };
export class WearableClient {
  private listeners = new Set<(event: WearableEvent) => void>();
  subscribe(listener: (event: WearableEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  simulate(event: WearableEvent) { for (const listener of this.listeners) listener(event); }
  dispose() { this.listeners.clear(); }
}
