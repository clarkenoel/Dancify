import type { PlayInput } from './types';
import { DancifyApi } from './api';

export interface PendingResult { songId: string; result: PlayInput }
/** Persist the exact payload before POST so reloads/retries reuse its session ID. */
export class ResultOutbox {
  private memory: PendingResult[];
  private key: string;
  constructor(private api: DancifyApi, private storage: Pick<Storage, 'getItem' | 'setItem'>) {
    this.key = `dancify-results:${api.base}`;
    try { this.memory = JSON.parse(storage.getItem(this.key) || '[]'); if (!Array.isArray(this.memory)) this.memory = []; }
    catch { this.memory = []; }
  }
  list() { return [...this.memory]; }
  private persist() { this.storage.setItem(this.key, JSON.stringify(this.memory)); }
  enqueue(songId: string, result: PlayInput) {
    const previous = this.memory.find(p => p.result.client_session_id === result.client_session_id);
    if (previous) return previous;
    const item = { songId, result: structuredClone(result) };
    this.memory.push(item);
    try { this.persist(); } catch { this.memory.pop(); throw new Error('Cannot preserve results in browser storage. Enable local storage before saving.'); }
    return item;
  }
  async send(item: PendingResult) {
    const saved = await this.api.savePlay(item.songId, item.result);
    this.memory = this.memory.filter(p => p.result.client_session_id !== item.result.client_session_id);
    try { this.persist(); } catch { /* A retained copy can be safely retried with the same key. */ }
    return saved;
  }
}
