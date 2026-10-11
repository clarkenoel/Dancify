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

test('round ends with an immediate score and navigation even when history fails', async ({ page, request }) => {
  const songs = await (await request.get(`${api}/songs`)).json();
  const song = songs.find((s: { status: string; active_bundle_id: string }) => s.status === 'ready' && s.active_bundle_id);
  expect(song, 'Seed the isolated backend before browser integration tests').toBeTruthy();
  const pageErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  const savedIds: string[] = [];
  let releaseSave!: () => void;
  const heldResponse = new Promise<void>(resolve => { releaseSave = resolve; });
  await page.route(`**/songs/${song.id}/plays`, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    savedIds.push(route.request().postDataJSON().client_session_id);
    const response = await route.fetch();
    if (savedIds.length === 1) { await route.abort('failed'); return; }
    if (savedIds.length === 2) await heldResponse;
    await route.fulfill({ response });
  });
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
  await game.getByRole('button', { name: 'Replay round' }).click();
  await video.evaluate((v: HTMLVideoElement) => { v.playbackRate = 8; });
  await page.evaluate(() => {
    const timer = setInterval(() => {
      const v = document.querySelector<HTMLVideoElement>('video[aria-label="Reference video"]')!;
      if (v.ended) { clearInterval(timer); return; }
      (document.activeElement as HTMLElement)?.blur();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    }, 15);
  });
  const results = page.getByRole('region', { name: 'Results', exact: true });
  await expect(results).toBeVisible({ timeout: 20000 });
  await expect(page.getByLabel('Final score')).not.toHaveText('Final score: 0');
  await expect(results.getByRole('button')).toHaveText(['Play again', 'Choose another song', 'Main menu']);
  await expect(page.getByRole('button', { name: /Save result|Retry saving result/ })).toHaveCount(0);
  await expect.poll(() => savedIds.length).toBe(1);
  const plays = await (await request.get(`${api}/songs/${song.id}/plays`)).json();
  expect(plays.filter((p: { client_session_id: string }) => p.client_session_id === savedIds[0])).toHaveLength(1);
  await results.getByRole('button', { name: 'Play again' }).click();
  await expect(results).toHaveCount(0);
  await expect(page.getByLabel('Score', { exact: true })).toContainText('Score: 0 ·');
  await expect(results).toBeVisible({ timeout: 20000 });
  await expect.poll(() => savedIds.length).toBe(2);
  try {
    await results.getByRole('button', { name: 'Choose another song' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a song', exact: true })).toBeVisible();
    await expect(page.getByLabel('Reference video')).toHaveCount(0);
  } finally { releaseSave(); }
  await page.getByRole('button', { name: song.title, exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate((v: HTMLVideoElement) => { v.playbackRate = 8; });
  await game.getByRole('button', { name: 'Play / pause', exact: true }).click();
  await expect(results).toBeVisible({ timeout: 20000 });
  await results.getByRole('button', { name: 'Main menu', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Main menu', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Prepare a song' })).toBeVisible();
  await expect(game).toHaveCount(0);
  expect(new Set(savedIds).size).toBe(savedIds.length);
  expect(pageErrors).toEqual([]);
});

test('official local model renders the dancer skeleton, switches cameras and cleans up', async ({ browser, request }) => {
  test.setTimeout(150000);
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
  await expect(page.getByLabel('Body tracking status')).toContainText(/Ready|Tracking body/, { timeout: 40000 });
  const skeleton = page.getByRole('img', { name: 'Tracked body skeleton', exact: true });
  await expect.poll(() => skeleton.evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(0);
  await expect(page.getByLabel('Camera target pose')).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download movement log' }).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  const log = JSON.parse(Buffer.concat(chunks).toString());
  expect(log.version).toBe('movement-log-v1');
  expect(log.samples.length).toBeGreaterThan(0);
  expect(log.samples[0].imageBody.map((j: { index: number }) => j.index)).toEqual([11,12,13,14,15,16,23,24,25,26,27,28]);
  await page.getByRole('checkbox', { name: 'Record body movements locally' }).uncheck();
  await page.getByRole('button', { name: 'Clear movement log' }).click();
  await expect(page.getByText('Samples: 0 ·', { exact: false })).toBeVisible();
  // Read both rectangles in one frame: live status text can change scroll anchoring.
  const [referenceBox, webcamBox] = await page.evaluate(() => ['Reference video', 'Webcam preview'].map(label => {
    const rect = document.querySelector(`[aria-label="${label}"]`)!.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  expect(webcamBox!.x).toBeGreaterThanOrEqual(referenceBox!.x + referenceBox!.width);
  expect(Math.abs(webcamBox!.y - referenceBox!.y)).toBeLessThan(2);
  await page.getByLabel('Practice video feeds').screenshot({ path: test.info().outputPath('side-by-side.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const [narrowReference, narrowCamera] = await page.evaluate(() => ['Reference video', 'Webcam preview'].map(label => {
    const rect = document.querySelector(`[aria-label="${label}"]`)!.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  expect(narrowCamera!.y).toBeGreaterThan(narrowReference!.y + narrowReference!.height);
  expect(narrowCamera!.x + narrowCamera!.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole('region', { name: 'Player camera', exact: true }).screenshot({ path: test.info().outputPath('camera-preview.png') });
  await page.getByRole('checkbox', { name: 'Show body skeleton' }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'Show body skeleton' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Show body skeleton' }).check();
  const track = await page.getByLabel('Webcam preview').evaluateHandle((v: HTMLVideoElement) => (v.srcObject as MediaStream).getVideoTracks()[0]);
  await page.getByRole('button', { name: 'Play / pause', exact: true }).click();
  await page.waitForTimeout(500);
  const device = await page.getByLabel('Camera device', { exact: true }).locator('option').nth(1).getAttribute('value');
  await page.getByLabel('Camera device', { exact: true }).selectOption(device!);
  expect(await track.evaluate(t => t.readyState)).toBe('ended');
  await expect.poll(() => skeleton.evaluate((c: HTMLCanvasElement) => c.width)).toBe(0);
  expect(await page.getByLabel('Reference video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByLabel('Body tracking status')).toContainText(/Ready|Tracking body/, { timeout: 40000 });
  const replacement = await page.getByLabel('Webcam preview').evaluateHandle((v: HTMLVideoElement) => (v.srcObject as MediaStream).getVideoTracks()[0]);
  await page.getByLabel('Game mode').selectOption('keyboard_practice');
  await expect(page.getByLabel('Webcam preview')).toHaveCount(0);
  expect(await replacement.evaluate(t => t.readyState)).toBe('ended');
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
  await expect(page.getByRole('region', { name: 'Game', exact: true })).toBeVisible({ timeout: 120000 });
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


test('camera permission failure is actionable and keyboard practice remains available', async ({ page, request }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied for test', 'NotAllowedError'); };
  });
  const songs = await (await request.get(`${api}/songs`)).json();
  const song = songs.find((s: { status: string }) => s.status === 'ready');
  await page.goto('/');
  await page.getByRole('button', { name: song.title, exact: true }).click();
  await page.getByLabel('Game mode').selectOption('camera');
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByRole('alert')).toContainText('Camera permission was denied');
  await expect(page.getByRole('button', { name: 'Enable camera' })).toBeEnabled();
  await page.getByLabel('Game mode').selectOption('keyboard_practice');
  await expect(page.getByRole('button', { name: 'Hit checkpoint' })).toBeVisible();
});
