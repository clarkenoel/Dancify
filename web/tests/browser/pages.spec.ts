import { test, expect } from '@playwright/test';

// Empty/error fixtures exercise boundary UI only; full rounds use the real API/model.
test('menu typography and responsive pages use bundled fonts and preserve form drafts', async ({ page }) => {
  await page.route('**/songs', r => r.fulfill({ json: [] }));
  const failures: string[] = []; page.on('pageerror', e => failures.push(e.message));
  await page.goto('/'); await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('36px "Bungee Inline"') && document.fonts.check('26px "Jersey 25"'))).toBe(true);
  for (const width of [1440, 1920, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
    const play = page.getByRole('button', { name: 'Choose video', exact: true });
    expect((await play.boundingBox())!.height).toBeGreaterThanOrEqual(70);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/pages-menu-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Import video', exact: true }).click();
  await page.getByText('Advanced · title and clip range', { exact: true }).click();
  await page.getByLabel('Song title').fill('My dance draft');
  await page.getByLabel('Video URL', { exact: true }).fill('https://example.com/dance');
  await page.screenshot({ path: 'test-results/pages-import-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('button', { name: 'Import video', exact: true }).click();
  await expect(page.getByLabel('Song title')).toHaveValue('My dance draft');
  await expect(page.getByLabel('Video URL', { exact: true })).toHaveValue('https://example.com/dance');
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your dance floor is waiting' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import video' })).toBeVisible();
  expect(failures).toEqual([]);
});

test('approved menu theme survives reload and reports the real controller state', async ({ page }) => {
  await page.route('**/songs', r => r.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Wearable · disconnected');
  await page.getByRole('button', { name: 'Light mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Light mode', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'test-results/approved-main-light.png' });
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/approved-main-dark.png' });
  await page.getByRole('button', { name: 'Developer tools', exact: true }).click();
  await page.getByText('Controller connection and testing', { exact: true }).click();
  await page.getByRole('button', { name: 'Connect simulated ESP32' }).click();
  await expect(page.getByRole('region', { name: 'Main menu actions' }).getByRole('status')).toHaveText('Wearable · connected (simulated)');
});

test('service error can recover and long real-library labels do not overflow', async ({ page }) => {
  let failing = true;
  const title = 'A very long dance title '.repeat(12);
  await page.route('**/songs', route => failing ? route.abort() : route.fulfill({ json: [{ id: 'boundary-song', title, status: 'pending', active_bundle_id: null }] }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Cannot reach');
  failing = false; await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: title.trim(), exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/pages-library-${width}.png`, fullPage: true });
  }
});

test('advanced import reveals invalid hidden fields and preserves the clip draft', async ({ page }) => {
  await page.route('**/songs', r => r.fulfill({ json: [] }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Import video', exact: true }).click();
  const advanced = page.getByText('Advanced · title and clip range', { exact: true });
  await expect(page.getByLabel('Song title')).not.toBeVisible();
  await page.getByLabel('Video URL', { exact: true }).fill('https://example.com/dance');
  await advanced.click();
  await page.getByLabel('Start time').fill('-1');
  await page.getByLabel('Song title').fill('A real draft');
  await advanced.click();
  await page.getByRole('button', { name: 'Prepare video', exact: true }).click();
  await expect(page.getByLabel('Start time')).toBeVisible();
  await expect(page.getByLabel('Start time')).toBeFocused();
  await page.getByRole('button', { name: 'Upload file', exact: true }).click();
  await expect(page.getByLabel('Song title')).toHaveValue('A real draft');
  await expect(page.getByLabel('Start time')).toHaveValue('-1');
  await page.getByLabel('Start time').fill('0');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/advanced-import-connected.png', fullPage: true });
});
