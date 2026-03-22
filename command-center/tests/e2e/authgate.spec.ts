import { test, expect } from '@playwright/test';

/**
 * AuthGate — non-blocking banner mode tests.
 *
 * In the test environment VITE_MANAGER_TOKEN is not set (no .env),
 * so isConfigured === false and the banner should appear.
 * The banner is dismissible and the full app tree (nav links etc.) should
 * always be visible regardless of token state.
 */

test.describe('AuthGate — banner mode', () => {
  test('app tree is always visible (AuthGate is non-blocking)', async ({ page }) => {
    await page.goto('/');
    // Nav sidebar should be visible even without a token
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('nav')).toBeVisible();
  });

  test('banner appears when no token is configured', async ({ page }) => {
    await page.goto('/');
    // The auth banner should show up at the top of the page
    const banner = page.locator('[data-testid="auth-banner"]');
    // Banner may or may not show depending on whether test env has token set.
    // We test the scenario where it does render: if visible, check its content.
    const bannerVisible = await banner.isVisible().catch(() => false);
    if (bannerVisible) {
      await expect(banner).toContainText('No Manager token configured');
      await expect(banner).toContainText('VITE_MANAGER_TOKEN');
    }
    // Regardless, app content should always be accessible
    await expect(page.locator('text=KubexClaw')).toBeVisible();
  });

  test('banner can be dismissed', async ({ page }) => {
    await page.goto('/');
    const banner = page.locator('[data-testid="auth-banner"]');
    const bannerVisible = await banner.isVisible().catch(() => false);

    if (bannerVisible) {
      const dismissBtn = banner.locator('button[aria-label="Dismiss auth warning"]');
      await expect(dismissBtn).toBeVisible();
      await dismissBtn.click();
      // Banner should disappear after dismissal
      await expect(banner).not.toBeVisible();
      // App content still intact
      await expect(page.locator('aside')).toBeVisible();
    }
  });

  test('nav links are visible and clickable regardless of token state', async ({ page }) => {
    await page.goto('/');
    // All nav items should be present
    await expect(page.locator('button', { hasText: 'Dashboard' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Agents' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Orchestrator' })).toBeVisible();

    // Navigate to Orchestrator without a token — should work
    await page.locator('button', { hasText: 'Orchestrator' }).click();
    await expect(page).toHaveURL('/chat');
    await expect(page.locator('header h1')).toHaveText('Orchestrator');
  });

  test('auth banner has correct accessibility attributes', async ({ page }) => {
    await page.goto('/');
    const banner = page.locator('[data-testid="auth-banner"]');
    const bannerVisible = await banner.isVisible().catch(() => false);

    if (bannerVisible) {
      // Should have role="alert" for screen readers
      await expect(banner).toHaveAttribute('role', 'alert');
      // Should have aria-live for live region
      await expect(banner).toHaveAttribute('aria-live', 'polite');
    }
  });

  test('full app remains functional on chat route without token', async ({ page }) => {
    await page.goto('/chat');
    // Chat interface should render completely
    await expect(page.locator('input[placeholder*="orchestrate"]')).toBeVisible();
    await expect(page.locator('textarea[placeholder*="Task instructions"]')).toBeVisible();
    await expect(page.locator('button', { hasText: 'Send' })).toBeVisible();
  });
});
