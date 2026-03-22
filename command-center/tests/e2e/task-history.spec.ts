import { test, expect } from '@playwright/test';

test.describe('Task History Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tasks');
  });

  test('navigates to /tasks and shows correct header', async ({ page }) => {
    await expect(page.locator('header h1')).toHaveText('Tasks');
  });

  test('task history nav item is visible in sidebar', async ({ page }) => {
    await expect(page.locator('aside').getByText('Tasks', { exact: true })).toBeVisible();
  });

  test('sidebar highlights Tasks nav item when active', async ({ page }) => {
    const navButton = page.locator('aside').getByRole('button', { name: /Tasks/ });
    await expect(navButton).toHaveAttribute('aria-current', 'page');
  });

  test('shows Task History heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Task History' })).toBeVisible();
  });

  test('shows empty state when no dispatch_task entries exist', async ({ page }) => {
    // Fresh app with no dispatched tasks shows the empty state
    await expect(page.getByText('No dispatched tasks yet')).toBeVisible();
  });

  test('shows description in empty state', async ({ page }) => {
    await expect(page.getByText('Tasks appear here after you dispatch them via the Orchestrator')).toBeVisible();
  });

  test('navigating to tasks from sidebar works', async ({ page }) => {
    await page.goto('/');
    await page.locator('aside').getByText('Tasks', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Tasks');
    await expect(page.getByRole('heading', { name: 'Task History' })).toBeVisible();
  });

  test('app shell intact on tasks page', async ({ page }) => {
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('text=KubexClaw')).toBeVisible();
  });

  test('direct URL navigation to /tasks works', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.locator('header h1')).toHaveText('Tasks');
    await expect(page.getByRole('heading', { name: 'Task History' })).toBeVisible();
  });

  test('status filter buttons are rendered', async ({ page }) => {
    // Status filter group with All/Allowed/Denied/Escalated/Pending buttons
    const filterGroup = page.getByRole('group', { name: 'Filter by status' });
    await expect(filterGroup).toBeVisible();
    await expect(filterGroup.getByRole('button', { name: 'All', exact: true })).toBeVisible();
    await expect(filterGroup.getByRole('button', { name: 'Allowed', exact: true })).toBeVisible();
    await expect(filterGroup.getByRole('button', { name: 'Denied', exact: true })).toBeVisible();
    await expect(filterGroup.getByRole('button', { name: 'Escalated', exact: true })).toBeVisible();
    await expect(filterGroup.getByRole('button', { name: 'Pending', exact: true })).toBeVisible();
  });

  test('search input is rendered', async ({ page }) => {
    await expect(page.locator('input[placeholder*="Search task ID"]')).toBeVisible();
  });

  test('export menu is present', async ({ page }) => {
    await expect(page.getByTestId('export-menu')).toBeVisible();
  });

  test('All status filter button is active by default', async ({ page }) => {
    const allBtn = page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: 'All', exact: true });
    await expect(allBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('task history page found in command palette', async ({ page }) => {
    await page.goto('/');
    // Open command palette
    await page.getByTestId('command-palette-trigger').click();
    // Type to search for tasks
    await page.keyboard.type('task history');
    await expect(page.getByText('Go to Task History')).toBeVisible();
  });
});
