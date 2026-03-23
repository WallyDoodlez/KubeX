import { test, expect } from '@playwright/test';

/**
 * Iteration 40: Inline Help / Onboarding Tour
 *
 * The tour is NOT auto-started — it is triggered from Settings "Restart Tour"
 * or by manually setting localStorage state. Tests activate the tour by
 * injecting the active state before page load.
 */

/** Inject tour-active state so the tour appears on next navigation */
async function activateTour(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('kubex-onboarding', JSON.stringify({ completed: false, currentStep: 0, active: true }));
  });
}

/** Inject tour-completed state so the tour does NOT appear */
async function completeTour(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('kubex-onboarding', JSON.stringify({ completed: true, currentStep: 0, active: false }));
  });
}

test.describe('Onboarding Tour', () => {

  // ── Tour activation ──────────────────────────────────────────────────

  test('tour overlay appears when active', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-overlay')).toBeVisible({ timeout: 3000 });
  });

  test('tour tooltip is visible when active', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-tooltip')).toBeVisible({ timeout: 3000 });
  });

  test('tour does not appear when already completed', async ({ page }) => {
    await completeTour(page);
    await page.goto('/');
    await page.waitForTimeout(500);
    await expect(page.getByTestId('onboarding-tooltip')).not.toBeVisible();
  });

  // ── Step 0 content ────────────────────────────────────────────────────

  test('step 1 title is "Command Palette"', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-step-title')).toHaveText('Command Palette', { timeout: 3000 });
  });

  test('step 1 description mentions Ctrl+K', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-step-description')).toContainText('Ctrl+K', { timeout: 3000 });
  });

  test('step indicator shows 1 / 5', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    const tooltip = page.getByTestId('onboarding-tooltip');
    await expect(tooltip).toContainText('1 / 5', { timeout: 3000 });
  });

  // ── Navigation ────────────────────────────────────────────────────────

  test('Next button advances to step 2', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    await page.getByTestId('onboarding-next').click();
    await expect(page.getByTestId('onboarding-step-title')).toHaveText('Quick Dispatch', { timeout: 3000 });
  });

  test('step 2 description mentions Ctrl+D', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    await page.getByTestId('onboarding-next').click();
    await expect(page.getByTestId('onboarding-step-description')).toContainText('Ctrl+D', { timeout: 3000 });
  });

  test('can advance through all 5 steps', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    for (let i = 0; i < 4; i++) {
      await expect(page.getByTestId('onboarding-next')).toBeVisible({ timeout: 3000 });
      await page.getByTestId('onboarding-next').click();
    }
    await expect(page.getByTestId('onboarding-next')).toHaveText('Done', { timeout: 3000 });
  });

  test('clicking Done dismisses the tour', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    for (let i = 0; i < 4; i++) await page.getByTestId('onboarding-next').click();
    await page.getByTestId('onboarding-next').click(); // Done
    await expect(page.getByTestId('onboarding-tooltip')).not.toBeVisible({ timeout: 3000 });
  });

  test('Done marks tour as completed in localStorage', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    for (let i = 0; i < 4; i++) await page.getByTestId('onboarding-next').click();
    await page.getByTestId('onboarding-next').click();
    const state = await page.evaluate(() => {
      const raw = localStorage.getItem('kubex-onboarding');
      return raw ? JSON.parse(raw) : null;
    });
    expect(state?.completed).toBe(true);
  });

  // ── Skip ──────────────────────────────────────────────────────────────

  test('Skip button (x) dismisses the tour', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    await page.getByTestId('onboarding-skip').click();
    await expect(page.getByTestId('onboarding-tooltip')).not.toBeVisible({ timeout: 3000 });
  });

  test('"Skip tour" link dismisses the tour', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    await page.getByTestId('onboarding-skip-link').click();
    await expect(page.getByTestId('onboarding-tooltip')).not.toBeVisible({ timeout: 3000 });
  });

  test('Skip marks tour as completed in localStorage', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    await page.getByTestId('onboarding-skip').click();
    const state = await page.evaluate(() => {
      const raw = localStorage.getItem('kubex-onboarding');
      return raw ? JSON.parse(raw) : null;
    });
    expect(state?.completed).toBe(true);
  });

  // ── Spotlight ─────────────────────────────────────────────────────────

  test('spotlight ring is visible during tour', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-spotlight')).toBeVisible({ timeout: 3000 });
  });

  // ── Accessibility ─────────────────────────────────────────────────────

  test('tooltip has role="dialog"', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-tooltip')).toHaveAttribute('role', 'dialog', { timeout: 3000 });
  });

  test('tooltip has accessible aria-label', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    const label = await page.getByTestId('onboarding-tooltip').getAttribute('aria-label');
    expect(label).toContain('Onboarding step 1 of 5');
  });

  test('skip button has aria-label', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-skip')).toHaveAttribute('aria-label', 'Skip onboarding tour');
  });

  // ── Settings page restart ─────────────────────────────────────────────

  test('Settings page has "Restart Tour" button', async ({ page }) => {
    await completeTour(page);
    await page.goto('/settings');
    const btn = page.getByTestId('settings-restart-tour');
    await btn.scrollIntoViewIfNeeded();
    await expect(btn).toBeVisible();
  });

  test('Restart Tour button resets localStorage state', async ({ page }) => {
    await completeTour(page);
    await page.goto('/settings');
    const btn = page.getByTestId('settings-restart-tour');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    const state = await page.evaluate(() => {
      const raw = localStorage.getItem('kubex-onboarding');
      return raw ? JSON.parse(raw) : null;
    });
    expect(state?.completed).toBe(false);
  });
});
