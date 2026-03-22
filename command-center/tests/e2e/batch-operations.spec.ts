import { test, expect } from '@playwright/test';

const REGISTRY = 'http://localhost:8070';
const MANAGER = 'http://localhost:8090';

// ── Mock data ────────────────────────────────────────────────────────────────

const mockAgents = [
  {
    agent_id: 'agent-alpha-001',
    capabilities: ['summarise', 'classify'],
    status: 'running',
    boundary: 'internal',
    registered_at: '2026-03-22T08:00:00Z',
    metadata: {},
  },
  {
    agent_id: 'agent-beta-007',
    capabilities: ['translate'],
    status: 'idle',
    boundary: 'restricted',
    registered_at: '2026-03-22T09:15:00Z',
    metadata: {},
  },
  {
    agent_id: 'agent-gamma-099',
    capabilities: ['code_review'],
    status: 'busy',
    boundary: 'internal',
    registered_at: '2026-03-21T14:30:00Z',
    metadata: {},
  },
];

const mockKubexes = [
  {
    kubex_id: 'kubex-550e8400-e29b-41d4',
    agent_id: 'agent-alpha-001',
    status: 'running',
    image: 'kubex-base:latest',
    container_name: 'kubex_alpha_001',
    created_at: '2026-03-22T08:00:00Z',
    started_at: '2026-03-22T08:00:05Z',
    config: {},
  },
  {
    kubex_id: 'kubex-6ba7b810-9dad-11d1',
    agent_id: 'agent-beta-007',
    status: 'stopped',
    image: 'kubex-base:latest',
    container_name: 'kubex_beta_007',
    created_at: '2026-03-22T09:15:00Z',
    started_at: null,
    config: {},
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function mockAgentsRoute(
  page: import('@playwright/test').Page,
  data = mockAgents,
) {
  await page.route(`${REGISTRY}/agents`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    }),
  );
}

async function mockKubexesRoute(
  page: import('@playwright/test').Page,
  data = mockKubexes,
) {
  await page.route(`${MANAGER}/kubexes`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    }),
  );
}

// ── AgentsPanel: Selection tests ─────────────────────────────────────────────

test.describe('Batch operations — Agents Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAgentsRoute(page);
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents');
    // Wait for agent rows to load
    await expect(page.getByTestId('agent-checkbox-agent-alpha-001')).toBeVisible({ timeout: 10000 });
  });

  test('each agent row has a checkbox', async ({ page }) => {
    await expect(page.getByTestId('agent-checkbox-agent-alpha-001')).toBeVisible();
    await expect(page.getByTestId('agent-checkbox-agent-beta-007')).toBeVisible();
    await expect(page.getByTestId('agent-checkbox-agent-gamma-099')).toBeVisible();
  });

  test('select-all checkbox is present in table header', async ({ page }) => {
    await expect(page.getByTestId('agents-select-all')).toBeVisible();
  });

  test('selection bar is hidden when nothing is selected', async ({ page }) => {
    await expect(page.getByTestId('agents-selection-bar')).not.toBeVisible();
  });

  test('selecting one agent shows selection bar with count 1', async ({ page }) => {
    await page.getByTestId('agent-checkbox-agent-alpha-001').check();
    await expect(page.getByTestId('agents-selection-bar')).toBeVisible();
    await expect(page.getByTestId('agents-selection-bar-count')).toContainText('1');
  });

  test('selection bar shows correct count for multiple selections', async ({ page }) => {
    await page.getByTestId('agent-checkbox-agent-alpha-001').check();
    await page.getByTestId('agent-checkbox-agent-beta-007').check();
    await expect(page.getByTestId('agents-selection-bar-count')).toContainText('2');
  });

  test('select-all checkbox selects all agents', async ({ page }) => {
    await page.getByTestId('agents-select-all').check();
    // All individual checkboxes should be checked
    await expect(page.getByTestId('agent-checkbox-agent-alpha-001')).toBeChecked();
    await expect(page.getByTestId('agent-checkbox-agent-beta-007')).toBeChecked();
    await expect(page.getByTestId('agent-checkbox-agent-gamma-099')).toBeChecked();
    // Selection bar should show 3
    await expect(page.getByTestId('agents-selection-bar-count')).toContainText('3');
  });

  test('select-all when all selected deselects all', async ({ page }) => {
    // Select all first
    await page.getByTestId('agents-select-all').check();
    await expect(page.getByTestId('agents-selection-bar')).toBeVisible();
    // Uncheck all via select-all
    await page.getByTestId('agents-select-all').uncheck();
    await expect(page.getByTestId('agents-selection-bar')).not.toBeVisible();
  });

  test('clear button in selection bar deselects all', async ({ page }) => {
    await page.getByTestId('agent-checkbox-agent-alpha-001').check();
    await page.getByTestId('agent-checkbox-agent-beta-007').check();
    await expect(page.getByTestId('agents-selection-bar')).toBeVisible();
    await page.getByTestId('agents-selection-bar-clear').click();
    await expect(page.getByTestId('agents-selection-bar')).not.toBeVisible();
    await expect(page.getByTestId('agent-checkbox-agent-alpha-001')).not.toBeChecked();
  });

  test('bulk deregister button appears in selection bar when agents selected', async ({ page }) => {
    await page.getByTestId('agent-checkbox-agent-alpha-001').check();
    await expect(page.getByTestId('agents-bulk-deregister')).toBeVisible();
  });

  test('bulk deregister button opens confirm dialog', async ({ page }) => {
    await page.getByTestId('agent-checkbox-agent-alpha-001').check();
    await page.getByTestId('agents-bulk-deregister').click();
    // Confirm dialog should appear
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Deregister Selected Agents');
  });

  test('confirm dialog shows correct count in message', async ({ page }) => {
    await page.getByTestId('agent-checkbox-agent-alpha-001').check();
    await page.getByTestId('agent-checkbox-agent-beta-007').check();
    await page.getByTestId('agents-bulk-deregister').click();
    await expect(page.getByRole('dialog')).toContainText('2 agents');
  });

  test('cancelling bulk deregister dialog keeps selection', async ({ page }) => {
    await page.getByTestId('agent-checkbox-agent-alpha-001').check();
    await page.getByTestId('agents-bulk-deregister').click();
    await page.getByRole('dialog').getByText('Cancel').click();
    // Dialog closed, selection bar still visible
    await expect(page.getByTestId('agents-selection-bar')).toBeVisible();
  });

  test('selecting an agent highlights the row', async ({ page }) => {
    const checkbox = page.getByTestId('agent-checkbox-agent-alpha-001');
    await checkbox.check();
    // The row should have a visual highlight class (emerald tint)
    // We verify the checkbox is checked as a proxy for the selection state
    await expect(checkbox).toBeChecked();
  });
});

// ── ContainersPanel: Selection tests ─────────────────────────────────────────

test.describe('Batch operations — Containers Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockKubexesRoute(page);
    await page.goto('/containers');
    await expect(page.locator('header h1')).toHaveText('Containers');
    // Wait for kubex rows to load
    await expect(page.getByTestId('kubex-checkbox-kubex-550e8400-e29b-41d4')).toBeVisible({ timeout: 10000 });
  });

  test('each kubex row has a checkbox', async ({ page }) => {
    await expect(page.getByTestId('kubex-checkbox-kubex-550e8400-e29b-41d4')).toBeVisible();
    await expect(page.getByTestId('kubex-checkbox-kubex-6ba7b810-9dad-11d1')).toBeVisible();
  });

  test('select-all checkbox is present in table header', async ({ page }) => {
    await expect(page.getByTestId('containers-select-all')).toBeVisible();
  });

  test('selection bar is hidden when nothing is selected', async ({ page }) => {
    await expect(page.getByTestId('containers-selection-bar')).not.toBeVisible();
  });

  test('selecting one kubex shows selection bar with count 1', async ({ page }) => {
    await page.getByTestId('kubex-checkbox-kubex-550e8400-e29b-41d4').check();
    await expect(page.getByTestId('containers-selection-bar')).toBeVisible();
    await expect(page.getByTestId('containers-selection-bar-count')).toContainText('1');
  });

  test('select-all checkbox selects all kubexes', async ({ page }) => {
    await page.getByTestId('containers-select-all').check();
    await expect(page.getByTestId('kubex-checkbox-kubex-550e8400-e29b-41d4')).toBeChecked();
    await expect(page.getByTestId('kubex-checkbox-kubex-6ba7b810-9dad-11d1')).toBeChecked();
    await expect(page.getByTestId('containers-selection-bar-count')).toContainText('2');
  });

  test('clear button deselects all kubexes', async ({ page }) => {
    await page.getByTestId('containers-select-all').check();
    await expect(page.getByTestId('containers-selection-bar')).toBeVisible();
    await page.getByTestId('containers-selection-bar-clear').click();
    await expect(page.getByTestId('containers-selection-bar')).not.toBeVisible();
  });

  test('kill selected button appears when running kubex is selected', async ({ page }) => {
    // The first kubex is running
    await page.getByTestId('kubex-checkbox-kubex-550e8400-e29b-41d4').check();
    await expect(page.getByTestId('containers-bulk-kill')).toBeVisible();
  });

  test('start selected button appears when stopped kubex is selected', async ({ page }) => {
    // The second kubex is stopped
    await page.getByTestId('kubex-checkbox-kubex-6ba7b810-9dad-11d1').check();
    await expect(page.getByTestId('containers-bulk-start')).toBeVisible();
  });

  test('kill selected opens confirm dialog', async ({ page }) => {
    await page.getByTestId('kubex-checkbox-kubex-550e8400-e29b-41d4').check();
    await page.getByTestId('containers-bulk-kill').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Kill Selected Kubexes');
  });

  test('cancelling kill dialog keeps selection', async ({ page }) => {
    await page.getByTestId('kubex-checkbox-kubex-550e8400-e29b-41d4').check();
    await page.getByTestId('containers-bulk-kill').click();
    await page.getByRole('dialog').getByText('Cancel').click();
    await expect(page.getByTestId('containers-selection-bar')).toBeVisible();
  });

  test('selecting stopped kubex does not show kill button (no running selected)', async ({ page }) => {
    // Only the stopped kubex selected — kill button should not appear
    await page.getByTestId('kubex-checkbox-kubex-6ba7b810-9dad-11d1').check();
    await expect(page.getByTestId('containers-bulk-kill')).not.toBeVisible();
  });

  test('selection bar shows both kill and start when mixed selection', async ({ page }) => {
    // Select running + stopped
    await page.getByTestId('kubex-checkbox-kubex-550e8400-e29b-41d4').check();
    await page.getByTestId('kubex-checkbox-kubex-6ba7b810-9dad-11d1').check();
    await expect(page.getByTestId('containers-bulk-kill')).toBeVisible();
    await expect(page.getByTestId('containers-bulk-start')).toBeVisible();
  });
});
