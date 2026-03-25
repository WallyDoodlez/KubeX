/**
 * Iteration 84 — Agent Task Metrics tab
 *
 * Tests:
 * - "Task Metrics" tab is visible on the agent detail page
 * - Empty state shown when no traffic data for this agent
 * - Hero stat card shows total/allowed/denied/escalated counts
 * - Success rate percentage shown in allowed badge
 * - Capability breakdown bars rendered
 * - Recent failures section shown for denied/escalated entries
 * - Entries from other agents do NOT appear in this agent's metrics
 */

import { test, expect, type Page } from '@playwright/test';
import { mockBaseRoutes } from './helpers';

// ── Mock data ─────────────────────────────────────────────────────────

const AGENT_ID = 'agent-alpha-001';
const OTHER_AGENT_ID = 'agent-beta-007';

const NOW = Date.now();

const MOCK_TRAFFIC = [
  {
    id: 'e1',
    agent_id: AGENT_ID,
    action: 'dispatch_task',
    capability: 'summarise',
    status: 'allowed',
    policy_rule: null,
    task_id: 'task-001',
    timestamp: new Date(NOW - 5 * 60 * 1000).toISOString(),
  },
  {
    id: 'e2',
    agent_id: AGENT_ID,
    action: 'dispatch_task',
    capability: 'summarise',
    status: 'allowed',
    policy_rule: null,
    task_id: 'task-002',
    timestamp: new Date(NOW - 10 * 60 * 1000).toISOString(),
  },
  {
    id: 'e3',
    agent_id: AGENT_ID,
    action: 'dispatch_task',
    capability: 'classify',
    status: 'denied',
    policy_rule: 'rate-limit',
    task_id: 'task-003',
    timestamp: new Date(NOW - 15 * 60 * 1000).toISOString(),
  },
  {
    id: 'e4',
    agent_id: AGENT_ID,
    action: 'dispatch_task',
    capability: 'extract',
    status: 'escalated',
    policy_rule: 'high-risk-action',
    task_id: 'task-004',
    timestamp: new Date(NOW - 20 * 60 * 1000).toISOString(),
  },
  {
    id: 'e5',
    // Different agent — must not appear in alpha's metrics
    agent_id: OTHER_AGENT_ID,
    action: 'dispatch_task',
    capability: 'translate',
    status: 'allowed',
    policy_rule: null,
    task_id: 'task-005',
    timestamp: new Date(NOW - 25 * 60 * 1000).toISOString(),
  },
];

const MOCK_AGENTS = [
  {
    agent_id: AGENT_ID,
    capabilities: ['summarise', 'classify', 'extract'],
    status: 'running',
    boundary: 'internal',
    registered_at: '2026-03-22T08:00:00Z',
    metadata: {},
  },
  {
    agent_id: OTHER_AGENT_ID,
    capabilities: ['translate'],
    status: 'idle',
    boundary: 'internal',
    registered_at: '2026-03-22T09:00:00Z',
    metadata: {},
  },
];

/** Seed traffic log into localStorage before page load. */
async function seedTraffic(page: Page) {
  await page.addInitScript((items) => {
    localStorage.setItem('kubex-traffic-log', JSON.stringify(items));
  }, MOCK_TRAFFIC);
}

/** Navigate to the agent detail page and wait for tabs to appear. */
async function gotoAgentDetail(page: Page, agentId: string = AGENT_ID) {
  await page.goto(`/agents/${agentId}`);
  await expect(page.getByRole('tab', { name: 'Task Metrics' })).toBeVisible({ timeout: 10000 });
}

// ── Tests ─────────────────────────────────────────────────────────────

test.describe('Agent Task Metrics Tab (Iteration 84)', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page, { agents: MOCK_AGENTS });
  });

  // ── Tab visibility ────────────────────────────────────────────────

  test('Task Metrics tab is visible on agent detail page', async ({ page }) => {
    await seedTraffic(page);
    await gotoAgentDetail(page);
    await expect(page.getByRole('tab', { name: 'Task Metrics' })).toBeVisible();
  });

  test('clicking Task Metrics tab shows metrics panel', async ({ page }) => {
    await seedTraffic(page);
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: 'Task Metrics' }).click();
    await expect(page.getByTestId('agent-task-metrics')).toBeVisible({ timeout: 8000 });
  });

  // ── Empty state ───────────────────────────────────────────────────

  test('shows empty state when no traffic data for this agent', async ({ page }) => {
    // No traffic seeded
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: 'Task Metrics' }).click();
    await expect(page.getByTestId('task-metrics-empty')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('No task history recorded for this agent.')).toBeVisible();
  });

  // ── Hero stat card ────────────────────────────────────────────────

  test('hero stat card shows correct total count', async ({ page }) => {
    await seedTraffic(page);
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: 'Task Metrics' }).click();
    // alpha has 4 entries (e1-e4); e5 belongs to other agent
    await expect(page.getByTestId('metric-total')).toContainText('4 total', { timeout: 8000 });
  });

  test('hero stat card shows correct allowed count with success rate', async ({ page }) => {
    await seedTraffic(page);
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: 'Task Metrics' }).click();
    // 2 allowed out of 4 total = 50%
    await expect(page.getByTestId('metric-allowed')).toContainText('2 allowed', { timeout: 8000 });
    await expect(page.getByTestId('metric-allowed')).toContainText('50%');
  });

  test('hero stat card shows correct denied count', async ({ page }) => {
    await seedTraffic(page);
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: 'Task Metrics' }).click();
    await expect(page.getByTestId('metric-denied')).toContainText('1 denied', { timeout: 8000 });
  });

  test('hero stat card shows correct escalated count', async ({ page }) => {
    await seedTraffic(page);
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: 'Task Metrics' }).click();
    await expect(page.getByTestId('metric-escalated')).toContainText('1 escalated', { timeout: 8000 });
  });

  // ── Capability breakdown ──────────────────────────────────────────

  test('capability breakdown section is rendered', async ({ page }) => {
    await seedTraffic(page);
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: 'Task Metrics' }).click();
    await expect(page.getByTestId('capability-breakdown')).toBeVisible({ timeout: 8000 });
  });

  test('capability breakdown shows correct bars for agent capabilities', async ({ page }) => {
    await seedTraffic(page);
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: 'Task Metrics' }).click();
    await expect(page.getByTestId('capability-breakdown')).toBeVisible({ timeout: 8000 });
    // summarise appears twice, classify and extract once each
    const bars = page.getByTestId('capability-bar');
    await expect(bars).toHaveCount(3);
  });

  // ── Recent failures ───────────────────────────────────────────────

  test('recent failures section is rendered', async ({ page }) => {
    await seedTraffic(page);
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: 'Task Metrics' }).click();
    await expect(page.getByTestId('recent-failures')).toBeVisible({ timeout: 8000 });
  });

  test('recent failures shows denied and escalated entries', async ({ page }) => {
    await seedTraffic(page);
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: 'Task Metrics' }).click();
    await expect(page.getByTestId('recent-failures')).toBeVisible({ timeout: 8000 });
    const rows = page.getByTestId('failure-row');
    // 1 denied + 1 escalated = 2 failure rows
    await expect(rows).toHaveCount(2);
  });

  test('recent failures shows policy rule when present', async ({ page }) => {
    await seedTraffic(page);
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: 'Task Metrics' }).click();
    await expect(page.getByTestId('recent-failures')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/Rule: rate-limit/)).toBeVisible();
  });

  // ── Isolation: other agents' traffic not included ─────────────────

  test('other agents traffic does not appear in this agent metrics', async ({ page }) => {
    await seedTraffic(page);
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: 'Task Metrics' }).click();
    // total should be 4 (only alpha's entries), not 5
    await expect(page.getByTestId('metric-total')).toContainText('4 total', { timeout: 8000 });
  });

  // ── Tab switching ─────────────────────────────────────────────────

  test('can switch between Task Metrics and Overview tabs', async ({ page }) => {
    await seedTraffic(page);
    await gotoAgentDetail(page);

    // Go to metrics
    await page.getByRole('tab', { name: 'Task Metrics' }).click();
    await expect(page.getByTestId('agent-task-metrics')).toBeVisible({ timeout: 8000 });

    // Switch back to overview
    await page.getByRole('tab', { name: 'Overview' }).click();
    await expect(page.getByTestId('agent-task-metrics')).not.toBeVisible();
  });
});
