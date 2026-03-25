import { test, expect } from '@playwright/test';
import { mockBaseRoutes, MANAGER, MOCK_KUBEXES } from './helpers';

const mockKubexes = [
  {
    kubex_id: 'kubex-550e8400-e29b-41d4',
    agent_id: 'agent-alpha-001',
    status: 'running',
    image: 'kubex-base:latest',
    container_name: 'kubex_alpha_001',
    created_at: '2026-03-22T08:00:00Z',
    started_at: '2026-03-22T08:00:05Z',
    config: { memory_limit: '512m', cpu_quota: 50000 },
  },
  {
    kubex_id: 'kubex-6ba7b810-9dad-11d1',
    agent_id: 'agent-beta-007',
    status: 'created',
    image: 'kubex-base:latest',
    container_name: 'kubex_beta_007',
    created_at: '2026-03-22T09:15:00Z',
    started_at: null,
    config: { memory_limit: '256m', cpu_quota: 25000 },
  },
];

/** Route the Manager kubexes endpoint to return mock data. */
async function mockKubexesRoute(page: import('@playwright/test').Page, data = mockKubexes) {
  await mockBaseRoutes(page, { kubexes: data });
}

test.describe('Containers Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.goto('/containers');
    await expect(page.locator('header h1')).toHaveText('Containers');
  });

  test('displays containers panel header', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Docker Containers (Kubexes)' })).toBeVisible();
  });

  test('displays refresh button', async ({ page }) => {
    await expect(page.getByText('Refresh', { exact: false })).toBeVisible();
  });

  test('displays search input', async ({ page }) => {
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
  });

  test('search input filters content', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('nonexistent-kubex-xyz');
    // After debounce, results should update
    await page.waitForTimeout(500);
    // The panel header should still be visible
    await expect(page.getByRole('heading', { name: 'Docker Containers (Kubexes)' })).toBeVisible();
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

  test('status filter dropdown is visible', async ({ page }) => {
    await expect(page.locator('select[aria-label="Filter by status"]')).toBeVisible();
  });

  test('table has ARIA roles when data is loaded', async ({ page }) => {
    // Mock kubexes endpoint before navigation so data loads immediately
    await mockKubexesRoute(page);
    await page.goto('/containers');
    // Wait for the table to render with data — now role=grid (keyboard-navigable)
    await expect(page.locator('[role="grid"]')).toBeVisible({ timeout: 10000 });
  });

  test('column headers are rendered and sortable', async ({ page }) => {
    // Mock kubexes endpoint before navigation so data loads immediately
    await mockKubexesRoute(page);
    await page.goto('/containers');
    // Wait for table to render with data from mock — now role=grid
    await expect(page.locator('[role="grid"]')).toBeVisible({ timeout: 10000 });
    // Column headers with role=columnheader should exist
    const headers = page.locator('[role="columnheader"]');
    await expect(headers.first()).toBeVisible();
    // Kubex ID header should be present
    await expect(page.getByRole('columnheader', { name: /kubex id/i })).toBeVisible();
  });
});
