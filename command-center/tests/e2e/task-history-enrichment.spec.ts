/**
 * Iteration 77 — Task history enrichment
 *
 * New features tested:
 * - Capability filter dropdown (built from distinct task capabilities)
 * - Time-window filter buttons (All time / Last 1h / 24h / 7d)
 * - "Clear filters" button appears when any filter is active
 * - "Clear filters" resets all filters to defaults
 * - All new filters persist in URL query params
 * - Filtered result count shown in header subtitle
 */

import { test, expect, type Page } from '@playwright/test';

// ── Mock data ─────────────────────────────────────────────────────────

const NOW = Date.now();

const MOCK_TASKS = [
  {
    id: 'entry-1',
    task_id: 'task-aaa-001',
    agent_id: 'agent-alpha-001',
    action: 'dispatch_task',
    capability: 'summarise',
    status: 'allowed',
    policy_rule: null,
    timestamp: new Date(NOW - 10 * 60 * 1000).toISOString(), // 10 min ago
  },
  {
    id: 'entry-2',
    task_id: 'task-bbb-002',
    agent_id: 'agent-beta-007',
    action: 'dispatch_task',
    capability: 'classify',
    status: 'denied',
    policy_rule: 'rate-limit',
    timestamp: new Date(NOW - 2 * 3600 * 1000).toISOString(), // 2 h ago
  },
  {
    id: 'entry-3',
    task_id: 'task-ccc-003',
    agent_id: 'agent-alpha-001',
    action: 'dispatch_task',
    capability: 'extract',
    status: 'escalated',
    policy_rule: null,
    timestamp: new Date(NOW - 25 * 3600 * 1000).toISOString(), // 25 h ago (outside 24h window)
  },
  {
    id: 'entry-4',
    task_id: 'task-ddd-004',
    agent_id: 'agent-beta-007',
    action: 'dispatch_task',
    capability: 'summarise', // same cap as entry-1
    status: 'allowed',
    policy_rule: null,
    timestamp: new Date(NOW - 30 * 60 * 1000).toISOString(), // 30 min ago
  },
];

/** Inject tasks into localStorage so the app loads them on boot. */
async function seedTasks(page: Page) {
  // Convert ISO strings back to serialised format the app expects
  const entries = MOCK_TASKS.map((t) => ({
    ...t,
    timestamp: t.timestamp, // stored as ISO, rehydrated to Date on load
  }));
  await page.addInitScript((items) => {
    localStorage.setItem('kubex-traffic-log', JSON.stringify(items));
  }, entries);
}

async function mockApis(page: Page) {
  await page.route('**/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'healthy' }) }),
  );
  await page.route('**/agents', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );
  await page.route('**/kubexes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );
  await page.route('**/escalations', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────

test.describe('Task History Enrichment (Iteration 77)', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page);
    await seedTasks(page);
  });

  // ── Capability filter ────────────────────────────────────────────

  test('capability filter dropdown is rendered when tasks have capabilities', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('capability-filter')).toBeVisible({ timeout: 8000 });
  });

  test('capability filter lists all unique capabilities', async ({ page }) => {
    await page.goto('/tasks');
    const select = page.getByTestId('capability-filter');
    await expect(select).toBeVisible({ timeout: 8000 });
    // Should have "All capabilities" plus summarise, classify, extract
    await expect(select.locator('option[value="all"]')).toHaveCount(1);
    await expect(select.locator('option[value="summarise"]')).toHaveCount(1);
    await expect(select.locator('option[value="classify"]')).toHaveCount(1);
    await expect(select.locator('option[value="extract"]')).toHaveCount(1);
  });

  test('capability filter defaults to "All capabilities"', async ({ page }) => {
    await page.goto('/tasks');
    const select = page.getByTestId('capability-filter');
    await expect(select).toBeVisible({ timeout: 8000 });
    await expect(select).toHaveValue('all');
  });

  test('selecting a capability filters the table', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('task-history-table')).toBeVisible({ timeout: 8000 });

    // Select "classify" — only entry-2 has classify
    await page.getByTestId('capability-filter').selectOption('classify');

    // Should show filtered count
    await expect(page.getByText(/1 of \d+ tasks/)).toBeVisible();
  });

  test('capability filter shows "summarise" entries (2 tasks)', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('task-history-table')).toBeVisible({ timeout: 8000 });

    await page.getByTestId('capability-filter').selectOption('summarise');

    // 2 entries have summarise — but time window filter may reduce it
    // "All time" is default so both should show
    await expect(page.getByText(/2 of \d+ tasks/)).toBeVisible();
  });

  // ── Time-window filter ───────────────────────────────────────────

  test('time-window filter group is rendered', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('time-window-filter')).toBeVisible({ timeout: 8000 });
  });

  test('time-window filter has all four options', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('time-filter-all')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('time-filter-1h')).toBeVisible();
    await expect(page.getByTestId('time-filter-24h')).toBeVisible();
    await expect(page.getByTestId('time-filter-7d')).toBeVisible();
  });

  test('"All time" is active by default', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('time-filter-all')).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
    await expect(page.getByTestId('time-filter-1h')).toHaveAttribute('aria-pressed', 'false');
  });

  test('Last 1h filter limits to tasks within the past hour', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('task-history-table')).toBeVisible({ timeout: 8000 });

    // Click "Last 1 h" — only entry-1 (10 min ago) and entry-4 (30 min ago) qualify
    await page.getByTestId('time-filter-1h').click();
    await expect(page.getByTestId('time-filter-1h')).toHaveAttribute('aria-pressed', 'true');

    // 2 tasks within 1h → "2 of 4 tasks"
    await expect(page.getByText(/2 of \d+ tasks/)).toBeVisible();
  });

  test('Last 24h filter excludes tasks older than 24 hours', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('task-history-table')).toBeVisible({ timeout: 8000 });

    // Click "Last 24 h" — entry-3 (25h ago) should be excluded
    await page.getByTestId('time-filter-24h').click();
    await expect(page.getByTestId('time-filter-24h')).toHaveAttribute('aria-pressed', 'true');

    // 3 tasks within 24h (entries 1, 2, 4) → "3 of 4 tasks"
    await expect(page.getByText(/3 of \d+ tasks/)).toBeVisible();
  });

  // ── Clear filters ────────────────────────────────────────────────

  test('"Clear filters" button is hidden when no filters active', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('task-history-table')).toBeVisible({ timeout: 8000 });

    // No filters applied yet
    await expect(page.getByTestId('clear-filters-btn')).not.toBeVisible();
  });

  test('"Clear filters" button appears after applying status filter', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('task-history-table')).toBeVisible({ timeout: 8000 });

    await page.getByTestId('status-filter-denied').click();
    await expect(page.getByTestId('clear-filters-btn')).toBeVisible();
  });

  test('"Clear filters" button appears after selecting capability', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('task-history-table')).toBeVisible({ timeout: 8000 });

    await page.getByTestId('capability-filter').selectOption('extract');
    await expect(page.getByTestId('clear-filters-btn')).toBeVisible();
  });

  test('"Clear filters" button appears after selecting time window', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('task-history-table')).toBeVisible({ timeout: 8000 });

    await page.getByTestId('time-filter-1h').click();
    await expect(page.getByTestId('clear-filters-btn')).toBeVisible();
  });

  test('"Clear filters" resets all filters to defaults', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('task-history-table')).toBeVisible({ timeout: 8000 });

    // Apply multiple filters
    await page.getByTestId('status-filter-allowed').click();
    await page.getByTestId('time-filter-1h').click();
    await page.getByTestId('capability-filter').selectOption('summarise');

    // Verify filters are active
    await expect(page.getByTestId('clear-filters-btn')).toBeVisible();

    // Clear
    await page.getByTestId('clear-filters-btn').click();

    // All filters should be reset
    await expect(page.getByTestId('status-filter-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('time-filter-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('capability-filter')).toHaveValue('all');

    // Clear filters button should disappear
    await expect(page.getByTestId('clear-filters-btn')).not.toBeVisible();
  });

  // ── URL persistence ──────────────────────────────────────────────

  test('capability filter persists in URL', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('task-history-table')).toBeVisible({ timeout: 8000 });

    await page.getByTestId('capability-filter').selectOption('classify');

    const url = new URL(page.url());
    expect(url.searchParams.get('capability')).toBe('classify');
  });

  test('time-window filter persists in URL', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('task-history-table')).toBeVisible({ timeout: 8000 });

    await page.getByTestId('time-filter-24h').click();

    const url = new URL(page.url());
    expect(url.searchParams.get('window')).toBe('24h');
  });

  test('filters are restored from URL on direct navigation', async ({ page }) => {
    await page.goto('/tasks?capability=classify&window=24h&status=denied');

    // After load, filters should match URL params
    await expect(page.getByTestId('capability-filter')).toHaveValue('classify', { timeout: 8000 });
    await expect(page.getByTestId('time-filter-24h')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('status-filter-denied')).toHaveAttribute('aria-pressed', 'true');
  });

  // ── Combined filtering ───────────────────────────────────────────

  test('combining capability + time window filters stacks correctly', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('task-history-table')).toBeVisible({ timeout: 8000 });

    // "summarise" within "Last 1h" → only entry-1 (10 min) and entry-4 (30 min)
    await page.getByTestId('capability-filter').selectOption('summarise');
    await page.getByTestId('time-filter-1h').click();

    // Both summarise tasks are within 1h → "2 of 4 tasks"
    await expect(page.getByText(/2 of \d+ tasks/)).toBeVisible();
  });

  test('header shows filtered count when any filter is active', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('task-history-table')).toBeVisible({ timeout: 8000 });

    await page.getByTestId('time-filter-1h').click();

    // "N of M tasks" subtitle visible
    await expect(page.getByText(/of \d+ tasks/)).toBeVisible();
  });
});
