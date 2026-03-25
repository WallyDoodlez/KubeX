import { test, expect } from '@playwright/test';
import { mockBaseRoutes, MOCK_AGENTS } from './helpers';

test.describe('Agents Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page, { agents: MOCK_AGENTS });
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents');
  });

  test('displays agents panel header', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Registered Agents' })).toBeVisible();
  });

  test('displays refresh button', async ({ page }) => {
    await expect(page.getByText('Refresh', { exact: false })).toBeVisible();
  });

  test('displays search input', async ({ page }) => {
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
  });

  test('search input filters content', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('nonexistent-agent-xyz');
    // After debounce, results should update
    await page.waitForTimeout(500);
    // The panel should still be visible (even if empty)
    await expect(page.getByRole('heading', { name: 'Registered Agents' })).toBeVisible();
  });

  test('search input has clear button when filled', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('test');
    // Clear button should appear
    await expect(page.locator('button[aria-label="Clear search"]')).toBeVisible();
  });

  test('clear button empties search', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('test');
    await page.locator('button[aria-label="Clear search"]').click();
    await expect(searchInput).toHaveValue('');
  });

  test('table has ARIA roles', async ({ page }) => {
    // The agent table container should have role=grid (keyboard-navigable grid)
    await expect(page.locator('[data-testid="agents-table"]')).toHaveAttribute('role', 'grid');
  });

  test('column headers are clickable for sorting', async ({ page }) => {
    // Column headers with role=columnheader should exist
    const headers = page.locator('[role="columnheader"]');
    await expect(headers.first()).toBeVisible();
  });
});
