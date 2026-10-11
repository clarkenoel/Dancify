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

test('official local model renders the dancer skeleton, switches cameras and cleans up', async ({ browser, request }) => {
  // Several independently bounded model startups plus recovery can exceed 150s on CI.
  // Per-operation assertions and the production 2.5s watchdog remain unchanged.
  test.setTimeout(240000);
  // A real media fixture through getUserMedia, not mocked landmarks or a physical camera.
  const context = await browser.newContext({ permissions: ['camera'] });
  const page = await context.newPage();
  const external: string[] = [];
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
  const songs = await (await request.get(`${api}/songs`)).json();
  const song = songs.find((s: { status: string; active_bundle_id: string }) => s.status === 'ready' && s.active_bundle_id);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  await page.getByRole('button', { name: song.title, exact: true }).click();
  await expect(page.getByLabel('Reference video')).toBeVisible();
  await expect(page.getByLabel('Timing overlay', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Show timing overlay', { exact: true })).toHaveCount(0);
  // Capture countdown state inside the page: separate browser round trips can
  // cross a countdown boundary while real inference is occupying the renderer.
  await page.evaluate(() => {
    const observations: { text: string; paused: boolean }[] = [];
    const observer = new MutationObserver(() => {
      const text = document.querySelector('[aria-label="Replay countdown"]')?.textContent;
      if (text && observations.at(-1)?.text !== text) observations.push({ text, paused: document.querySelector<HTMLVideoElement>('[aria-label="Reference video"]')!.paused });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const reference = document.querySelector<HTMLVideoElement>('[aria-label="Reference video"]')!;
    // Observe actual automatic playback and pause in the same event turn. A slow
    // software-rendered CI browser may finish the short clip between RPCs.
    Object.assign(window, { automaticPlaybackObserved: false });
    reference.addEventListener('playing', () => {
      Object.assign(window, { automaticPlaybackObserved: !reference.paused });
      reference.pause();
    }, { once: true });
    Object.assign(window, { countdownObservations: observations, stopCountdownObserver: () => observer.disconnect() });
  });
  await page.getByRole('button', { name: 'Enable camera' }).click();
  const automaticCountdown = page.getByRole('status', { name: 'Replay countdown' });
  await expect.poll(() => page.evaluate(() => (window as unknown as { automaticPlaybackObserved: boolean }).automaticPlaybackObserved), { timeout: 45000 }).toBe(true);
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
  await page.getByRole('button', { name: 'Developer tools', exact: true }).click();
  await page.getByText('Movement diagnostics', { exact: true }).click();
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
  await page.getByRole('dialog', { name: 'Developer tools', exact: true }).getByRole('button', { name: 'Back', exact: true }).click();
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

  // Software-rendered CI can hit the production inference watchdog while resizing.
  // Verify its recovery contract before beginning the separate injected-stall test.
  if (await page.getByRole('button', { name: 'Enable camera', exact: true }).count()) {
    await expect(page.getByRole('alert')).toContainText('stopped responding');
    expect(await page.getByLabel('Reference video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await expect.poll(() => skeleton.evaluate((c: HTMLCanvasElement) => c.width)).toBe(0);
    await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await expect(page.getByLabel('Body tracking status')).toContainText(/Ready|Tracking body/, { timeout: 40000 });
  }

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Show body skeleton' }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'Show body skeleton' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Show body skeleton' }).check();
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Back', exact: true }).click();
  const track = await page.getByLabel('Webcam preview').evaluateHandle((v: HTMLVideoElement) => (v.srcObject as MediaStream).getVideoTracks()[0]);
  // Give the fault-injection phase enough media time after the automatic-start
  // check. Otherwise an eight-second fixture can end before the watchdog fires.
  await page.getByLabel('Reference video').evaluate((v: HTMLVideoElement) => { v.currentTime = 0; v.playbackRate = 0.5; });
  const ready = page.getByRole('button', { name: 'Ready — start / resume', exact: true });
  await expect(ready).toBeEnabled({ timeout: 40000 });
  // Arm the fault before starting, then inject at the real playing event. Never
  // wait for a second browser round trip while the short video runs.
  await page.evaluate(() => {
    const runtime = window as unknown as { Pose: { prototype: { send: (...args: unknown[]) => Promise<void> } }; restorePoseSend?: () => void; stallInjected?: boolean };
    const original = runtime.Pose.prototype.send;
    if (typeof original !== 'function') throw new Error('Pose send hook unavailable');
    let release!: () => void;
    const stalled = new Promise<void>(resolve => { release = resolve; });
    runtime.restorePoseSend = () => { runtime.Pose.prototype.send = original; release(); };
    document.querySelector<HTMLVideoElement>('[aria-label="Reference video"]')!.addEventListener('playing', () => {
      runtime.Pose.prototype.send = () => { runtime.stallInjected = true; return stalled; };
    }, { once: true });
  });
  await ready.click();
  await expect(page.getByRole('alert')).toContainText('stopped responding', { timeout: 10000 });
  expect(await page.getByLabel('Reference video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { stallInjected: boolean }).stallInjected)).toBe(true);
  await page.evaluate(() => (window as unknown as { restorePoseSend: () => void }).restorePoseSend());
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const device = await page.getByLabel('Camera device', { exact: true }).locator('option').nth(1).getAttribute('value');
  await page.getByLabel('Camera device', { exact: true }).selectOption(device!);
  expect(await track.evaluate(t => t.readyState)).toBe('ended');
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => skeleton.evaluate((c: HTMLCanvasElement) => c.width)).toBe(0);
  expect(await page.getByLabel('Reference video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByLabel('Body tracking status')).toContainText(/Ready|Tracking body/, { timeout: 40000 });
  const replacement = await page.getByLabel('Webcam preview').evaluateHandle((v: HTMLVideoElement) => (v.srcObject as MediaStream).getVideoTracks()[0]);
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
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
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  await page.getByRole('button', { name: 'Import video', exact: true }).click();
  await page.getByText('Advanced · title and clip range', { exact: true }).click();
  await page.getByLabel('Song title').fill(title);
  await page.getByRole('button', { name: 'Upload file', exact: true }).click();
  await page.getByLabel('Video file').setInputFiles(source);
  await page.getByLabel('End time').fill('8');
  await page.getByRole('button', { name: 'Prepare video' }).click();
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

test('download failure offers the real upload fallback', async ({ page }) => {
  // Deterministic boundary test: provider bot blocks vary outside our control.
  await page.route('**/songs/json', r => r.fulfill({ json: { id: 'url-song', title: 'Blocked URL', status: 'pending' } }));
  await page.route('**/songs/url-song/preparations', r => r.fulfill({ status: 202, json: { id: 'blocked', song_id: 'url-song', status: 'failed', stage: 'failed', error_code: 'download_failed', error_message: 'The provider refused this download.' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  await page.getByRole('button', { name: 'Import video', exact: true }).click();
  await page.getByText('Advanced · title and clip range', { exact: true }).click();
  await page.getByLabel('Song title').fill('Blocked URL');
  await page.getByLabel('Video URL', { exact: true }).fill('https://www.youtube.com/watch?v=HKRlrJNT6EQ');
  await page.getByRole('button', { name: 'Prepare video' }).click();
  await expect(page.getByText('The source could not be downloaded.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Use upload fallback' }).click();
  await expect(page.getByLabel('Video file')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare video' })).toBeEnabled();
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
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  await page.getByRole('button', { name: song.title, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Prepare this song again');
  await expect(page.getByLabel('Reference video')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Prepare selected song / new range' })).toBeEnabled();
});


test('camera denial offers retry and menu exit without a keyboard scoring bypass', async ({ page, request }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied for test', 'NotAllowedError'); };
  });
  const songs = await (await request.get(`${api}/songs`)).json();
  const song = songs.find((s: { status: string }) => s.status === 'ready');
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  await page.getByRole('button', { name: song.title, exact: true }).click();
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByRole('alert')).toContainText('Camera permission was denied');
  await expect(page.getByRole('button', { name: 'Enable camera' })).toBeEnabled();
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next dance starts here', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Hit checkpoint|keyboard practice/i })).toHaveCount(0);
});


test('camera rounds show immediate results, survive save failures, and replay with a countdown', async ({ page, request }) => {
  test.setTimeout(120000);
  const songs = await (await request.get(`${api}/songs`)).json();
  const song = songs.find((s: { status: string }) => s.status === 'ready');
  const saved: { client_session_id: string; mode: string; score: number }[] = [];
  await page.route(`**/songs/${song.id}/plays`, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    saved.push(route.request().postDataJSON());
    // Ambiguous failure after server acceptance must not prevent local results.
    await route.fetch(); await route.abort('failed');
  });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  await page.getByRole('button', { name: song.title, exact: true }).click();
  await expect(page.getByRole('button', { name: /Hit checkpoint|keyboard practice/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ready — start / resume' })).toBeDisabled();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    for (const code of ['Enter', 'Space', 'KeyR', 'ArrowRight']) window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  });
  expect(await page.getByLabel('Reference video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(page.getByLabel('Score', { exact: true })).toContainText('Score: 0 ·');
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  const results = page.getByRole('region', { name: 'Results', exact: true });
  await expect(results).toBeVisible({ timeout: 50000 });
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].mode).toBe('camera');
  await expect(page.getByLabel('Final score')).toHaveText(`Final score: ${saved[0].score}`);
  await expect(results.getByRole('button')).toHaveText(['Play again', 'Choose another song', 'Main menu']);
  await expect(page.getByRole('button', { name: /Save result/ })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/pages-results.png', fullPage: true });
  await page.evaluate(() => {
    const observations: { text: string; paused: boolean }[] = [];
    const observer = new MutationObserver(() => {
      const text = document.querySelector('[aria-label="Replay countdown"]')?.textContent;
      if (text && observations.at(-1)?.text !== text) observations.push({ text,
        paused: document.querySelector<HTMLVideoElement>('[aria-label="Reference video"]')!.paused });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    Object.assign(window, { replayCountdownObservations: observations, stopReplayCountdownObserver: () => observer.disconnect() });
  });
  await results.getByRole('button', { name: 'Play again' }).click();
  // Read countdown and paused together in its actual render turn. Separate RPCs
  // can cross the three-second boundary while software inference is busy.
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { replayCountdownObservations: { text: string }[] }).replayCountdownObservations.map(o => o.text)),
  { timeout: 15000 }).toEqual(expect.arrayContaining(['Get ready — 3', 'Get ready — 2', 'Get ready — 1']));
  const countdownObservations = await page.evaluate(() => {
    const state = window as unknown as { replayCountdownObservations: { paused: boolean }[]; stopReplayCountdownObserver: () => void };
    state.stopReplayCountdownObserver(); return state.replayCountdownObservations;
  });
  expect(countdownObservations.every(observation => observation.paused)).toBe(true);
  await expect(results).toBeVisible({ timeout: 35000 });
  await expect.poll(() => saved.length).toBe(2);
  expect(saved[0].client_session_id).not.toBe(saved[1].client_session_id);
  const plays = await (await request.get(`${api}/songs/${song.id}/plays`)).json();
  for (const result of saved) expect(plays.filter((p: { client_session_id: string }) => p.client_session_id === result.client_session_id)).toHaveLength(1);
  await results.getByRole('button', { name: 'Choose another song' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a song', exact: true })).toBeVisible();
  await expect(page.getByLabel('Reference video')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Pending results' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('keyboard menu focus select real songs, skip disabled buttons, and respect exit dialogs', async ({ page, request }) => {
  const songs = await (await request.get(`${api}/songs`)).json();
  expect(songs.length).toBeGreaterThanOrEqual(2);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose video', exact: true }).focus();
  await page.keyboard.press('Enter');
  const first = page.getByRole('button', { name: songs[0].title, exact: true });
  await first.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: songs[1].title, exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(first).toBeFocused();
  await first.evaluate((b: HTMLButtonElement) => { b.disabled = true; });
  await page.keyboard.press('ArrowDown');
  await expect(first).not.toBeFocused();
  await expect(page.getByRole('region', { name: 'Game', exact: true })).toHaveCount(0);
  await first.evaluate((b: HTMLButtonElement) => { b.disabled = false; });
  await first.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Ready — start / resume' })).toBeDisabled();
  const exit = page.getByRole('button', { name: 'Main menu', exact: true });
  await exit.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(exit).toBeFocused();
  await exit.click(); await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Your next dance starts here', exact: true })).toBeFocused();
});

test('camera-only BLE stays quiet, disconnect pauses, and a completed rating cues only once', async ({ page, request }) => {
  // Real model startup, two countdowns and the full round have independent
  // assertion limits. Let all of them finish on software-rendered CI workers.
  test.setTimeout(150000);
  const songs = await (await request.get(`${api}/songs`)).json();
  const song = songs.find((s: { status: string }) => s.status === 'ready');
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  await page.getByRole('button', { name: song.title, exact: true }).click();
  await page.getByRole('button', { name: 'Developer tools', exact: true }).click();
  await page.getByText('Controller connection and testing', { exact: true }).click();
  await page.getByRole('button', { name: 'Connect simulated ESP32' }).click();
  await page.getByText(/Wearable command monitor/).click();
  const commands = page.locator('ol[aria-label="Wearable commands"] code');
  await page.getByRole('dialog', { name: 'Developer tools', exact: true }).getByRole('button', { name: 'Back', exact: true }).click();
  const video = page.getByLabel('Reference video');
  // Disconnect at the real playing event so slow CI RPCs cannot miss an eight-second round.
  await page.evaluate(() => {
    const reference = document.querySelector<HTMLVideoElement>('[aria-label="Reference video"]')!;
    reference.addEventListener('playing', () => {
      [...document.querySelectorAll('button')].find(b => b.textContent === 'Disconnect ESP32')!.click();
    }, { once: true });
    const cues: { ended: boolean; paused: boolean }[] = [];
    const seen = new WeakSet<Element>();
    const monitor = document.querySelector('ol[aria-label="Wearable commands"]')!;
    const observer = new MutationObserver(() => {
      for (const code of monitor.querySelectorAll('code')) {
        if (code.textContent === 'TONE:880' && !seen.has(code)) {
          seen.add(code);
          if ((window as unknown as { resumedAfterReconnect?: boolean }).resumedAfterReconnect) cues.push({ ended: reference.ended, paused: reference.paused });
        }
      }
    });
    observer.observe(monitor, { childList: true, subtree: true, characterData: true });
    Object.assign(window, { ratingCueObservations: cues, stopRatingCueObserver: () => observer.disconnect() });
  });
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  // Opening tools deliberately cancels automatic startup; confirm readiness after returning.
  await expect(page.getByRole('button', { name: 'Ready — start / resume' })).toBeEnabled({ timeout: 40000 });
  await page.getByRole('button', { name: 'Ready — start / resume' }).click();
  await expect(page.getByRole('button', { name: 'Continue without controller' })).toBeVisible({ timeout: 15000 });
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.getByRole('button', { name: 'Developer tools', exact: true }).click();
  await page.getByRole('button', { name: 'Connect simulated ESP32' }).click();
  await expect(commands.last()).toHaveText('RUN:0');
  await page.getByRole('dialog', { name: 'Developer tools', exact: true }).getByRole('button', { name: 'Back', exact: true }).click();
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.evaluate(() => {
    Object.assign(window, { resumedAfterReconnect: false });
    const reference = document.querySelector<HTMLVideoElement>('[aria-label="Reference video"]')!;
    reference.addEventListener('playing', () => {
      const tones = [...document.querySelectorAll('ol[aria-label="Wearable commands"] code')].filter(code => code.textContent === 'TONE:880').length;
      Object.assign(window, { resumedAfterReconnect: !reference.paused, tonesBeforeRound: tones });
    }, { once: true });
  });
  await expect(page.getByRole('button', { name: 'Ready — start / resume' })).toBeEnabled({ timeout: 15000 });
  await page.getByRole('button', { name: 'Ready — start / resume' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { resumedAfterReconnect: boolean }).resumedAfterReconnect), { timeout: 10000 }).toBe(true);
  await expect(page.getByRole('region', { name: 'Results', exact: true })).toBeVisible({ timeout: 25000 });
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  const tonesBeforeRound = await page.evaluate(() => (window as unknown as { tonesBeforeRound: number }).tonesBeforeRound);
  await expect(commands.filter({ hasText: /^TONE:880$/ })).toHaveCount(tonesBeforeRound + 1);
  expect(await page.evaluate(() => {
    const state = window as unknown as { ratingCueObservations: { ended: boolean; paused: boolean }[]; stopRatingCueObserver: () => void };
    state.stopRatingCueObserver(); return state.ratingCueObservations;
  })).toEqual([{ ended: true, paused: true }]);
  await page.getByRole('button', { name: 'Developer tools', exact: true }).click();
  await page.getByText('Movement diagnostics', { exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download movement log' }).click();
  const stream = await (await download).createReadStream(); const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  const log = JSON.parse(Buffer.concat(chunks).toString());
  expect(log.samples.length).toBeGreaterThan(0); expect(log.mode).toBe('camera');
  expect(log.snapshot.ended).toBe(true); expect(log.snapshot.seeked).toBe(false);
  // This real recorded dancer must earn the approved first-star threshold.
  // There is no fabricated score or threshold override in this test.
  expect(log.snapshot.accuracy).toBeGreaterThanOrEqual(0.20);
  const output = await commands.allTextContents();
  const tonesAfterTools = output.filter(command => command === 'TONE:880').length;
  expect(output).toContain('RUN:0');
  expect(output.filter(command => /^(RUN:1|BPM:|BEAT:|SYNC:|HIT:)/.test(command))).toEqual([]);
  await page.waitForTimeout(1500);
  expect(await commands.allTextContents()).toEqual(output);
  await page.getByRole('button', { name: 'Disconnect ESP32', exact: true }).click();
  await page.getByRole('button', { name: 'Connect simulated ESP32' }).click();
  await expect(commands.last()).toHaveText('RUN:0');
  await page.waitForTimeout(1500);
  await expect(commands.filter({ hasText: /^TONE:880$/ })).toHaveCount(tonesAfterTools);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

test('BLE notifications navigate and select, and controller failures keep camera readiness blocked until explicit recovery', async ({ page, request }) => {
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
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  await page.getByRole('button', { name: 'Developer tools', exact: true }).click();
  await page.getByText('Controller connection and testing', { exact: true }).click();
  await page.getByRole('button', { name: 'Connect ESP32', exact: true }).click();
  await expect(page.getByText('Controller: connected', { exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'Developer tools', exact: true }).getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: songs[0].title, exact: true }).focus();
  await page.evaluate(() => {
    const controls = window as unknown as { testBleNotify: (text: string) => void };
    controls.testBleNotify('DIR:DO'); controls.testBleNotify('WN\nBTN:DOWN\nBTN:CLICK\nBTN:UP\n');
  });
  await expect(page.getByRole('region', { name: 'Game', exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { testBleDisconnect: () => void }).testBleDisconnect());
  await expect(page.getByRole('button', { name: 'Continue without controller' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue without controller' }).click();
  await expect(page.getByRole('button', { name: 'Ready — start / resume' })).toBeDisabled();
  await page.getByRole('button', { name: 'Developer tools', exact: true }).click();
  await page.getByText('Controller connection and testing', { exact: true }).click();
  await page.evaluate(() => (window as unknown as { testBleFailWrite: () => void }).testBleFailWrite());
  await page.getByRole('button', { name: 'Connect ESP32', exact: true }).click();
  await expect(page.getByText('Injected BLE write failure', { exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'Developer tools', exact: true }).getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue without controller' })).toBeVisible();
  expect(await page.getByLabel('Reference video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(page.getByLabel('Score', { exact: true })).toContainText('Score: 0 ·');
});

test('settings preserve media, volume and character; developer view traps focus and never resumes a round', async ({ page, request }) => {
  const songs = await (await request.get(`${api}/songs`)).json();
  const song = songs.find((s: { status: string }) => s.status === 'ready');
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  await page.getByRole('button', { name: song.title, exact: true }).click();
  const video = page.getByLabel('Reference video');
  await expect(video).toBeVisible();
  const original = await video.elementHandle();
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await settings.click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await page.getByLabel('Music volume').fill('0.35');
  await page.getByLabel('Target character').selectOption('human');
  expect(await video.evaluate((v: HTMLVideoElement) => v.volume)).toBeCloseTo(0.35);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/settings-connected.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeFocused();
  expect(await original!.evaluate(n => n === document.querySelector('[aria-label="Reference video"]'))).toBe(true);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await settings.click();
  await expect(page.getByLabel('Music volume')).toHaveValue('0.35');
  await expect(page.getByLabel('Target character')).toHaveValue('human');
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Developer tools', exact: true }).click();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true);
  await page.getByText('Movement diagnostics', { exact: true }).click();
  await page.getByText('Controller connection and testing', { exact: true }).click();
  await page.screenshot({ path: 'test-results/developer-connected.png' });
  await page.getByText('Simulate wearable controls', { exact: true }).click();
  await page.getByRole('button', { name: 'Wearable play / pause', exact: true }).click();
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(page.getByLabel('Replay countdown')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Developer tools', exact: true })).toBeFocused();
  await expect(page.getByLabel('Score', { exact: true })).toContainText('Score: 0 ·');
});

test('real audio assets decode after a gesture and menu actions play once across navigation', async ({ page, request }) => {
  await page.addInitScript(() => {
    const probe = { decoded: [] as number[], voices: [] as { duration: number; state: string; startedAt: number; stoppedAfterMs: number | null }[] };
    const voices = new WeakMap<AudioBufferSourceNode, number>();
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function(data, success, failure) {
      return decode.call(this, data, success, failure).then(buffer => { probe.decoded.push(buffer.duration); return buffer; });
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) {
      voices.set(this, probe.voices.length);
      probe.voices.push({ duration: this.buffer?.duration ?? 0, state: this.context.state, startedAt: performance.now(), stoppedAfterMs: null });
      return start.apply(this, args);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function(...args) {
      const index = voices.get(this);
      if (index !== undefined && probe.voices[index].stoppedAfterMs === null) probe.voices[index].stoppedAfterMs = performance.now() - probe.voices[index].startedAt;
      return stop.apply(this, args);
    };
    Object.assign(window, { audioProbe: probe });
  });
  const readAudio = () => page.evaluate(() => (window as unknown as {
    audioProbe: { decoded: number[]; voices: { duration: number; state: string; stoppedAfterMs: number | null }[] };
  }).audioProbe);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const songs = await (await request.get(`${api}/songs`)).json();
  await page.goto('/');
  expect((await readAudio()).voices).toEqual([]);
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  await expect.poll(async () => (await readAudio()).decoded.length).toBe(3);
  await expect.poll(async () => (await readAudio()).voices.length).toBe(1);
  await page.waitForTimeout(150);
  const first = (await readAudio()).voices[0];
  expect(first.duration).toBeGreaterThan(0.5); expect(first.state).toBe('running');
  // A screen transition must not immediately cancel its own selection sound.
  expect(first.stoppedAfterMs === null || first.stoppedAfterMs >= 100).toBe(true);
  await page.getByRole('button', { name: songs[0].title, exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await readAudio()).voices.length).toBe(2);
  expect((await readAudio()).voices[1].duration).toBeLessThan(0.3);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Game', exact: true })).toBeVisible();
  await expect.poll(async () => (await readAudio()).voices.length).toBe(3);
  await page.waitForTimeout(150);
  const selected = (await readAudio()).voices[2];
  expect(selected.duration).toBeGreaterThan(0.5);
  expect(selected.stoppedAfterMs === null || selected.stoppedAfterMs >= 100).toBe(true);
  expect((await readAudio()).decoded.every(duration => duration > 0)).toBe(true);
  expect(errors).toEqual([]);
});
