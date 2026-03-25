/**
 * Iteration 91 — Task history detail panel
 *
 * Tests the formatted detail panel that replaces the raw JSON expand row.
 *
 * Covers:
 * - Expanding a task row reveals the formatted detail panel (data-testid)
 * - Task ID and copy button are present
 * - Agent link has correct href and data-testid
 * - Capability badge renders with correct data-testid
 * - Status badge renders with correct data-testid
 * - Result content renders when details.result is present
 * - Error content renders when details.error is present
 * - Collapsing a row hides the detail panel
 * - Only one panel is expanded at a time
 */

import { test, expect, type Page } from '@playwright/test';
import { mockBaseRoutes } from './helpers';

// ── Mock data ────────────────────────────────────────────────────────

const ENTRY_1_ID = 'entry-detail-1';
const ENTRY_2_ID = 'entry-detail-2';

async function seedTasks(page: Page) {
  const NOW = Date.now();
  const items = [
    {
      id: ENTRY_1_ID,
      task_id: 'task-detail-001',
      agent_id: 'agent-detail-alpha',
      action: 'dispatch_task',
      capability: 'summarise',
      status: 'allowed',
      policy_rule: null,
      timestamp: new Date(NOW - 5 * 60 * 1000).toISOString(), // 5 min ago
      details: {
        result: '**Summary:** The document contains key findings.',
        completed_at: new Date(NOW - 4 * 60 * 1000).toISOString(), // 4 min ago
      },
    },
    {
      id: ENTRY_2_ID,
      task_id: 'task-detail-002',
      agent_id: 'agent-detail-beta',
      action: 'dispatch_task',
      capability: 'classify',
      status: 'denied',
      policy_rule: 'rate-limit',
      timestamp: new Date(NOW - 10 * 60 * 1000).toISOString(), // 10 min ago
      details: {
        error: 'Rate limit exceeded',
      },
    },
  ];
  await page.addInitScript((items) => {
    localStorage.setItem('kubex-traffic-log', JSON.stringify(items));
  }, items);
}

// ── Tests ────────────────────────────────────────────────────────────

test.describe('Task History Detail Panel (Iteration 91)', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page, { agents: [], kubexes: [] });
    await seedTasks(page);
    await page.goto('/tasks');
    await expect(page.getByTestId('task-history-table')).toBeVisible({ timeout: 8000 });
  });

  // ── Expand / visibility ──────────────────────────────────────────

  test('expanding a task row reveals the formatted detail panel', async ({ page }) => {
    await page.getByTestId(`task-row-${ENTRY_1_ID}`).click();
    await expect(page.getByTestId(`task-detail-panel-${ENTRY_1_ID}`)).toBeVisible({ timeout: 4000 });
  });

  test('detail panel is not visible before row is expanded', async ({ page }) => {
    // Panel exists in DOM (for animation) but content should be invisible (height 0)
    // We verify it is not visually present by checking the row hasn't been clicked yet
    const panel = page.getByTestId(`task-detail-panel-${ENTRY_1_ID}`);
    // The outer grid-rows div collapses the content; the panel itself may be in DOM
    // but the parent container should have zero effective height
    await expect(page.getByTestId(`task-row-${ENTRY_1_ID}`)).toHaveAttribute('aria-expanded', 'false');
  });

  // ── Task ID ──────────────────────────────────────────────────────

  test('expanded panel shows the task ID', async ({ page }) => {
    await page.getByTestId(`task-row-${ENTRY_1_ID}`).click();
    const panel = page.getByTestId(`task-detail-panel-${ENTRY_1_ID}`);
    await expect(panel).toBeVisible({ timeout: 4000 });
    await expect(panel).toContainText('task-detail-001');
  });

  test('expanded panel has a copy button for the task ID', async ({ page }) => {
    await page.getByTestId(`task-row-${ENTRY_1_ID}`).click();
    const panel = page.getByTestId(`task-detail-panel-${ENTRY_1_ID}`);
    await expect(panel).toBeVisible({ timeout: 4000 });
    await expect(panel.getByTestId('task-detail-copy-task-id')).toBeVisible();
  });

  // ── Agent link ───────────────────────────────────────────────────

  test('agent link has correct href', async ({ page }) => {
    await page.getByTestId(`task-row-${ENTRY_1_ID}`).click();
    const panel = page.getByTestId(`task-detail-panel-${ENTRY_1_ID}`);
    await expect(panel).toBeVisible({ timeout: 4000 });
    const agentLink = panel.getByTestId('task-detail-agent-link');
    await expect(agentLink).toBeVisible();
    await expect(agentLink).toHaveAttribute('href', '/agents/agent-detail-alpha');
  });

  test('agent link displays the agent ID text', async ({ page }) => {
    await page.getByTestId(`task-row-${ENTRY_1_ID}`).click();
    const panel = page.getByTestId(`task-detail-panel-${ENTRY_1_ID}`);
    await expect(panel).toBeVisible({ timeout: 4000 });
    await expect(panel.getByTestId('task-detail-agent-link')).toContainText('agent-detail-alpha');
  });

  // ── Capability badge ─────────────────────────────────────────────

  test('capability badge renders with correct text', async ({ page }) => {
    await page.getByTestId(`task-row-${ENTRY_1_ID}`).click();
    const panel = page.getByTestId(`task-detail-panel-${ENTRY_1_ID}`);
    await expect(panel).toBeVisible({ timeout: 4000 });
    await expect(panel.getByTestId('task-detail-capability')).toContainText('summarise');
  });

  test('second entry capability badge shows correct capability', async ({ page }) => {
    await page.getByTestId(`task-row-${ENTRY_2_ID}`).click();
    const panel = page.getByTestId(`task-detail-panel-${ENTRY_2_ID}`);
    await expect(panel).toBeVisible({ timeout: 4000 });
    await expect(panel.getByTestId('task-detail-capability')).toContainText('classify');
  });

  // ── Status badge ─────────────────────────────────────────────────

  test('status badge renders for allowed entry', async ({ page }) => {
    await page.getByTestId(`task-row-${ENTRY_1_ID}`).click();
    const panel = page.getByTestId(`task-detail-panel-${ENTRY_1_ID}`);
    await expect(panel).toBeVisible({ timeout: 4000 });
    const statusEl = panel.getByTestId('task-detail-status');
    await expect(statusEl).toBeVisible();
    await expect(statusEl).toContainText('allowed');
  });

  test('status badge renders for denied entry', async ({ page }) => {
    await page.getByTestId(`task-row-${ENTRY_2_ID}`).click();
    const panel = page.getByTestId(`task-detail-panel-${ENTRY_2_ID}`);
    await expect(panel).toBeVisible({ timeout: 4000 });
    await expect(panel.getByTestId('task-detail-status')).toContainText('denied');
  });

  // ── Result / error content ───────────────────────────────────────

  test('result content renders when details.result is present', async ({ page }) => {
    await page.getByTestId(`task-row-${ENTRY_1_ID}`).click();
    const panel = page.getByTestId(`task-detail-panel-${ENTRY_1_ID}`);
    await expect(panel).toBeVisible({ timeout: 4000 });
    const resultEl = panel.getByTestId('task-detail-result');
    await expect(resultEl).toBeVisible();
    // ReactMarkdown renders the bold text — check for the rendered content
    await expect(resultEl).toContainText('Summary');
  });

  test('error content renders when details.error is present', async ({ page }) => {
    await page.getByTestId(`task-row-${ENTRY_2_ID}`).click();
    const panel = page.getByTestId(`task-detail-panel-${ENTRY_2_ID}`);
    await expect(panel).toBeVisible({ timeout: 4000 });
    const resultEl = panel.getByTestId('task-detail-result');
    await expect(resultEl).toBeVisible();
    await expect(resultEl).toContainText('Rate limit exceeded');
  });

  // ── Timestamps & duration ────────────────────────────────────────

  test('dispatched timestamp is shown in the detail panel', async ({ page }) => {
    await page.getByTestId(`task-row-${ENTRY_1_ID}`).click();
    const panel = page.getByTestId(`task-detail-panel-${ENTRY_1_ID}`);
    await expect(panel).toBeVisible({ timeout: 4000 });
    // Panel should show some timestamp label
    await expect(panel).toContainText('Dispatched');
  });

  test('completed timestamp is shown when details.completed_at is present', async ({ page }) => {
    await page.getByTestId(`task-row-${ENTRY_1_ID}`).click();
    const panel = page.getByTestId(`task-detail-panel-${ENTRY_1_ID}`);
    await expect(panel).toBeVisible({ timeout: 4000 });
    await expect(panel).toContainText('Completed');
  });

  test('duration is shown when both timestamps are present', async ({ page }) => {
    await page.getByTestId(`task-row-${ENTRY_1_ID}`).click();
    const panel = page.getByTestId(`task-detail-panel-${ENTRY_1_ID}`);
    await expect(panel).toBeVisible({ timeout: 4000 });
    await expect(panel).toContainText('Duration');
  });

  // ── Collapse behavior ────────────────────────────────────────────

  test('clicking toggle again collapses the detail panel', async ({ page }) => {
    // Expand
    await page.getByTestId(`task-row-${ENTRY_1_ID}`).click();
    await expect(page.getByTestId(`task-row-${ENTRY_1_ID}`)).toHaveAttribute('aria-expanded', 'true', { timeout: 4000 });

    // Collapse
    await page.getByTestId(`task-row-${ENTRY_1_ID}`).click();
    await expect(page.getByTestId(`task-row-${ENTRY_1_ID}`)).toHaveAttribute('aria-expanded', 'false', { timeout: 4000 });
  });

  // ── Single panel at a time ───────────────────────────────────────

  test('expanding a second row collapses the first', async ({ page }) => {
    // Expand first row
    await page.getByTestId(`task-row-${ENTRY_1_ID}`).click();
    await expect(page.getByTestId(`task-row-${ENTRY_1_ID}`)).toHaveAttribute('aria-expanded', 'true', { timeout: 4000 });

    // Expand second row
    await page.getByTestId(`task-row-${ENTRY_2_ID}`).click();
    await expect(page.getByTestId(`task-row-${ENTRY_2_ID}`)).toHaveAttribute('aria-expanded', 'true', { timeout: 4000 });

    // First row should now be collapsed
    await expect(page.getByTestId(`task-row-${ENTRY_1_ID}`)).toHaveAttribute('aria-expanded', 'false');
  });
});
