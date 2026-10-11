import { expect, it, vi } from 'vitest';
import { DancifyApi, pollPreparation } from '../src/core/api';
import { ResultOutbox } from '../src/core/outbox';
import { GameSession } from '../src/core/session';
import { chart, report } from './fixtures';
import type { Preparation } from '../src/core/types';

it('deletes a song using its escaped ID and accepts an empty 204 response', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
  await expect(new DancifyApi('http://api', fetcher).deleteSong('song/one')).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenCalledWith('http://api/songs/song%2Fone', { method: 'DELETE', cache: 'no-store' });
});

it('preserves the server deletion error so the library can show it without removing the song', async () => {
  const fetcher = vi.fn(async () => Response.json({ detail: 'Could not delete song' }, { status: 500 }));
  await expect(new DancifyApi('http://api', fetcher).deleteSong('song')).rejects.toThrow('Could not delete song');
});

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
  const session = new GameSession(chart()); session.finish();
  const item = first.enqueue('song', session.result('bundle', 'Ada'));
  await expect(first.send(item)).rejects.toThrow();
  const restored = new ResultOutbox(api, adapter); expect(restored.list()).toEqual([item]);
  await restored.send(restored.list()[0]);
  expect(fetcher.mock.calls[0][1].body).toEqual(fetcher.mock.calls[1][1].body);
  expect(restored.list()).toHaveLength(0);
});

it('explains unreachable service failures for file uploads without retrying them', async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  const api = new DancifyApi('http://127.0.0.1:8001', fetcher);
  await expect(api.upload('Dance', new File(['video'], 'dance.mp4', { type: 'video/mp4' })))
    .rejects.toThrow('Cannot reach the local song service at http://127.0.0.1:8001');
  expect(fetcher).toHaveBeenCalledTimes(1);
  const body = fetcher.mock.calls[0][1].body as FormData;
  expect(body.get('title')).toBe('Dance');
  expect((body.get('video') as File).name).toBe('dance.mp4');
});

it('keeps aborts and HTTP upload errors distinct from connection failures', async () => {
  const abort = new DOMException('Aborted', 'AbortError');
  await expect(new DancifyApi('http://api', vi.fn().mockRejectedValue(abort)).listSongs()).rejects.toBe(abort);
  const fetcher = vi.fn().mockResolvedValue(Response.json({ detail: 'Video is too large' }, { status: 413 }));
  await expect(new DancifyApi('http://api', fetcher).upload('Dance', new File(['video'], 'dance.mp4')))
    .rejects.toMatchObject({ status: 413, message: 'Video is too large' });
});
