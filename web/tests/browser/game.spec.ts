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
  const countdown = page.getByRole('status', { name: 'Replay countdown' });
  await expect(countdown).toHaveText('Get ready — 3');
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  // Encoded media can have a small nonzero presentation start (fixture: 0.01s).
  const replayStart = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  expect(replayStart).toBeLessThan(0.05);
  await expect(countdown).toHaveText('Get ready — 2');
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(replayStart);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(countdown).toHaveText('Get ready — 1');
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(countdown).toHaveCount(0);
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
  // Capture countdown state inside the page: separate browser round trips can
  // cross a countdown boundary while real inference is occupying the renderer.
  await page.evaluate(() => {
    const observations: { text: string; paused: boolean }[] = [];
    const observer = new MutationObserver(() => {
      const text = document.querySelector('[aria-label="Replay countdown"]')?.textContent;
      if (text && observations.at(-1)?.text !== text) observations.push({ text, paused: document.querySelector<HTMLVideoElement>('[aria-label="Reference video"]')!.paused });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    Object.assign(window, { countdownObservations: observations, stopCountdownObserver: () => observer.disconnect() });
  });
  await page.getByRole('button', { name: 'Enable camera' }).click();
  const automaticCountdown = page.getByRole('status', { name: 'Replay countdown' });
  await expect(page.getByRole('button', { name: 'Pause round', exact: true })).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Pause round', exact: true }).click();
  const countdownObservations = await page.evaluate(() => {
    const state = window as unknown as { countdownObservations: { text: string; paused: boolean }[]; stopCountdownObserver: () => void };
    state.stopCountdownObserver(); return state.countdownObservations;
  });
  expect(countdownObservations.map(o => o.text)).toEqual(expect.arrayContaining(['Get ready — 3', 'Get ready — 2', 'Get ready — 1']));
  expect(countdownObservations.every(o => o.paused)).toBe(true);
  await page.waitForTimeout(1500);
  expect(await page.getByLabel('Reference video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(automaticCountdown).toHaveCount(0);
  await expect(page.getByLabel('Body tracking status')).toContainText(/Ready|Tracking body/, { timeout: 40000 });
  const skeleton = page.getByRole('img', { name: 'Tracked body skeleton', exact: true });
  await expect.poll(() => skeleton.evaluate((c: HTMLCanvasElement) => c.width), { timeout: 20000 }).toBeGreaterThan(0);
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
  await page.setViewportSize({ width: 390, height: 844 });
  const [narrowReference, narrowCamera] = await page.evaluate(() => ['Reference video', 'Webcam preview'].map(label => {
    const rect = document.querySelector(`[aria-label="${label}"]`)!.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  expect(narrowCamera!.y).toBeGreaterThan(narrowReference!.y + narrowReference!.height);
  expect(narrowCamera!.x + narrowCamera!.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole('checkbox', { name: 'Show body skeleton' }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'Show body skeleton' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Show body skeleton' }).check();
  const track = await page.getByLabel('Webcam preview').evaluateHandle((v: HTMLVideoElement) => (v.srcObject as MediaStream).getVideoTracks()[0]);
  // Give the fault-injection phase enough media time after the automatic-start
  // check. Otherwise an eight-second fixture can end before the watchdog fires.
  await page.getByLabel('Reference video').evaluate((v: HTMLVideoElement) => { v.currentTime = 0; v.playbackRate = 0.5; });
  const ready = page.getByRole('button', { name: 'Ready — start / resume', exact: true });
  await expect(ready).toBeEnabled({ timeout: 40000 });
  await ready.click();
  await expect.poll(() => page.getByLabel('Reference video').evaluate((v: HTMLVideoElement) => v.paused), { timeout: 10000 }).toBe(false);
  // Stall a real model call after normal startup; do not substitute landmarks.
  await page.evaluate(() => {
    const runtime = window as unknown as { Pose: { prototype: { send: (...args: unknown[]) => Promise<void> } }; restorePoseSend?: () => void };
    const original = runtime.Pose.prototype.send;
    if (typeof original !== 'function') throw new Error('Pose send hook unavailable');
    runtime.restorePoseSend = () => { runtime.Pose.prototype.send = original; };
    runtime.Pose.prototype.send = () => new Promise<void>(() => {});
  });
  await expect(page.getByRole('alert')).toContainText('stopped responding', { timeout: 10000 });
  expect(await page.getByLabel('Reference video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.evaluate(() => (window as unknown as { restorePoseSend: () => void }).restorePoseSend());
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
  const source = process.env.DANCIFY_TEST_UPLOAD_VIDEO || path.resolve('../pipeline/outputs/web-seed/jd_video_1/reference.mp4');
  expect(existsSync(source), 'Run scripts/test-integration.sh or seed with --work-dir pipeline/outputs/web-seed').toBeTruthy();
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

test('an older partial-body chart explains regeneration instead of starting an unscorable round', async ({ page, request }) => {
  const songs = await (await request.get(`${api}/songs`)).json();
  const song = songs.find((s: { status: string; active_bundle_id: string }) => s.status === 'ready' && s.active_bundle_id);
  expect(song).toBeTruthy();
  await page.route(`**/songs/${song.id}/bundles/${song.active_bundle_id}/chart`, async route => {
    const response = await route.fetch();
    const chart = await response.json();
    chart.moves[0].keyframe_landmarks[15][3] = 0.1;
    await route.fulfill({ response, json: chart });
  });
  await page.goto('/');
  await page.getByRole('button', { name: song.title, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Prepare this song again');
  await expect(page.getByLabel('Reference video')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Prepare selected song / new range' })).toBeEnabled();
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

test('simulated rotary and button controls select songs and keyboard arrows share menu focus', async ({ page, request }) => {
  const songs = await (await request.get(`${api}/songs`)).json();
  expect(songs.length, 'Seed two songs through scripts/test-integration.sh before testing navigation').toBeGreaterThanOrEqual(2);
  await page.goto('/');
  await page.getByText('Controller connection and testing', { exact: true }).click();
  await expect(page.getByRole('button', { name: songs[0].title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next item', exact: true }).click();
  await expect(page.getByRole('button', { name: songs[0].title, exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: songs[1].title, exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Previous item', exact: true }).click();
  await expect(page.getByRole('button', { name: songs[0].title, exact: true })).toBeFocused();
  await page.getByRole('button', { name: songs[0].title, exact: true }).evaluate((button: HTMLButtonElement) => { button.disabled = true; });
  await page.getByRole('button', { name: 'Select item', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Game', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: songs[0].title, exact: true }).evaluate((button: HTMLButtonElement) => { button.disabled = false; });
  await page.getByRole('button', { name: 'Select item', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Game', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to camera scoring' }).click();
  await expect(page.getByRole('button', { name: 'Ready — start / resume' })).toBeDisabled();
  await page.getByRole('button', { name: 'Switch to keyboard practice' }).click();
  await expect(page.getByRole('button', { name: 'Play / pause', exact: true })).toBeEnabled();
});

test('BLE notifications navigate and select, and controller loss pauses until explicit fallback', async ({ page, request }) => {
  await page.addInitScript(() => {
    const tx = new EventTarget(); const device = new EventTarget(); let failWrite = false;
    const characteristic = Object.assign(tx, { value: new DataView(new ArrayBuffer(0)), startNotifications: async () => {}, stopNotifications: async () => {}, writeValueWithResponse: async (_bytes: Uint8Array) => { if (failWrite) throw new Error('Injected BLE write failure'); } });
    const gatt = { connected: false, connect: async () => { gatt.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) }; }, disconnect: () => { gatt.connected = false; } };
    Object.assign(device, { gatt });
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async () => device } });
    Object.assign(window, {
      testBleNotify: (text: string) => { const bytes = new TextEncoder().encode(text); characteristic.value = new DataView(bytes.buffer); tx.dispatchEvent(new Event('characteristicvaluechanged')); },
      testBleDisconnect: () => { gatt.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); },
      testBleFailWrite: () => { failWrite = true; },
    });
  });
  const songs = await (await request.get(`${api}/songs`)).json();
  await page.goto('/');
  await expect(page.getByRole('button', { name: songs[0].title, exact: true })).toBeVisible();
  await page.getByText('Controller connection and testing', { exact: true }).click();
  await page.getByRole('button', { name: 'Connect ESP32', exact: true }).click();
  await expect(page.getByText('Controller: connected', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const controls = window as unknown as { testBleNotify: (text: string) => void };
    controls.testBleNotify('DIR:DO'); controls.testBleNotify('WN\nBTN:DOWN\nBTN:CLICK\nBTN:UP\n');
  });
  await expect(page.getByRole('region', { name: 'Game', exact: true })).toBeVisible();
  const video = page.getByLabel('Reference video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Play / pause', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await page.evaluate(() => (window as unknown as { testBleDisconnect: () => void }).testBleDisconnect());
  await expect(page.getByRole('button', { name: 'Use keyboard controls' })).toBeVisible();
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(page.getByLabel('Score', { exact: true })).toContainText('Score: 0 ·');
  await page.getByRole('button', { name: 'Use keyboard controls' }).click();
  await page.getByRole('button', { name: 'Play / pause', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  // A reconnect whose initial stop write fails also pauses the active fallback round.
  await page.evaluate(() => (window as unknown as { testBleFailWrite: () => void }).testBleFailWrite());
  await page.getByRole('button', { name: 'Connect ESP32', exact: true }).click();
  await expect(page.getByText('Injected BLE write failure', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use keyboard controls' })).toBeVisible();
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

test('simulated output follows real playback, practice judgment, results, replay and reconnect', async ({ page, request }) => {
  test.setTimeout(60000);
  const songs = await (await request.get(`${api}/songs`)).json();
  const song = songs.find((s: { status: string }) => s.status === 'ready');
  const chart = await (await request.get(`${api}/songs/${song.id}/bundles/${song.active_bundle_id}/chart`)).json();
  await page.goto('/');
  await page.getByText('Controller connection and testing', { exact: true }).click();
  await page.getByRole('button', { name: 'Connect simulated ESP32' }).click();
  await page.getByText(/Wearable command monitor/).click();
  const commands = page.getByRole('list', { name: 'Wearable commands' }).locator('code');
  await expect(commands).toHaveText(['RUN:0']);
  await page.getByRole('button', { name: song.title, exact: true }).click();
  await expect(commands.last()).toHaveText('TONE:880');
  const video = page.getByLabel('Reference video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Clear commands' }).click();
  await page.getByRole('button', { name: 'Play / pause', exact: true }).click();
  await expect(commands.filter({ hasText: /^RUN:1$/ })).toHaveCount(1);
  const first = chart.moves[0];
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { intervals: [20] }).toBeGreaterThan(first.start);
  await page.getByRole('button', { name: 'Hit checkpoint', exact: true }).click();
  await expect(commands.filter({ hasText: /^HIT:1$/ })).toHaveCount(1, { timeout: 10000 });
  await expect(page.getByRole('region', { name: 'Results', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(commands.last()).toHaveText('RUN:0');
  await page.getByRole('button', { name: 'Clear commands' }).click();
  await page.getByRole('button', { name: 'Play again', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Replay countdown' })).toHaveText('Get ready — 3');
  await expect(commands.filter({ hasText: /^RUN:1$/ })).toHaveCount(0);
  await expect(commands.filter({ hasText: /^RUN:1$/ })).toHaveCount(1, { timeout: 6000 });
  await page.getByRole('button', { name: 'Disconnect ESP32', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use keyboard controls' })).toBeVisible();
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.getByRole('button', { name: 'Connect simulated ESP32' }).click();
  await expect(commands.last()).toHaveText('RUN:0');
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});
