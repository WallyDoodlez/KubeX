/**
 * E2E tests for ApprovalQueue — search, filter tabs, sort, and result count
 * (Iteration 90)
 *
 * Covers:
 * 1.  Search input renders with correct data-testid
 * 2.  Filter tabs render: All, Pending, Approved, Denied
 * 3.  Sort dropdown renders with correct data-testid
 * 4.  Result count renders with data-testid="approval-count"
 * 5.  Count shows "0 escalations" when queue is empty
 * 6.  Search input filters cards by agent_id (with mock data injected)
 * 7.  Search input filters cards by action text
 * 8.  Search input filters cards by capability text
 * 9.  Search input filters cards by policy_rule text
 * 10. Empty filtered state shows when search matches nothing
 * 11. Status tab "Pending" filters to pending only
 * 12. Status tab "Approved" filters to approved only
 * 13. Status tab "Denied" filters to denied (rejected) only
 * 14. Sort "Oldest first" reorders cards correctly
 * 15. Sort "By agent" reorders cards alphabetically
 * 16. Clearing search restores full list
 * 17. "N of M shown" label appears when filtered
 */

import { test, expect } from '@playwright/test';
import { mockBaseRoutes, isLiveMode, GATEWAY } from './helpers';

// ---------------------------------------------------------------------------
// Test data — three escalations with distinct fields for filtering
// ---------------------------------------------------------------------------

const NOW = Date.now();

const MOCK_ESCALATIONS = [
  {
    id: 'esc-001',
    task_id: 'task-001',
    agent_id: 'agent-alpha-001',
    action: 'write_file',
    capability: 'filesystem_write',
    reason: 'Writing deployment config',
    policy_rule: 'deny_filesystem',
    timestamp: new Date(NOW - 3_600_000).toISOString(), // 1 hour ago (oldest)
    status: 'pending',
  },
  {
    id: 'esc-002',
    task_id: 'task-002',
    agent_id: 'agent-beta-002',
    action: 'send_email',
    capability: 'email_outbound',
    reason: 'Sending status update',
    policy_rule: 'require_approval_email',
    timestamp: new Date(NOW - 1_800_000).toISOString(), // 30 min ago
    status: 'approved',
  },
  {
    id: 'esc-003',
    task_id: 'task-003',
    agent_id: 'agent-gamma-003',
    action: 'delete_record',
    capability: 'database_write',
    reason: 'Cleaning up stale records',
    policy_rule: 'deny_delete',
    timestamp: new Date(NOW - 60_000).toISOString(), // 1 min ago (newest)
    status: 'rejected',
  },
];

// ---------------------------------------------------------------------------
// Route setup helpers
// ---------------------------------------------------------------------------

async function setupWithEscalations(page: import('@playwright/test').Page) {
  if (isLiveMode) {
    await page.goto('/approvals');
    return;
  }

  // mockBaseRoutes registers a handler for GET /escalations that returns [].
  // We register our override AFTER mockBaseRoutes so Playwright (which uses LIFO matching)
  // picks our handler first and returns the mock escalation data.
  await mockBaseRoutes(page);

  await page.route(`${GATEWAY}/escalations`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_ESCALATIONS),
    });
  });

  await page.goto('/approvals');
  // Wait for the count element to appear (loading completes)
  await page.waitForSelector('[data-testid="approval-count"]');
}

async function setupEmpty(page: import('@playwright/test').Page) {
  await mockBaseRoutes(page);
  await page.goto('/approvals');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Approval Queue — search, filter, sort', () => {
  // --- UI structure ---

  test('search input renders with correct testid', async ({ page }) => {
    await setupEmpty(page);
    await expect(page.locator('[data-testid="approval-search"]')).toBeVisible();
  });

  test('filter tabs render: All, Pending, Approved, Denied', async ({ page }) => {
    await setupEmpty(page);
    await expect(page.locator('[data-testid="approval-filter-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="approval-filter-pending"]')).toBeVisible();
    await expect(page.locator('[data-testid="approval-filter-approved"]')).toBeVisible();
    await expect(page.locator('[data-testid="approval-filter-denied"]')).toBeVisible();
  });

  test('sort dropdown renders with correct testid', async ({ page }) => {
    await setupEmpty(page);
    await expect(page.locator('[data-testid="approval-sort"]')).toBeVisible();
  });

  test('result count renders with correct testid', async ({ page }) => {
    await setupEmpty(page);
    await expect(page.locator('[data-testid="approval-count"]')).toBeVisible();
  });

  test('count shows "0 escalations" when queue is empty', async ({ page }) => {
    await setupEmpty(page);
    await expect(page.locator('[data-testid="approval-count"]')).toHaveText('0 escalations');
  });

  // --- Search filtering ---

  test('search filters by agent_id', async ({ page }) => {
    await setupWithEscalations(page);
    await page.locator('[data-testid="approval-search"]').fill('agent-alpha');
    // Only the alpha card should be visible
    await expect(page.getByText('agent-alpha-001')).toBeVisible();
    await expect(page.getByText('agent-beta-002')).not.toBeVisible();
    await expect(page.getByText('agent-gamma-003')).not.toBeVisible();
  });

  test('search filters by action text', async ({ page }) => {
    await setupWithEscalations(page);
    await page.locator('[data-testid="approval-search"]').fill('send_email');
    await expect(page.getByText('agent-beta-002')).toBeVisible();
    await expect(page.getByText('agent-alpha-001')).not.toBeVisible();
    await expect(page.getByText('agent-gamma-003')).not.toBeVisible();
  });

  test('search filters by capability text', async ({ page }) => {
    await setupWithEscalations(page);
    await page.locator('[data-testid="approval-search"]').fill('database_write');
    await expect(page.getByText('agent-gamma-003')).toBeVisible();
    await expect(page.getByText('agent-alpha-001')).not.toBeVisible();
    await expect(page.getByText('agent-beta-002')).not.toBeVisible();
  });

  test('search filters by policy_rule text', async ({ page }) => {
    await setupWithEscalations(page);
    await page.locator('[data-testid="approval-search"]').fill('deny_filesystem');
    await expect(page.getByText('agent-alpha-001')).toBeVisible();
    await expect(page.getByText('agent-beta-002')).not.toBeVisible();
    await expect(page.getByText('agent-gamma-003')).not.toBeVisible();
  });

  test('search is case-insensitive', async ({ page }) => {
    await setupWithEscalations(page);
    await page.locator('[data-testid="approval-search"]').fill('AGENT-BETA');
    await expect(page.getByText('agent-beta-002')).toBeVisible();
    await expect(page.getByText('agent-alpha-001')).not.toBeVisible();
  });

  test('empty filtered state shows when search matches nothing', async ({ page }) => {
    await setupWithEscalations(page);
    await page.locator('[data-testid="approval-search"]').fill('zzz-no-match-zzz');
    await expect(page.locator('[data-testid="approval-empty-filtered"]')).toBeVisible();
    await expect(page.getByText('No matching escalations')).toBeVisible();
  });

  test('clearing search restores full list', async ({ page }) => {
    await setupWithEscalations(page);
    await page.locator('[data-testid="approval-search"]').fill('agent-alpha');
    await expect(page.getByText('agent-beta-002')).not.toBeVisible();
    // Clear with the X button
    await page.locator('button[aria-label="Clear search"]').click();
    await expect(page.getByText('agent-alpha-001')).toBeVisible();
    await expect(page.getByText('agent-beta-002')).toBeVisible();
    await expect(page.getByText('agent-gamma-003')).toBeVisible();
  });

  // --- "N of M shown" count label ---

  test('"N of M shown" appears when search is active', async ({ page }) => {
    await setupWithEscalations(page);
    await page.locator('[data-testid="approval-search"]').fill('agent-alpha');
    await expect(page.locator('[data-testid="approval-count"]')).toContainText('of');
    await expect(page.locator('[data-testid="approval-count"]')).toContainText('shown');
  });

  test('"N escalations" shown when no filter active', async ({ page }) => {
    await setupWithEscalations(page);
    const countText = await page.locator('[data-testid="approval-count"]').textContent();
    expect(countText).toMatch(/3 escalations/);
  });

  // --- Status filter tabs ---

  test('"Pending" tab shows only pending escalations', async ({ page }) => {
    await setupWithEscalations(page);
    await page.locator('[data-testid="approval-filter-pending"]').click();
    await expect(page.getByText('agent-alpha-001')).toBeVisible(); // pending
    await expect(page.getByText('agent-beta-002')).not.toBeVisible(); // approved
    await expect(page.getByText('agent-gamma-003')).not.toBeVisible(); // rejected
  });

  test('"Approved" tab shows only approved escalations', async ({ page }) => {
    await setupWithEscalations(page);
    await page.locator('[data-testid="approval-filter-approved"]').click();
    await expect(page.getByText('agent-beta-002')).toBeVisible(); // approved
    await expect(page.getByText('agent-alpha-001')).not.toBeVisible();
    await expect(page.getByText('agent-gamma-003')).not.toBeVisible();
  });

  test('"Denied" tab shows only rejected escalations', async ({ page }) => {
    await setupWithEscalations(page);
    await page.locator('[data-testid="approval-filter-denied"]').click();
    await expect(page.getByText('agent-gamma-003')).toBeVisible(); // rejected
    await expect(page.getByText('agent-alpha-001')).not.toBeVisible();
    await expect(page.getByText('agent-beta-002')).not.toBeVisible();
  });

  test('"All" tab shows all escalations', async ({ page }) => {
    await setupWithEscalations(page);
    // Switch to Pending then back to All
    await page.locator('[data-testid="approval-filter-pending"]').click();
    await page.locator('[data-testid="approval-filter-all"]').click();
    await expect(page.getByText('agent-alpha-001')).toBeVisible();
    await expect(page.getByText('agent-beta-002')).toBeVisible();
    await expect(page.getByText('agent-gamma-003')).toBeVisible();
  });

  // --- Sort ---

  test('"Oldest first" puts oldest card first', async ({ page }) => {
    await setupWithEscalations(page);
    await page.locator('[data-testid="approval-sort"]').selectOption('oldest');
    // agent-alpha-001 was created 1 hour ago (oldest)
    const cards = page.locator('.font-mono-data').filter({ hasText: /^agent-/ });
    await expect(cards.first()).toContainText('agent-alpha-001');
  });

  test('"Newest first" puts newest card first (default)', async ({ page }) => {
    await setupWithEscalations(page);
    // Default is newest first — agent-gamma-003 is 1 min ago
    const cards = page.locator('.font-mono-data').filter({ hasText: /^agent-/ });
    await expect(cards.first()).toContainText('agent-gamma-003');
  });

  test('"By agent" sorts alphabetically by agent_id', async ({ page }) => {
    await setupWithEscalations(page);
    await page.locator('[data-testid="approval-sort"]').selectOption('agent');
    // alpha < beta < gamma
    const cards = page.locator('.font-mono-data').filter({ hasText: /^agent-/ });
    await expect(cards.first()).toContainText('agent-alpha-001');
    await expect(cards.nth(1)).toContainText('agent-beta-002');
    await expect(cards.nth(2)).toContainText('agent-gamma-003');
  });
});
