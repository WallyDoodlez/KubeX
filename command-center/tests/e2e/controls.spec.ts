import { test, expect } from '@playwright/test';

test.describe('Emergency Controls (Top Bar)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // 1. Kill All button is present in top bar
  test('Kill All button is visible in the top bar', async ({ page }) => {
    await expect(page.getByTestId('kill-all-button')).toBeVisible();
    await expect(page.getByTestId('kill-all-button')).toContainText('Kill All');
  });

  // 2. Quick Actions button is present in top bar
  test('Quick Actions button is visible in the top bar', async ({ page }) => {
    await expect(page.getByTestId('quick-actions-button')).toBeVisible();
    await expect(page.getByTestId('quick-actions-button')).toContainText('Quick Actions');
  });

  // 3. Kill All dialog opens when clicking the button
  test('Kill All dialog opens on button click', async ({ page }) => {
    await page.getByTestId('kill-all-button').click();
    await expect(page.getByRole('dialog', { name: /kill all kubexes/i })).toBeVisible();
  });

  // 4. Kill All dialog requires typed confirmation
  test('Kill All dialog confirm button is disabled without typed confirmation', async ({ page }) => {
    await page.getByTestId('kill-all-button').click();
    const dialog = page.getByRole('dialog', { name: /kill all kubexes/i });
    await expect(dialog).toBeVisible();
    // The confirm button inside the dialog should be disabled when input is empty
    const confirmBtn = dialog.getByRole('button', { name: /kill all kubexes/i });
    await expect(confirmBtn).toBeDisabled();
  });

  // 5. Kill All dialog enables confirm button after typing "KILL ALL"
  test('Kill All confirm button enables after typing KILL ALL', async ({ page }) => {
    await page.getByTestId('kill-all-button').click();
    const dialog = page.getByRole('dialog', { name: /kill all kubexes/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox').fill('KILL ALL');
    const confirmBtn = dialog.getByRole('button', { name: /kill all kubexes/i });
    await expect(confirmBtn).toBeEnabled();
  });

  // 6. Kill All dialog closes on Cancel
  test('Kill All dialog closes when Cancel is clicked', async ({ page }) => {
    await page.getByTestId('kill-all-button').click();
    await expect(page.getByRole('dialog', { name: /kill all kubexes/i })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: /kill all kubexes/i })).not.toBeVisible();
  });

  // 7. Quick Actions menu opens and shows kubex instances section
  test('Quick Actions menu opens and shows kubex instances section', async ({ page }) => {
    await page.getByTestId('quick-actions-button').click();
    const menu = page.getByTestId('quick-actions-menu');
    await expect(menu).toBeVisible();
    // The menu header label should be present regardless of API connectivity
    await expect(menu.getByText('Kubex Instances')).toBeVisible();
  });

  // 8. Quick Actions menu closes on Escape key
  test('Quick Actions menu closes when Escape is pressed', async ({ page }) => {
    await page.getByTestId('quick-actions-button').click();
    await expect(page.getByTestId('quick-actions-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('quick-actions-menu')).not.toBeVisible();
  });
});
