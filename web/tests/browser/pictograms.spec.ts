import { test, expect } from '@playwright/test';
const api = process.env.DANCIFY_TEST_API || 'http://127.0.0.1:8001';

async function readySong(request: import('@playwright/test').APIRequestContext) {
  const songs = await (await request.get(`${api}/songs`)).json();
  const song = songs.find((s: { status: string; active_bundle_id: string }) => s.status === 'ready' && s.active_bundle_id);
  expect(song, 'Seed the integration API with actual prepared media').toBeTruthy();
  return song;
}

test('known poses and every real prepared checkpoint render with the shipped artwork', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const failedAssets: string[] = [];
  page.on('response', r => { if (r.url().includes('/pictograms/') && !r.ok()) failedAssets.push(r.url()); });
  await page.goto('/debug/pictograms.html');
  await expect(page.locator('[data-renderer="lenny"]')).toHaveCount(5);
  await expect(page.locator('[data-renderer="skeleton"]')).toHaveCount(5);
  await expect(page.locator('[data-renderer="lenny"] image')).toHaveCount(70);
  await page.screenshot({ path: 'test-results/pictogram-known-poses.png', fullPage: true });
  await page.getByLabel('Target character').selectOption('human');
  await expect(page.locator('[data-renderer="human"]')).toHaveCount(5);
  await page.screenshot({ path: 'test-results/pictogram-human-poses.png', fullPage: true });
  await page.getByLabel('Target character').selectOption('lenny');
  const song = await readySong(request);
  const chart = await (await request.get(`${api}/songs/${song.id}/bundles/${song.active_bundle_id}/chart`)).json();
  await page.getByLabel('Load prepared dance.json').setInputFiles({ name: 'dance.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(chart)) });
  await expect(page.locator('[data-renderer="lenny"]')).toHaveCount(chart.moves.length);
  await expect(page.locator('[data-renderer="skeleton"]')).toHaveCount(chart.moves.length);
  await page.screenshot({ path: 'test-results/pictogram-prepared-poses.png', fullPage: true });
  expect(failedAssets).toEqual([]); expect(errors).toEqual([]);
});

test('artwork toggle keeps the same video, playback position and score', async ({ page, request }) => {
  const song = await readySong(request);
  await page.goto('/');
  await page.getByRole('button', { name: song.title, exact: true }).click();
  await expect(page.locator('[data-renderer="lenny"]').first()).toBeVisible();
  const video = page.getByLabel('Reference video');
  const node = await video.elementHandle();
  await page.getByRole('button', { name: 'Play / pause', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(.2);
  await page.getByRole('button', { name: 'Play / pause', exact: true }).click();
  const position = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  const score = await page.getByLabel('Score', { exact: true }).textContent();
  await page.getByLabel('Target character').selectOption('human');
  await expect(page.locator('[data-renderer="human"]').first()).toBeVisible();
  await page.getByLabel('Target character').selectOption('lenny');
  const checkbox = page.getByRole('checkbox', { name: 'Show target skeleton instead of artwork' });
  await checkbox.check();
  await expect(page.locator('[data-renderer="lenny"]')).toHaveCount(0);
  await checkbox.uncheck();
  await expect(page.locator('[data-renderer="lenny"]').first()).toBeVisible();
  expect(await node!.evaluate(n => n === document.querySelector('[aria-label="Reference video"]'))).toBe(true);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(position);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(page.getByLabel('Score', { exact: true })).toHaveText(score!);
});

test('failed artwork falls back to targets while a keyboard round can still finish', async ({ page, request }) => {
  const song = await readySong(request);
  await page.route('**/pictograms/lenny/*.png', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: song.title, exact: true }).click();
  await expect(page.getByText('Artwork unavailable; showing skeleton.', { exact: false }).first()).toBeVisible();
  await expect(page.locator('[data-renderer="lenny"]')).toHaveCount(0);
  await expect(page.locator('[data-renderer="skeleton"]').first()).toBeVisible();
  await page.getByLabel('Reference video').evaluate((v: HTMLVideoElement) => { v.playbackRate = 8; });
  await page.getByRole('button', { name: 'Play / pause', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Results', exact: true })).toBeVisible({ timeout: 20000 });
});


test('both palettes are baked into the shipped pixels with transparent backgrounds', async ({ page }) => {
  await page.goto('/debug/pictograms.html');
  for (const character of ['lenny', 'human']) {
    await page.getByLabel('Target character').selectOption(character);
    await expect(page.locator(`[data-renderer="${character}"]`)).toHaveCount(5);
    const colors = await page.locator(`[data-renderer="${character}"]`).first().evaluate(async svg => {
      const counts: Record<string, { green: number; blue: number; cream: number; dark: number; transparent: number }> = {};
      for (const element of svg.querySelectorAll('image')) {
        const image = new Image(); image.src = element.getAttribute('href')!; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
        const count = { green: 0, blue: 0, cream: 0, dark: 0, transparent: 0 };
        for (let i = 0; i < pixels.length; i += 4) {
          const [r, g, b, a] = pixels.slice(i, i + 4);
          if (a === 0) count.transparent++;
          if (a < 240) continue;
          if (g > r * 1.2 && g > b * 1.2 && g > 100) count.green++;
          if (b > r * 1.5 && b > g * 1.2 && b > 130) count.blue++;
          if (r > 210 && g > 205 && b < 220) count.cream++;
          if (r < 60 && g < 80 && b < 90) count.dark++;
        }
        counts[element.getAttribute('data-part')!] = count;
      }
      return counts;
    });
    for (const [name, part] of Object.entries(colors)) {
      expect(part.transparent).toBeGreaterThan(0);
      expect(part.dark).toBeGreaterThan(20);
      expect(character === 'lenny' ? part.green + part.cream : part.blue, `${character}/${name} needs a solid fill`).toBeGreaterThan(100);
    }
    if (character === 'lenny') {
      expect(colors.body.cream).toBeGreaterThan(100);
      expect(colors.head.green).toBeGreaterThan(100);
    }
  }
});
