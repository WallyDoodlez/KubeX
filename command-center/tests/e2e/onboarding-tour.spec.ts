import { test, expect } from '@playwright/test';

/**
 * Iteration 40: Inline Help / Onboarding Tour
 * Iteration 79: Onboarding Tour Refresh — extended to 8 steps covering
 *   features added in iterations 55-78 (notifications, spawn wizard, approvals).
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

/** Inject tour-active state at a specific step index */
async function activateTourAtStep(page: import('@playwright/test').Page, step: number) {
  await page.addInitScript((s: number) => {
    localStorage.setItem('kubex-onboarding', JSON.stringify({ completed: false, currentStep: s, active: true }));
  }, step);
}

/** Inject tour-completed state so the tour does NOT appear */
async function completeTour(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('kubex-onboarding', JSON.stringify({ completed: true, currentStep: 0, active: false }));
  });
}

const TOTAL_STEPS = 8;

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

  // ── Step 1 content (Command Palette) ──────────────────────────────────

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

  test(`step indicator shows 1 / ${TOTAL_STEPS}`, async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    const tooltip = page.getByTestId('onboarding-tooltip');
    await expect(tooltip).toContainText(`1 / ${TOTAL_STEPS}`, { timeout: 3000 });
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

  test(`can advance through all ${TOTAL_STEPS} steps`, async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    for (let i = 0; i < TOTAL_STEPS - 1; i++) {
      await expect(page.getByTestId('onboarding-next')).toBeVisible({ timeout: 3000 });
      await page.getByTestId('onboarding-next').click();
    }
    await expect(page.getByTestId('onboarding-next')).toHaveText('Done', { timeout: 3000 });
  });

  test('clicking Done dismisses the tour', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    for (let i = 0; i < TOTAL_STEPS - 1; i++) await page.getByTestId('onboarding-next').click();
    await page.getByTestId('onboarding-next').click(); // Done
    await expect(page.getByTestId('onboarding-tooltip')).not.toBeVisible({ timeout: 3000 });
  });

  test('Done marks tour as completed in localStorage', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    for (let i = 0; i < TOTAL_STEPS - 1; i++) await page.getByTestId('onboarding-next').click();
    await page.getByTestId('onboarding-next').click();
    const state = await page.evaluate(() => {
      const raw = localStorage.getItem('kubex-onboarding');
      return raw ? JSON.parse(raw) : null;
    });
    expect(state?.completed).toBe(true);
  });

  // ── New steps 6-8 content ─────────────────────────────────────────────

  test('step 6 title is "Notification Center"', async ({ page }) => {
    await activateTourAtStep(page, 5);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-step-title')).toHaveText('Notification Center', { timeout: 3000 });
  });

  test('step 6 description mentions bell icon', async ({ page }) => {
    await activateTourAtStep(page, 5);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-step-description')).toContainText('bell', { timeout: 3000 });
  });

  test('step 7 title is "Spawn Kubex Wizard"', async ({ page }) => {
    await activateTourAtStep(page, 6);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-step-title')).toHaveText('Spawn Kubex Wizard', { timeout: 3000 });
  });

  test('step 7 description mentions wizard', async ({ page }) => {
    await activateTourAtStep(page, 6);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-step-description')).toContainText('wizard', { timeout: 3000 });
  });

  test('step 8 title is "Approval Queue & HITL"', async ({ page }) => {
    await activateTourAtStep(page, 7);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-step-title')).toHaveText('Approval Queue & HITL', { timeout: 3000 });
  });

  test('step 8 description mentions escalations', async ({ page }) => {
    await activateTourAtStep(page, 7);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-step-description')).toContainText('escalation', { timeout: 3000 });
  });

  test('step 8 is the final "Done" step', async ({ page }) => {
    await activateTourAtStep(page, 7);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-next')).toHaveText('Done', { timeout: 3000 });
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
    expect(label).toContain(`Onboarding step 1 of ${TOTAL_STEPS}`);
  });

  test('skip button has aria-label', async ({ page }) => {
    await activateTour(page);
    await page.goto('/');
    await expect(page.getByTestId('onboarding-skip')).toHaveAttribute('aria-label', 'Skip onboarding tour');
  });

  // ── Sidebar nav testids (added in iteration 79) ──────────────────────

  test('sidebar nav link for Spawn Kubex has correct testid', async ({ page }) => {
    await completeTour(page);
    await page.goto('/');
    await expect(page.getByTestId('nav-spawn-kubex')).toBeVisible({ timeout: 3000 });
  });

  test('sidebar nav link for Approvals has correct testid', async ({ page }) => {
    await completeTour(page);
    await page.goto('/');
    await expect(page.getByTestId('nav-approvals')).toBeVisible({ timeout: 3000 });
  });

  test('sidebar nav link for Notification Center has correct testid', async ({ page }) => {
    await completeTour(page);
    await page.goto('/');
    await expect(page.getByTestId('notification-bell')).toBeVisible({ timeout: 3000 });
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
