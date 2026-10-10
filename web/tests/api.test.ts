import { expect, it, vi } from 'vitest';
import { DancifyApi, pollPreparation } from '../src/core/api';
import { ResultOutbox } from '../src/core/outbox';
import { GameSession } from '../src/core/session';
import { chart, report } from './fixtures';
import type { Preparation } from '../src/core/types';

it('pins all bundle requests to the selected generation', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith('/songs/song')) return Response.json({ status: 'ready', active_bundle_id: 'bundle', has_video: true, has_audio: true, has_chart: true, has_report: true });
    if (u.endsWith('/chart')) return Response.json(chart());
    return Response.json(report());
  });
  const b = await new DancifyApi('http://api', fetcher).bundle('song');
  expect(b.videoUrl).toBe('http://api/songs/song/bundles/bundle/video');
  expect(fetcher.mock.calls.map(c => c[0])).toEqual(['http://api/songs/song', 'http://api/songs/song/bundles/bundle/chart', 'http://api/songs/song/bundles/bundle/report']);
});
it('aborting polling stops new requests while leaving the server job intact', async () => {
  const fetcher = vi.fn(); const api = new DancifyApi('http://api', fetcher);
  const controller = new AbortController();
  const job = { id: 'job', song_id: 'song', status: 'processing' } as Preparation;
  const promise = pollPreparation(api, job, () => {}, controller.signal, 1000);
  controller.abort(); await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('keeps exact result payload and session key after ambiguous network failure and reload', async () => {
  const storage = new Map<string, string>();
  const adapter = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); } };
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('connection dropped')).mockResolvedValueOnce(Response.json({ id: 'saved' }));
  const api = new DancifyApi('http://api', fetcher);
  const first = new ResultOutbox(api, adapter);
  const session = new GameSession(chart(), 'keyboard_practice'); session.finish();
  const item = first.enqueue('song', session.result('bundle', 'Ada'));
  await expect(first.send(item)).rejects.toThrow();
  const restored = new ResultOutbox(api, adapter); expect(restored.list()).toEqual([item]);
  await restored.send(restored.list()[0]);
  expect(fetcher.mock.calls[0][1].body).toEqual(fetcher.mock.calls[1][1].body);
  expect(restored.list()).toHaveLength(0);
});
