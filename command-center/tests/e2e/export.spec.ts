import { test, expect } from '@playwright/test';
import { mockBaseRoutes } from './helpers';

// ── Shared mock data ─────────────────────────────────────────────────
// Local overrides with export-specific agent/kubex IDs so assertions
// match the exact text rendered in each test.

const mockAgents = [
  {
    agent_id: 'agent-export-test-01',
    capabilities: ['summarise', 'classify'],
    status: 'running',
    boundary: 'internal',
    registered_at: '2026-03-22T08:00:00Z',
  },
];

const mockKubexes = [
  {
    kubex_id: 'kubex-export-test-01',
    agent_id: 'agent-export-test-01',
    status: 'running',
    image: 'kubex-base:latest',
    container_name: 'kubex_export_01',
    created_at: '2026-03-22T08:00:00Z',
  },
];

/** Inject a traffic entry directly into localStorage with the correct key. */
async function injectTrafficEntry(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const entry = {
      id: 'export-test-entry-1',
      timestamp: new Date().toISOString(),
      agent_id: 'agent-export-test',
      action: 'dispatch_task',
      capability: 'summarise',
      status: 'allowed',
      task_id: 'task-export-1',
    };
    localStorage.setItem('kubex-traffic-log', JSON.stringify([entry]));
  });
}

// ── Traffic Log export tests ─────────────────────────────────────────

test.describe('Export — Traffic Log', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.goto('/traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');
  });

  test('export menu button is present on traffic page', async ({ page }) => {
    await expect(page.getByTestId('traffic-export-menu')).toBeVisible();
  });

  test('export menu button is disabled when no entries', async ({ page }) => {
    // Fresh page with no traffic entries
    await expect(page.getByTestId('traffic-export-menu')).toBeDisabled();
  });

  test('export menu button has aria-haspopup and aria-expanded attributes', async ({ page }) => {
    const btn = page.getByTestId('traffic-export-menu');
    await expect(btn).toHaveAttribute('aria-haspopup', 'true');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  test('export menu opens dropdown when entries are present', async ({ page }) => {
    await injectTrafficEntry(page);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Traffic');

    const btn = page.getByTestId('traffic-export-menu');
    await expect(btn).not.toBeDisabled();
    await btn.click();

    await expect(page.getByTestId('traffic-export-menu-dropdown')).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  test('dropdown has JSON and CSV options', async ({ page }) => {
    await injectTrafficEntry(page);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Traffic');

    await page.getByTestId('traffic-export-menu').click();
    await expect(page.getByTestId('traffic-export-menu-json')).toBeVisible();
    await expect(page.getByTestId('traffic-export-menu-csv')).toBeVisible();
  });

  test('dropdown container has role=menu and items have role=menuitem', async ({ page }) => {
    await injectTrafficEntry(page);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Traffic');

    await page.getByTestId('traffic-export-menu').click();

    const dropdown = page.getByTestId('traffic-export-menu-dropdown');
    await expect(dropdown).toHaveAttribute('role', 'menu');

    await expect(page.getByTestId('traffic-export-menu-json')).toHaveAttribute('role', 'menuitem');
    await expect(page.getByTestId('traffic-export-menu-csv')).toHaveAttribute('role', 'menuitem');
  });

  test('dropdown closes on Escape key', async ({ page }) => {
    await injectTrafficEntry(page);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Traffic');

    await page.getByTestId('traffic-export-menu').click();
    await expect(page.getByTestId('traffic-export-menu-dropdown')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('traffic-export-menu-dropdown')).not.toBeVisible();
    await expect(page.getByTestId('traffic-export-menu')).toHaveAttribute('aria-expanded', 'false');
  });

  test('dropdown closes on outside click', async ({ page }) => {
    await injectTrafficEntry(page);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Traffic');

    await page.getByTestId('traffic-export-menu').click();
    await expect(page.getByTestId('traffic-export-menu-dropdown')).toBeVisible();

    // Click the page heading — outside the export menu
    await page.getByRole('heading', { name: 'Traffic / Actions Log' }).click({ force: true });
    await expect(page.getByTestId('traffic-export-menu-dropdown')).not.toBeVisible();
  });

  test('JSON export triggers a file download with .json extension', async ({ page }) => {
    await injectTrafficEntry(page);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Traffic');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('traffic-export-menu').click();
    await page.getByTestId('traffic-export-menu-json').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^traffic-log-.*\.json$/);
  });

  test('CSV export triggers a file download with .csv extension', async ({ page }) => {
    await injectTrafficEntry(page);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Traffic');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('traffic-export-menu').click();
    await page.getByTestId('traffic-export-menu-csv').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^traffic-log-.*\.csv$/);
  });
});

// ── Agents Panel export tests ────────────────────────────────────────

test.describe('Export — Agents Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page, { agents: mockAgents, kubexes: mockKubexes });
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents');
  });

  test('export menu button is present on agents page', async ({ page }) => {
    await expect(page.getByTestId('agents-export-menu')).toBeVisible();
  });

  test('export menu button has aria-haspopup attribute', async ({ page }) => {
    await expect(page.getByTestId('agents-export-menu')).toHaveAttribute('aria-haspopup', 'true');
  });

  test('export menu is enabled when agents are loaded', async ({ page }) => {
    // Wait for mock data to load — use .first() to avoid strict-mode violation because
    // the CapabilityMatrix also renders the agent_id, creating 2 matches.
    await expect(page.getByRole('heading', { name: 'Registered Agents' })).toBeVisible();
    await expect(page.getByText('agent-export-test-01').first()).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId('agents-export-menu')).not.toBeDisabled();
  });

  test('agents export dropdown has JSON option only (no CSV)', async ({ page }) => {
    await expect(page.getByText('agent-export-test-01').first()).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('agents-export-menu').click();
    await expect(page.getByTestId('agents-export-menu-json')).toBeVisible();
    // CSV is not offered for agents
    await expect(page.getByTestId('agents-export-menu-csv')).not.toBeVisible();
  });

  test('agents JSON export triggers a download with .json extension', async ({ page }) => {
    await expect(page.getByText('agent-export-test-01').first()).toBeVisible({ timeout: 10_000 });

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('agents-export-menu').click();
    await page.getByTestId('agents-export-menu-json').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^agents-.*\.json$/);
  });

  test('agents export dropdown closes on Escape', async ({ page }) => {
    await expect(page.getByText('agent-export-test-01').first()).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('agents-export-menu').click();
    await expect(page.getByTestId('agents-export-menu-dropdown')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('agents-export-menu-dropdown')).not.toBeVisible();
  });
});

// ── Containers Panel export tests ────────────────────────────────────

test.describe('Export — Containers Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page, { agents: mockAgents, kubexes: mockKubexes });
    await page.goto('/containers');
    await expect(page.locator('header h1')).toHaveText('Containers');
  });

  test('export menu button is present on containers page', async ({ page }) => {
    await expect(page.getByTestId('containers-export-menu')).toBeVisible();
  });

  test('export menu button has aria-haspopup attribute', async ({ page }) => {
    await expect(page.getByTestId('containers-export-menu')).toHaveAttribute('aria-haspopup', 'true');
  });

  test('export menu is enabled when kubexes are loaded', async ({ page }) => {
    await expect(page.getByText('kubex-export-test-01')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('containers-export-menu')).not.toBeDisabled();
  });

  test('containers export has JSON option only', async ({ page }) => {
    await expect(page.getByText('kubex-export-test-01')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('containers-export-menu').click();
    await expect(page.getByTestId('containers-export-menu-json')).toBeVisible();
    await expect(page.getByTestId('containers-export-menu-csv')).not.toBeVisible();
  });

  test('containers JSON export triggers a download with .json extension', async ({ page }) => {
    await expect(page.getByText('kubex-export-test-01')).toBeVisible({ timeout: 10_000 });

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('containers-export-menu').click();
    await page.getByTestId('containers-export-menu-json').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^kubexes-.*\.json$/);
  });

  test('containers export dropdown closes on Escape', async ({ page }) => {
    await expect(page.getByText('kubex-export-test-01')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('containers-export-menu').click();
    await expect(page.getByTestId('containers-export-menu-dropdown')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('containers-export-menu-dropdown')).not.toBeVisible();
  });
});

// ── Orchestrator Chat export tests ───────────────────────────────────

test.describe('Export — Orchestrator Chat', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.goto('/chat');
    await expect(page.locator('header h1')).toHaveText('Orchestrator');
  });

  test('chat export menu button is present', async ({ page }) => {
    await expect(page.getByTestId('chat-export-menu')).toBeVisible();
  });

  test('chat export menu has aria-haspopup attribute', async ({ page }) => {
    await expect(page.getByTestId('chat-export-menu')).toHaveAttribute('aria-haspopup', 'true');
  });

  test('chat export menu is enabled (welcome message always present)', async ({ page }) => {
    // OrchestratorChat always starts with a welcome message
    await expect(page.getByTestId('chat-export-menu')).not.toBeDisabled();
  });

  test('chat export dropdown opens on click', async ({ page }) => {
    await page.getByTestId('chat-export-menu').click();
    await expect(page.getByTestId('chat-export-menu-dropdown')).toBeVisible();
    await expect(page.getByTestId('chat-export-menu')).toHaveAttribute('aria-expanded', 'true');
  });

  test('chat export has JSON option only (no CSV)', async ({ page }) => {
    await page.getByTestId('chat-export-menu').click();
    await expect(page.getByTestId('chat-export-menu-json')).toBeVisible();
    await expect(page.getByTestId('chat-export-menu-csv')).not.toBeVisible();
  });

  test('chat JSON export triggers a download with .json extension', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('chat-export-menu').click();
    await page.getByTestId('chat-export-menu-json').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^chat-history-.*\.json$/);
  });

  test('chat export dropdown closes on Escape', async ({ page }) => {
    await page.getByTestId('chat-export-menu').click();
    await expect(page.getByTestId('chat-export-menu-dropdown')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chat-export-menu-dropdown')).not.toBeVisible();
  });

  test('chat export dropdown closes on outside click', async ({ page }) => {
    await page.getByTestId('chat-export-menu').click();
    await expect(page.getByTestId('chat-export-menu-dropdown')).toBeVisible();

    await page.locator('header h1').click({ force: true });
    await expect(page.getByTestId('chat-export-menu-dropdown')).not.toBeVisible();
  });
});
