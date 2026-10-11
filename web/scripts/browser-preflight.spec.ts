import { test, expect } from '@playwright/test';

test('configured Chromium launches and renders before media preparation', async ({ page }) => {
  await page.setContent('<title>Dancify browser preflight</title><p>Browser ready</p>');
  await expect(page).toHaveTitle('Dancify browser preflight');
  await expect(page.getByText('Browser ready', { exact: true })).toBeVisible();
});
