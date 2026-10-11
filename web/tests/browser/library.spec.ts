import { test, expect } from '@playwright/test';

test('library deletion confirms, preserves failures and accepts an empty success response', async ({ page }) => {
  let songs = [{ id: 'delete-review', title: 'Library test dance', status: 'pending', duration: 30 }];
  let deletes = 0;
  let failDelete = true;
  await page.route('**/songs', route => route.fulfill({ json: songs }));
  await page.route('**/songs/delete-review', route => {
    if (route.request().method() !== 'DELETE') return route.fulfill({ json: songs[0] });
    deletes++;
    if (failDelete) return route.fulfill({ status: 500, json: { detail: 'Could not delete song' } });
    songs = [];
    return route.fulfill({ status: 204 });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose video', exact: true }).click();
  const remove = page.getByRole('button', { name: 'Delete Library test dance', exact: true });
  await remove.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('saved play history');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(deletes).toBe(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await dialog.getByRole('button', { name: 'Delete song', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not delete song');
  await expect(remove).toBeVisible();
  failDelete = false;
  await remove.click();
  await dialog.getByRole('button', { name: 'Delete song', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your dance floor is waiting' })).toBeVisible();
  expect(deletes).toBe(2);
});
