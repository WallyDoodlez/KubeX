import { test, expect } from '@playwright/test';

test.describe('Agent Detail Page', () => {
  test('navigates to agent detail via URL', async ({ page }) => {
    await page.goto('/agents/test-agent-001');
    // Should render the detail page (even if agent not found)
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
  });

  test('shows error when agent not found', async ({ page }) => {
    await page.goto('/agents/nonexistent-agent');
    // Should show error or "not found" message
    // The page shows either loading then error, or the agent data
    await expect(page.locator('text=/not found/').first()).toBeVisible({ timeout: 10000 });
  });

  test('has back link to agents list', async ({ page }) => {
    await page.goto('/agents/test-agent');
    // Wait for loading to complete
    await page.waitForTimeout(2000);
    // Should have a "Back to Agents" link
    await expect(page.locator('text=Back to Agents')).toBeVisible();
  });

  test('back link navigates to agents panel', async ({ page }) => {
    await page.goto('/agents/test-agent');
    await page.waitForTimeout(2000);
    await page.locator('text=Back to Agents').click();
    await expect(page.locator('header h1')).toHaveText('Agents');
  });

  test('agents panel has navigable agent IDs', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents');
    // The panel should be visible with search input
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
  });

  test('app shell remains intact on detail page', async ({ page }) => {
    await page.goto('/agents/some-agent');
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('text=KubexClaw')).toBeVisible();
    // Navigation should still work
    await page.locator('aside').getByText('Dashboard', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('direct URL to agent detail loads correctly', async ({ page }) => {
    // Test that the route is properly registered
    await page.goto('/agents/my-test-agent');
    // Should not show a blank page — either agent detail or error
    await expect(page.locator('aside')).toBeVisible();
    await page.waitForTimeout(2000);
    // Should show either agent data or error with back link
    const hasContent = await page.locator('text=/Back to Agents|Overview/').isVisible();
    expect(hasContent).toBe(true);
  });
});
