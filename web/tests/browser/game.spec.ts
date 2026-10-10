import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Opt-in integration suite against the isolated development API. Seed it using
// the commands in README.md; no production songs are deleted by these tests.
const api = process.env.DANCIFY_TEST_API || 'http://127.0.0.1:8001';
const cameraFixture = '/tmp/dancify-camera-fixture.y4m';
test.beforeAll(() => {
  const source = path.resolve('../pipeline/testdata/Video_1.mp4');
  if (!existsSync(cameraFixture)) execFileSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-i', source, '-t', '15', '-vf', 'scale=320:180,fps=10', '-pix_fmt', 'yuv420p', cameraFixture]);
});

test('real bundle decodes, pauses, seeks, replays, scores and saves exactly once after a lost response', async ({ page, request }) => {
  const songs = await (await request.get(`${api}/songs`)).json();
  const song = songs.find((s: { status: string; active_bundle_id: string }) => s.status === 'ready' && s.active_bundle_id);
  expect(song, 'Seed the isolated backend before browser integration tests').toBeTruthy();
  const pageErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: song.title, exact: true }).click();
  const game = page.getByRole('region', { name: 'Game', exact: true });
  const video = page.getByLabel('Reference video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await game.getByRole('button', { name: 'Play / pause', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);
  await game.getByRole('button', { name: 'Play / pause', exact: true }).click();
  const paused = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.waitForTimeout(200);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(paused, 1);
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 3; });
  await expect(page.getByText('This is a practice segment.', { exact: false })).toBeVisible();
  await game.getByRole('button', { name: 'Replay from beginning' }).click();
  await expect(page.getByText('This is a practice segment.', { exact: false })).toHaveCount(0);
  await video.evaluate((v: HTMLVideoElement) => { v.playbackRate = 8; });
  await page.evaluate(() => {
    const timer = setInterval(() => {
      const v = document.querySelector<HTMLVideoElement>('video[aria-label="Reference video"]')!;
      if (v.ended) { clearInterval(timer); return; }
      document.querySelector<HTMLButtonElement>('section[aria-label="Game"] button')?.blur();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    }, 15);
  });
  await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByLabel('Score', { exact: true })).not.toContainText('Score: 0 ·');
  await page.getByLabel('Player name').fill('browser-idempotency');
  let dropped = false;
  await page.route(`**/songs/${song.id}/plays`, async route => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true; await route.fetch(); await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Save result', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saving result' })).toBeEnabled();
  await page.getByRole('button', { name: 'Retry saving result' }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled();
  const plays = await (await request.get(`${api}/songs/${song.id}/plays`)).json();
  const latest = plays.find((p: { player_name: string }) => p.player_name === 'browser-idempotency');
  expect(plays.filter((p: { client_session_id: string }) => p.client_session_id === latest.client_session_id)).toHaveLength(1);
  expect(latest.mode).toBe('keyboard_practice');
  expect(latest.bundle_id).toBe(song.active_bundle_id);
  expect(pageErrors).toEqual([]);
});

test('official local model detects a real dancer from a simulated webcam and stops on mode change', async ({ browser, request }) => {
  // A real media fixture through getUserMedia, not mocked landmarks or a physical camera.
  const context = await browser.newContext({ permissions: ['camera'] });
  const page = await context.newPage();
  const external: string[] = [];
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
  const songs = await (await request.get(`${api}/songs`)).json();
  const song = songs.find((s: { status: string; active_bundle_id: string }) => s.status === 'ready' && s.active_bundle_id);
  await page.goto('/');
  await page.getByRole('button', { name: song.title, exact: true }).click();
  await page.getByLabel('Game mode').selectOption('camera');
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByText('Tracking body', { exact: false })).toBeVisible({ timeout: 30000 });
  const track = await page.getByLabel('Webcam preview').evaluateHandle((v: HTMLVideoElement) => (v.srcObject as MediaStream).getVideoTracks()[0]);
  await page.getByRole('button', { name: 'Play / pause', exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByLabel('Game mode').selectOption('keyboard_practice');
  await expect(page.getByLabel('Webcam preview')).toHaveCount(0);
  expect(await track.evaluate(t => t.readyState)).toBe('ended');
  expect(external).toEqual([]);
  await context.close();
});

test('browser upload runs real preparation and loads the resulting immutable video', async ({ page, request }) => {
  test.setTimeout(150000);
  const title = `Browser upload ${Date.now()}`;
  // Canonical seed mux has intended music; normalize only its first eight seconds.
  const source = path.resolve('../pipeline/outputs/web-seed/jd_video_1/reference.mp4');
  expect(existsSync(source), 'Run the seed command with --work-dir pipeline/outputs/web-seed').toBeTruthy();
  await page.goto('/');
  await page.getByLabel('Song title').fill(title);
  await page.getByLabel('Source', { exact: true }).selectOption('upload');
  await page.getByLabel('Video file').setInputFiles(source);
  await page.getByLabel('End time').fill('8');
  await page.getByRole('button', { name: 'Create and prepare' }).click();
  await expect(page.getByRole('region', { name: 'Preparation progress' })).toContainText('succeeded', { timeout: 120000 });
  await expect(page.getByRole('region', { name: 'Game', exact: true }).getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect.poll(() => page.getByLabel('Reference video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  const songs = await (await request.get(`${api}/songs`)).json();
  const song = songs.find((s: { title: string }) => s.title === title);
  const report = await (await request.get(`${api}/songs/${song.id}/bundles/${song.active_bundle_id}/report`)).json();
  expect(report.cache.verification).toBe('local_preparation');
  expect(report.readiness.cache_ready_by_default).toBe(true);
  await page.goto('about:blank');
  expect((await request.delete(`${api}/songs/${song.id}`)).status()).toBe(204);
});

test('download failure offers upload and leaves keyboard controls usable', async ({ page }) => {
  // Deterministic boundary test: provider bot blocks vary outside our control.
  await page.route('**/songs/json', r => r.fulfill({ json: { id: 'url-song', title: 'Blocked URL', status: 'pending' } }));
  await page.route('**/songs/url-song/preparations', r => r.fulfill({ status: 202, json: { id: 'blocked', song_id: 'url-song', status: 'failed', stage: 'failed', error_code: 'download_failed', error_message: 'The provider refused this download.' } }));
  await page.goto('/');
  await page.getByLabel('Song title').fill('Blocked URL');
  await page.getByLabel('Video URL', { exact: true }).fill('https://www.youtube.com/watch?v=HKRlrJNT6EQ');
  await page.getByRole('button', { name: 'Create and prepare' }).click();
  await expect(page.getByText('The source could not be downloaded.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Use upload fallback' }).click();
  await expect(page.getByLabel('Video file')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create and prepare' })).toBeEnabled();
});
