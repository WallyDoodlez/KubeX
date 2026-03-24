import { test, expect } from '@playwright/test';

/**
 * Iteration 76: System-wide notification preferences
 *
 * Tests the Notifications section in Settings:
 * - Master toast enable/disable toggle
 * - Per-type toggles: success, error, warning, info
 * - Suppressed toast types are not displayed
 * - Preferences persist across navigation
 * - Reset Settings restores notification prefs to defaults
 */

// ── Helpers ──────────────────────────────────────────────────────────

/** Mock the kill-all endpoint so the success toast fires reliably. */
async function setupKillAllMock(page: import('@playwright/test').Page) {
  await page.route('**/kubexes', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify([]) });
  });
  await page.route('**/kubexes/kill-all', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify({ status: 'ok', message: 'All kubexes have been killed' }) });
  });
}

/** Fire the kill-all action so a 'success' toast is emitted. */
async function fireSuccessToast(page: import('@playwright/test').Page) {
  await setupKillAllMock(page);
  await page.getByTestId('kill-all-button').click();
  const dialog = page.getByRole('dialog', { name: /kill all kubexes/i });
  await dialog.getByRole('textbox').fill('KILL ALL');
  await dialog.getByRole('button', { name: /kill all kubexes/i }).click();
}

test.describe('Notification Preferences', () => {

  test.beforeEach(async ({ page }) => {
    // Clear settings so defaults apply cleanly
    await page.addInitScript(() => {
      localStorage.removeItem('kubex-settings');
    });
    await page.goto('/settings');
    await page.waitForSelector('[data-testid="settings-page"]', { timeout: 10_000 });
  });

  // ── Section presence ──────────────────────────────────────────────

  test('Notifications section is present in settings', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /notifications/i })).toBeVisible();
  });

  test('master toast toggle is visible and on by default', async ({ page }) => {
    const toggle = page.getByTestId('settings-toasts-enabled');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('per-type success toggle is visible and on by default', async ({ page }) => {
    const toggle = page.getByTestId('settings-toast-success');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('per-type error toggle is visible and on by default', async ({ page }) => {
    await expect(page.getByTestId('settings-toast-error')).toHaveAttribute('aria-checked', 'true');
  });

  test('per-type warning toggle is visible and on by default', async ({ page }) => {
    await expect(page.getByTestId('settings-toast-warning')).toHaveAttribute('aria-checked', 'true');
  });

  test('per-type info toggle is visible and on by default', async ({ page }) => {
    await expect(page.getByTestId('settings-toast-info')).toHaveAttribute('aria-checked', 'true');
  });

  // ── Master toggle interaction ─────────────────────────────────────

  test('turning off master toast toggle disables all per-type toggles', async ({ page }) => {
    await page.getByTestId('settings-toasts-enabled').click();
    await expect(page.getByTestId('settings-toasts-enabled')).toHaveAttribute('aria-checked', 'false');
    // Per-type toggles should be disabled (rendered as disabled buttons)
    await expect(page.getByTestId('settings-toast-success')).toBeDisabled();
    await expect(page.getByTestId('settings-toast-error')).toBeDisabled();
    await expect(page.getByTestId('settings-toast-warning')).toBeDisabled();
    await expect(page.getByTestId('settings-toast-info')).toBeDisabled();
  });

  test('turning master toast toggle off suppresses success toasts', async ({ page }) => {
    // Disable all toasts
    await page.getByTestId('settings-toasts-enabled').click();
    await expect(page.getByTestId('settings-toasts-enabled')).toHaveAttribute('aria-checked', 'false');

    // Navigate to containers page and fire a success toast
    await page.goto('/containers');
    await fireSuccessToast(page);

    // Toast should NOT appear
    await expect(page.getByTestId('toast')).not.toBeVisible();
  });

  test('re-enabling master toggle re-enables all per-type toggles', async ({ page }) => {
    // Disable then re-enable
    await page.getByTestId('settings-toasts-enabled').click();
    await page.getByTestId('settings-toasts-enabled').click();
    await expect(page.getByTestId('settings-toast-success')).not.toBeDisabled();
    await expect(page.getByTestId('settings-toast-error')).not.toBeDisabled();
  });

  // ── Per-type toggle — suppress individual type ────────────────────

  test('turning off success type suppresses success toasts', async ({ page }) => {
    // Disable success toasts
    await page.getByTestId('settings-toast-success').click();
    await expect(page.getByTestId('settings-toast-success')).toHaveAttribute('aria-checked', 'false');

    // Navigate to containers and fire success toast
    await page.goto('/containers');
    await fireSuccessToast(page);

    // Toast should NOT appear
    await expect(page.getByTestId('toast')).not.toBeVisible();
  });

  test('disabling success type does not suppress info toasts', async ({ page }) => {
    // This is hard to verify directly without a dedicated info toast trigger.
    // We verify at the settings level: info toggle remains enabled.
    await page.getByTestId('settings-toast-success').click();
    await expect(page.getByTestId('settings-toast-info')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('settings-toast-info')).not.toBeDisabled();
  });

  // ── Persistence ───────────────────────────────────────────────────

  test('notification preferences persist across navigation', async ({ page }) => {
    // Disable success toasts
    await page.getByTestId('settings-toast-success').click();
    await expect(page.getByTestId('settings-toast-success')).toHaveAttribute('aria-checked', 'false');

    // Navigate away via SPA (sidebar click keeps React state / localStorage intact)
    await page.getByRole('button', { name: /dashboard.*system overview/i }).click();
    await expect(page).toHaveURL('/');

    // Navigate back via SPA
    await page.getByRole('button', { name: /settings.*preferences/i }).click();
    await expect(page).toHaveURL('/settings');
    await page.waitForSelector('[data-testid="settings-page"]');

    // Preference should still be off (in-memory via SettingsProvider)
    await expect(page.getByTestId('settings-toast-success')).toHaveAttribute('aria-checked', 'false');
  });

  test('notification preferences are saved to localStorage', async ({ page }) => {
    await page.getByTestId('settings-toast-warning').click();
    const stored = await page.evaluate(() => localStorage.getItem('kubex-settings'));
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.notificationPrefs?.showWarning).toBe(false);
  });

  // ── Reset ────────────────────────────────────────────────────────

  test('reset settings restores notification preferences to defaults', async ({ page }) => {
    // Disable some prefs
    await page.getByTestId('settings-toasts-enabled').click();
    await expect(page.getByTestId('settings-toasts-enabled')).toHaveAttribute('aria-checked', 'false');

    // Reset (double-click for confirmation)
    await page.getByTestId('settings-reset').click();
    await page.getByTestId('settings-reset').click();

    // Master toggle should be back on
    await expect(page.getByTestId('settings-toasts-enabled')).toHaveAttribute('aria-checked', 'true');
  });

  test('reset settings restores per-type prefs to defaults', async ({ page }) => {
    await page.getByTestId('settings-toast-success').click();
    await page.getByTestId('settings-toast-warning').click();

    // Reset
    await page.getByTestId('settings-reset').click();
    await page.getByTestId('settings-reset').click();

    await expect(page.getByTestId('settings-toast-success')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('settings-toast-warning')).toHaveAttribute('aria-checked', 'true');
  });
});
