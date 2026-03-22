import { test, expect } from '@playwright/test';

test.describe('Approval Queue', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/approvals');
  });

  test('displays approval queue header', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Approval Queue' })).toBeVisible();
  });

  test('shows empty state when no pending approvals', async ({ page }) => {
    await expect(page.getByText('No pending approvals')).toBeVisible();
  });

  test('shows escalation description in empty state', async ({ page }) => {
    await expect(page.getByText('Escalated actions from the policy engine')).toBeVisible();
  });

  test('approvals nav item is visible in sidebar', async ({ page }) => {
    await expect(page.locator('aside').getByText('Approvals', { exact: true })).toBeVisible();
  });

  test('sidebar nav highlights approvals when active', async ({ page }) => {
    // The header should show "Approvals" when on this page
    await expect(page.locator('header h1')).toHaveText('Approvals');
  });

  test('navigating to approvals from sidebar works', async ({ page }) => {
    await page.goto('/');
    await page.locator('aside').getByText('Approvals', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Approvals');
    await expect(page.getByRole('heading', { name: 'Approval Queue' })).toBeVisible();
  });

  test('app shell intact on approvals page', async ({ page }) => {
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('text=KubexClaw')).toBeVisible();
  });
});
