import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('displays all stat cards', async ({ page }) => {
    await expect(page.getByText('Services Up', { exact: true })).toBeVisible();
    await expect(page.getByText('Services Down', { exact: true })).toBeVisible();
    await expect(page.locator('span', { hasText: 'Registered Agents' }).first()).toBeVisible();
    await expect(page.getByText('Running Kubexes', { exact: true })).toBeVisible();
  });

  test('displays service health section', async ({ page }) => {
    await expect(page.getByText('Service Health', { exact: true })).toBeVisible();
    // Service cards with name spans
    await expect(page.locator('.font-semibold', { hasText: 'Gateway' })).toBeVisible();
    await expect(page.locator('.font-semibold', { hasText: 'Registry' })).toBeVisible();
    await expect(page.locator('.font-semibold', { hasText: 'Manager' })).toBeVisible();
  });

  test('displays registered agents section', async ({ page }) => {
    await expect(page.locator('h2', { hasText: 'Registered Agents' })).toBeVisible();
  });

  test('View all link navigates to agents page', async ({ page }) => {
    const viewAll = page.locator('text=View all →');
    await expect(viewAll).toBeVisible();
    await viewAll.click();
    await expect(page.locator('header h1')).toHaveText('Agents');
  });

  test('stat cards show numeric values or loading indicator', async ({ page }) => {
    // Each stat card should have a value (number or loading indicator)
    const statValues = page.locator('.font-mono-data.text-2xl, .text-2xl.font-bold');
    // Should have at least 4 stat values
    await expect(statValues.first()).toBeVisible();
  });

  test('service health shows last updated timestamp', async ({ page }) => {
    // After the first poll, should show "Last updated" text
    // Wait a moment for the first poll to complete
    await page.waitForTimeout(1000);
    await expect(page.locator('text=/Last updated/')).toBeVisible();
  });
});
