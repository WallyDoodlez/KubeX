import { test, expect } from '@playwright/test';

test.describe('Traffic Log', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');
  });

  test('displays traffic log header', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Traffic / Actions Log' })).toBeVisible();
  });

  test('displays status legend', async ({ page }) => {
    // Legend dots are spans with exact text
    await expect(page.getByText('allowed', { exact: true })).toBeVisible();
    await expect(page.getByText('denied', { exact: true })).toBeVisible();
    await expect(page.getByText('escalated', { exact: true })).toBeVisible();
    await expect(page.getByText('pending', { exact: true })).toBeVisible();
  });

  test('displays filter bar with status select', async ({ page }) => {
    // Status filter select should be visible
    const statusSelect = page.locator('select').first();
    await expect(statusSelect).toBeVisible();
    // Should have "All statuses" option
    await expect(statusSelect.locator('option', { hasText: 'All statuses' })).toBeAttached();
  });

  test('displays search input in filter bar', async ({ page }) => {
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
  });

  test('shows empty state when no traffic entries', async ({ page }) => {
    // On a fresh app with no dispatched tasks, should show empty state
    await expect(page.getByText('No traffic yet')).toBeVisible();
  });

  test('filter bar shows entry count', async ({ page }) => {
    // Should show a count (0 when empty)
    // The count is in a span with font-mono-data
    const countEl = page.locator('.font-mono-data').filter({ hasText: /^\d+/ });
    await expect(countEl.first()).toBeVisible();
  });

  test('page maintains layout structure', async ({ page }) => {
    // Should have the header, legend, and filter area regardless of entries
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
    // Navigate away and back to verify state
    await page.locator('aside').getByText('Dashboard', { exact: true }).click();
    await page.locator('aside').getByText('Traffic', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Traffic / Actions Log' })).toBeVisible();
  });
});
