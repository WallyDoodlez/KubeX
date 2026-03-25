import { test, expect } from '@playwright/test';

/**
 * Iteration 24: Settings and Preferences page
 *
 * Tests the Settings nav item, /settings route, and all sections:
 * - Appearance (theme selector)
 * - Connection (manager token, service endpoints)
 * - Data (auto-refresh toggle, polling interval, page size, clear actions)
 * - About (version info)
 * - Reset (restore defaults)
 */

test.describe('Settings Page', () => {

  test.beforeEach(async ({ page }) => {
    // Clear only the settings-specific keys — kubex-onboarding is kept at
    // "completed" via the global storageState so the onboarding tour overlay
    // never fires and blocks element visibility / ARIA accessibility.
    await page.addInitScript(() => {
      localStorage.removeItem('kubex-theme');
      localStorage.removeItem('kubex-settings');
    });
    // Navigate directly to /settings and wait for the lazy chunk to render
    // so every test starts from a fully-loaded settings page.
    await page.goto('/settings');
    await page.waitForSelector('[data-testid="settings-page"]', { timeout: 10_000 });
  });

  // ── Navigation ────────────────────────────────────────────────────

  test('Settings nav item is present in the sidebar', async ({ page }) => {
    // Navigate to dashboard first so the sidebar nav is meaningful
    await page.goto('/');
    await expect(page.getByRole('button', { name: /settings/i })).toBeVisible();
  });

  test('clicking Settings nav item navigates to /settings', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /settings.*preferences/i }).click();
    await expect(page).toHaveURL('/settings');
  });

  test('settings page renders with main heading', async ({ page }) => {
    // The Settings page lazy-chunk renders an h1 "Settings & Preferences".
    // The Layout top bar also has a smaller h1 "Settings" (nav item label).
    // We target the page-level heading inside the settings container.
    const heading = page.getByTestId('settings-page').getByRole('heading', { level: 1 });
    await expect(heading).toContainText('Settings');
    await expect(heading).toContainText('Preferences');
  });

  test('settings page is accessible via direct URL', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('settings-page')).toBeVisible();
  });

  test('settings page has aria-label on main container', async ({ page }) => {
    await page.goto('/settings');
    const main = page.getByTestId('settings-page');
    await expect(main).toHaveAttribute('aria-label', 'Settings and Preferences');
  });

  // ── Appearance section ────────────────────────────────────────────

  test('Appearance section is present with theme selector', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /appearance/i })).toBeVisible();
    await expect(page.getByTestId('settings-theme-select')).toBeVisible();
  });

  test('theme selector shows "Dark" as default', async ({ page }) => {
    await page.goto('/settings');
    const select = page.getByTestId('settings-theme-select');
    await expect(select).toHaveValue('dark');
  });

  test('changing theme selector to Light applies light mode', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('settings-theme-select').selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('changing theme selector back to Dark removes data-theme', async ({ page }) => {
    await page.goto('/settings');
    // First go light
    await page.getByTestId('settings-theme-select').selectOption('light');
    // Then back to dark
    await page.getByTestId('settings-theme-select').selectOption('dark');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');
  });

  // ── Connection section ────────────────────────────────────────────

  test('Connection section is present', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /connection/i })).toBeVisible();
  });

  test('token status is displayed (Configured or Not set)', async ({ page }) => {
    await page.goto('/settings');
    const status = page.getByTestId('settings-token-status');
    // Status should show either "Configured" or "Not set" depending on env
    await expect(status).toBeVisible();
    const text = await status.textContent();
    expect(text).toMatch(/Configured|Not set/);
  });

  test('clicking Change/Set Token shows the token input field', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('settings-token-edit').click();
    await expect(page.getByTestId('settings-token-input')).toBeVisible();
  });

  test('saving a token updates the token status to Configured', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('settings-token-edit').click();
    await page.getByTestId('settings-token-input').fill('my-secret-token');
    await page.getByTestId('settings-token-save').click();
    await expect(page.getByTestId('settings-token-status')).toContainText('Configured');
  });

  test('cancelling token edit hides the input', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('settings-token-edit').click();
    await page.getByTestId('settings-token-input').fill('some-token');
    await page.getByTestId('settings-token-cancel').click();
    await expect(page.getByTestId('settings-token-input')).not.toBeVisible();
    // Status should still be visible (unchanged)
    await expect(page.getByTestId('settings-token-status')).toBeVisible();
  });

  test('service endpoints section is visible with Gateway URL', async ({ page }) => {
    await page.goto('/settings');
    const endpoints = page.getByTestId('settings-endpoints');
    await expect(endpoints).toBeVisible();
    await expect(endpoints).toContainText('Gateway');
    await expect(endpoints).toContainText('localhost:8080');
  });

  // ── Data section ──────────────────────────────────────────────────

  test('Data section is present with auto-refresh toggle', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /^data$/i })).toBeVisible();
    await expect(page.getByTestId('settings-auto-refresh')).toBeVisible();
  });

  test('auto-refresh toggle is on by default', async ({ page }) => {
    await page.goto('/settings');
    const toggle = page.getByTestId('settings-auto-refresh');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('clicking auto-refresh toggle turns it off', async ({ page }) => {
    await page.goto('/settings');
    const toggle = page.getByTestId('settings-auto-refresh');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('polling interval select has default value of 10000', async ({ page }) => {
    await page.goto('/settings');
    const select = page.getByTestId('settings-polling-interval');
    await expect(select).toHaveValue('10000');
  });

  test('polling interval can be changed to 30 seconds', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('settings-polling-interval').selectOption('30000');
    await expect(page.getByTestId('settings-polling-interval')).toHaveValue('30000');
  });

  test('page size select has default value of 20', async ({ page }) => {
    await page.goto('/settings');
    const select = page.getByTestId('settings-page-size');
    await expect(select).toHaveValue('20');
  });

  test('page size can be changed to 50', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('settings-page-size').selectOption('50');
    await expect(page.getByTestId('settings-page-size')).toHaveValue('50');
  });

  test('Clear Log button is visible', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('settings-clear-traffic')).toBeVisible();
  });

  test('Clear Log requires confirmation — first click shows "Confirm Clear?"', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('settings-clear-traffic').click();
    await expect(page.getByTestId('settings-clear-traffic')).toContainText('Confirm Clear?');
  });

  test('Clear Chat requires confirmation — first click shows "Confirm Clear?"', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('settings-clear-chat').click();
    await expect(page.getByTestId('settings-clear-chat')).toContainText('Confirm Clear?');
  });

  // ── About section ─────────────────────────────────────────────────

  test('About section is present with version info', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /about/i })).toBeVisible();
    const about = page.getByTestId('settings-about');
    await expect(about).toBeVisible();
    await expect(about).toContainText('v1.1');
  });

  test('About section shows Iteration 76 build info', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('settings-about')).toContainText('Iteration 76');
  });

  // ── Reset section ─────────────────────────────────────────────────

  test('Reset section is present with reset button', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /reset/i })).toBeVisible();
    await expect(page.getByTestId('settings-reset')).toBeVisible();
  });

  test('Reset requires confirmation — first click shows "Confirm Reset?"', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('settings-reset').click();
    await expect(page.getByTestId('settings-reset')).toContainText('Confirm Reset?');
  });

  test('confirming reset restores polling interval to default', async ({ page }) => {
    await page.goto('/settings');
    // Change polling interval
    await page.getByTestId('settings-polling-interval').selectOption('60000');
    await expect(page.getByTestId('settings-polling-interval')).toHaveValue('60000');
    // Reset — double click for confirmation
    await page.getByTestId('settings-reset').click();
    await page.getByTestId('settings-reset').click();
    // Should be back to 10000
    await expect(page.getByTestId('settings-polling-interval')).toHaveValue('10000');
  });

  // ── Persistence ───────────────────────────────────────────────────

  test('settings persist across page navigation', async ({ page }) => {
    await page.goto('/settings');
    // Change page size and wait for it to reflect
    await page.getByTestId('settings-page-size').selectOption('50');
    await expect(page.getByTestId('settings-page-size')).toHaveValue('50');
    // Navigate away using the sidebar (stays in SPA — provider stays mounted)
    await page.getByRole('button', { name: /dashboard.*system overview/i }).click();
    await expect(page).toHaveURL('/');
    // Navigate back via sidebar
    await page.getByRole('button', { name: /settings.*preferences/i }).click();
    await expect(page).toHaveURL('/settings');
    // Setting should still be 50 (in-memory via SettingsProvider which stays mounted)
    await expect(page.getByTestId('settings-page-size')).toHaveValue('50');
  });

  test('settings are written to localStorage on change', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('settings-polling-interval').selectOption('30000');
    await expect(page.getByTestId('settings-polling-interval')).toHaveValue('30000');
    // Verify localStorage was written (without navigating — addInitScript clears on every load)
    const stored = await page.evaluate(() => localStorage.getItem('kubex-settings'));
    expect(stored).toContain('30000');
  });

});
