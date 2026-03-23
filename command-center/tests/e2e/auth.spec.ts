import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('app loads with sidebar when token is configured via env', async ({ page }) => {
    // The dev server has VITE_MANAGER_TOKEN not set, so AuthGate may show.
    // But the app should still load and show navigation.
    await page.goto('/');
    // At minimum the app shell loads
    await expect(page.locator('aside')).toBeVisible();
  });

  test('navigation works regardless of auth state', async ({ page }) => {
    await page.goto('/');
    // Should be able to navigate to all pages
    const navItems = ['Agents', 'Traffic', 'Orchestrator', 'Containers', 'Dashboard'];
    for (const label of navItems) {
      await page.locator('aside').getByText(label, { exact: true }).click();
      await expect(page.locator('header h1')).toHaveText(label);
    }
  });

  test('orchestrator page loads with input fields', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.locator('header h1')).toHaveText('Orchestrator');
    // The chat input area should be visible
    await expect(page.locator('[data-testid="message-input"]')).toBeVisible();
  });
});
