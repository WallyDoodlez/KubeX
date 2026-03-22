import { test, expect } from '@playwright/test';

/**
 * Iteration 23: Notification Center
 *
 * Tests the bell icon button, unread count badge, notification history
 * dropdown, mark-all-read, clear-all, and the toast→notification mirroring.
 */

/** Helper: intercept the kill-all API call to return success, open the dialog, and confirm. */
async function fireKillAllToast(page: import('@playwright/test').Page) {
  // Intercept relevant Manager API calls so the toast always fires as 'success'
  await page.route('**/kubexes', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify([]) });
  });
  await page.route('**/kubexes/kill-all', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify({ status: 'ok', message: 'All kubexes killed' }) });
  });
  await page.getByTestId('kill-all-button').click();
  const dialog = page.getByRole('dialog', { name: /kill all kubexes/i });
  await dialog.getByRole('textbox').fill('KILL ALL');
  await dialog.getByRole('button', { name: /kill all kubexes/i }).click();
  // Wait for the success toast to confirm the action completed
  await expect(page.getByTestId('toast')).toBeVisible({ timeout: 3000 });
}

test.describe('Notification Center', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // ── Presence ──────────────────────────────────────────────────────────

  test('bell button is visible in the top bar', async ({ page }) => {
    await expect(page.getByTestId('notification-bell')).toBeVisible();
  });

  test('bell button has correct aria-label when no unread', async ({ page }) => {
    const bell = page.getByTestId('notification-bell');
    await expect(bell).toHaveAttribute('aria-label', 'Notifications');
  });

  test('bell button has aria-expanded=false when closed', async ({ page }) => {
    const bell = page.getByTestId('notification-bell');
    await expect(bell).toHaveAttribute('aria-expanded', 'false');
  });

  test('no unread badge is shown when there are no notifications', async ({ page }) => {
    await expect(page.getByTestId('notification-badge')).not.toBeVisible();
  });

  // ── Dropdown open/close ───────────────────────────────────────────────

  test('clicking bell opens the notification dropdown', async ({ page }) => {
    await page.getByTestId('notification-bell').click();
    await expect(page.getByTestId('notification-dropdown')).toBeVisible();
  });

  test('dropdown has role=dialog with accessible label', async ({ page }) => {
    await page.getByTestId('notification-bell').click();
    const dropdown = page.getByTestId('notification-dropdown');
    await expect(dropdown).toHaveAttribute('role', 'dialog');
    await expect(dropdown).toHaveAttribute('aria-label', 'Notification history');
  });

  test('aria-expanded becomes true when dropdown is open', async ({ page }) => {
    await page.getByTestId('notification-bell').click();
    await expect(page.getByTestId('notification-bell')).toHaveAttribute('aria-expanded', 'true');
  });

  test('clicking bell again closes the dropdown', async ({ page }) => {
    const bell = page.getByTestId('notification-bell');
    await bell.click();
    await expect(page.getByTestId('notification-dropdown')).toBeVisible();
    await bell.click();
    await expect(page.getByTestId('notification-dropdown')).not.toBeVisible();
  });

  test('pressing Escape closes the dropdown', async ({ page }) => {
    await page.getByTestId('notification-bell').click();
    await expect(page.getByTestId('notification-dropdown')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('notification-dropdown')).not.toBeVisible();
  });

  test('clicking outside the dropdown closes it', async ({ page }) => {
    await page.getByTestId('notification-bell').click();
    await expect(page.getByTestId('notification-dropdown')).toBeVisible();
    // Click the top-left corner (outside the notification center)
    await page.mouse.click(10, 10);
    await expect(page.getByTestId('notification-dropdown')).not.toBeVisible();
  });

  // ── Empty state ───────────────────────────────────────────────────────

  test('empty state is shown when no notifications exist', async ({ page }) => {
    await page.getByTestId('notification-bell').click();
    const dropdown = page.getByTestId('notification-dropdown');
    await expect(dropdown).toContainText('No notifications yet');
  });

  test('empty state explains where notifications come from', async ({ page }) => {
    await page.getByTestId('notification-bell').click();
    await expect(page.getByTestId('notification-dropdown')).toContainText('Toasts, errors, and alerts will appear here');
  });

  // ── Toast mirroring ───────────────────────────────────────────────────

  test('firing a toast adds an entry to notification history', async ({ page }) => {
    await fireKillAllToast(page);
    // Now open notification center
    await page.getByTestId('notification-bell').click();
    const items = page.getByTestId('notification-item');
    await expect(items).toHaveCount(1);
  });

  test('notification item shows the same message as the toast', async ({ page }) => {
    await fireKillAllToast(page);
    await page.getByTestId('notification-bell').click();
    const item = page.getByTestId('notification-item').first();
    await expect(item).toContainText('All kubexes have been killed');
  });

  test('unread badge appears after a toast fires', async ({ page }) => {
    await fireKillAllToast(page);
    // Badge should now be visible (we haven't opened the dropdown yet)
    await expect(page.getByTestId('notification-badge')).toBeVisible();
  });

  test('bell aria-label updates to include unread count after a notification', async ({ page }) => {
    await fireKillAllToast(page);
    const bell = page.getByTestId('notification-bell');
    await expect(bell).toHaveAttribute('aria-label', 'Notifications — 1 unread');
  });

  // ── Unread → read flow ────────────────────────────────────────────────

  test('mark all read button removes the unread badge', async ({ page }) => {
    await fireKillAllToast(page);
    // Open dropdown — auto-markAllRead fires after 300ms
    await page.getByTestId('notification-bell').click();
    await expect(page.getByTestId('notification-mark-all-read')).toBeVisible();
    await page.getByTestId('notification-mark-all-read').click();
    await expect(page.getByTestId('notification-badge')).not.toBeVisible();
  });

  test('notification item is marked as read after mark-all-read', async ({ page }) => {
    await fireKillAllToast(page);
    await page.getByTestId('notification-bell').click();
    await page.getByTestId('notification-mark-all-read').click();
    const item = page.getByTestId('notification-item').first();
    await expect(item).toHaveAttribute('data-read', 'true');
  });

  // ── Clear all ─────────────────────────────────────────────────────────

  test('clear all removes all notifications from the list', async ({ page }) => {
    await fireKillAllToast(page);
    await page.getByTestId('notification-bell').click();
    await expect(page.getByTestId('notification-item')).toHaveCount(1);
    await page.getByTestId('notification-clear-all').click();
    await expect(page.getByTestId('notification-dropdown')).toContainText('No notifications yet');
    await expect(page.getByTestId('notification-item')).toHaveCount(0);
  });

  test('clear all also clears the unread badge', async ({ page }) => {
    await fireKillAllToast(page);
    await page.getByTestId('notification-bell').click();
    await page.getByTestId('notification-clear-all').click();
    await expect(page.getByTestId('notification-badge')).not.toBeVisible();
  });

  // ── Presence across pages ─────────────────────────────────────────────

  test('notification bell is visible on all main pages', async ({ page }) => {
    const paths = ['/', '/agents', '/traffic', '/chat', '/containers', '/approvals'];
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByTestId('notification-bell')).toBeVisible();
    }
  });

  // ── Accessibility ──────────────────────────────────────────────────────

  test('bell button is keyboard focusable', async ({ page }) => {
    const bell = page.getByTestId('notification-bell');
    await bell.focus();
    await expect(bell).toBeFocused();
  });

  test('bell button can be activated with Enter key', async ({ page }) => {
    const bell = page.getByTestId('notification-bell');
    await bell.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('notification-dropdown')).toBeVisible();
  });

  test('dropdown has aria-live=polite notification log region', async ({ page }) => {
    await page.getByTestId('notification-bell').click();
    const logRegion = page.locator('[role="log"]');
    await expect(logRegion).toHaveAttribute('aria-live', 'polite');
  });
});
