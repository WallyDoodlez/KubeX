import { test, expect } from '@playwright/test';

test.describe('Error Recovery', () => {
  test('app renders without crashing on all routes', async ({ page }) => {
    // Each route should load without triggering the error boundary
    const routes = ['/', '/agents', '/traffic', '/chat', '/containers'];

    for (const route of routes) {
      await page.goto(route);
      // Error boundary fallback should NOT be visible
      await expect(page.locator('text=Something went wrong')).not.toBeVisible();
      // The sidebar should still be present (app shell intact)
      await expect(page.locator('aside')).toBeVisible();
    }
  });

  test('navigation continues to work after visiting all routes', async ({ page }) => {
    await page.goto('/');

    // Click through all nav items rapidly
    const navItems = ['Agents', 'Traffic', 'Orchestrator', 'Containers', 'Dashboard'];

    for (const label of navItems) {
      await page.locator('aside').getByText(label, { exact: true }).click();
      await expect(page.locator('header h1')).toHaveText(label === 'Dashboard' ? 'Dashboard' : label);
    }

    // App should still be functional — no error boundary triggered
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('app shell remains intact under normal operation', async ({ page }) => {
    await page.goto('/');

    // Verify key UI elements are present
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('text=KubexClaw')).toBeVisible();
    await expect(page.locator('text=live')).toBeVisible();

    // Navigate to a different page and verify shell persists
    await page.locator('aside').getByText('Agents', { exact: true }).click();
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('header h1')).toHaveText('Agents');
  });
});
