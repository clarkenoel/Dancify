import { test, expect } from '@playwright/test';

// Empty/error fixtures exercise boundary UI only; full rounds use the real API/model.
test('menu typography and responsive pages use bundled fonts and preserve form drafts', async ({ page }) => {
  await page.route('**/songs', r => r.fulfill({ json: [] }));
  const failures: string[] = []; page.on('pageerror', e => failures.push(e.message));
  await page.goto('/'); await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('36px "Bungee Inline"') && document.fonts.check('26px "Jersey 25"'))).toBe(true);
  for (const width of [1440, 1920, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
    const play = page.getByRole('button', { name: 'Choose a song', exact: true });
    expect((await play.boundingBox())!.height).toBeGreaterThanOrEqual(80);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/pages-menu-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Import video', exact: true }).click();
  await page.getByLabel('Song title').fill('My dance draft');
  await page.getByLabel('Video URL', { exact: true }).fill('https://example.com/dance');
  await page.screenshot({ path: 'test-results/pages-import-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('button', { name: 'Import video', exact: true }).click();
  await expect(page.getByLabel('Song title')).toHaveValue('My dance draft');
  await expect(page.getByLabel('Video URL', { exact: true })).toHaveValue('https://example.com/dance');
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('button', { name: 'Choose a song', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your dance floor is waiting' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import video' })).toBeVisible();
  expect(failures).toEqual([]);
});

test('service error can recover and long real-library labels do not overflow', async ({ page }) => {
  let failing = true;
  const title = 'A very long dance title '.repeat(12);
  await page.route('**/songs', route => failing ? route.abort() : route.fulfill({ json: [{ id: 'boundary-song', title, status: 'pending', active_bundle_id: null }] }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Cannot reach');
  failing = false; await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose a song', exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: title.trim(), exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/pages-library-${width}.png`, fullPage: true });
  }
});
