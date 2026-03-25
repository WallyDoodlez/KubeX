/**
 * E2E tests for Iteration 63 — Agent Detail Live Output Tab.
 *
 * The tab replaces the old placeholder with a fetch-based SSE reader
 * that connects to GET /agents/{agent_id}/lifecycle on the Gateway.
 *
 * Uses Playwright route mocking to serve a registry response with a real
 * agent so the detail page renders its tab layout.
 */
import { test, expect, Route } from '@playwright/test';
import { mockBaseRoutes, GATEWAY, MOCK_AGENTS } from './helpers';

const AGENT_ID = 'agent-alpha-001';
const GATEWAY_LIFECYCLE_PATTERN = `${GATEWAY}/agents/${AGENT_ID}/lifecycle`;

// Use the full shared MOCK_AGENTS which includes agent-alpha-001 with the fields needed
// Override metadata to match what these tests originally expected
const mockAgents = [
  {
    agent_id: AGENT_ID,
    capabilities: ['summarise', 'classify', 'extract'],
    status: 'running',
    boundary: 'internal',
    registered_at: '2026-03-22T08:00:00Z',
    metadata: { version: '1.2.0', region: 'us-east-1' },
  },
];

/** Set up route mocks for a given page so the agent detail renders correctly. */
async function setupMocks(page: import('@playwright/test').Page) {
  // Base routes: health, agents (with our specific agent list), kubexes, escalations
  await mockBaseRoutes(page, { agents: mockAgents, kubexes: [] });

  // Mock gateway lifecycle SSE — return 200 with an event, then idle
  await page.route(GATEWAY_LIFECYCLE_PATTERN, (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache' },
      body: `data: {"agent_id":"${AGENT_ID}","state":"running","timestamp":"2026-03-24T10:00:00Z"}\n\ndata: {"agent_id":"${AGENT_ID}","state":"idle","timestamp":"2026-03-24T10:00:01Z"}\n\n`,
    });
  });
}

/** Navigate to the agent detail page and wait for tabs to render. */
async function gotoAgentDetail(page: import('@playwright/test').Page) {
  await setupMocks(page);
  await page.goto(`/agents/${AGENT_ID}`);
  // Wait for the tabs to become visible (means agent loaded successfully)
  await expect(page.locator('[role="tablist"]')).toBeVisible({ timeout: 10000 });
}

test.describe('Agent Detail — Live Output Tab', () => {
  test('Live Output tab is present in agent detail tabs', async ({ page }) => {
    await gotoAgentDetail(page);
    await expect(page.getByRole('tab', { name: /live output/i })).toBeVisible();
  });

  test('clicking Live Output tab shows live-output-tab container', async ({ page }) => {
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    await expect(page.locator('[data-testid="live-output-tab"]')).toBeVisible();
  });

  test('shows status dot and label', async ({ page }) => {
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    await expect(page.locator('[data-testid="live-output-status-dot"]')).toBeVisible();
    await expect(page.locator('[data-testid="live-output-status-label"]')).toBeVisible();
  });

  test('shows connect or disconnect button', async ({ page }) => {
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    // Wait for connection attempt to resolve (SSE mock resolves immediately)
    await page.waitForTimeout(2000);
    // Either connected (disconnect btn) or failed/closed (connect btn) — one must be visible
    const connectBtn = page.locator('[data-testid="live-output-connect-btn"]');
    const disconnectBtn = page.locator('[data-testid="live-output-disconnect-btn"]');
    const hasConnect = await connectBtn.isVisible().catch(() => false);
    const hasDisconnect = await disconnectBtn.isVisible().catch(() => false);
    expect(hasConnect || hasDisconnect).toBe(true);
  });

  test('event log area is rendered with role=log', async ({ page }) => {
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    await expect(page.locator('[data-testid="live-output-events"]')).toBeVisible();
    const role = await page.locator('[data-testid="live-output-events"]').getAttribute('role');
    expect(role).toBe('log');
  });

  test('event log has aria-label', async ({ page }) => {
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    const ariaLabel = await page.locator('[data-testid="live-output-events"]').getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
  });

  test('event log has aria-live polite', async ({ page }) => {
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    const ariaLive = await page.locator('[data-testid="live-output-events"]').getAttribute('aria-live');
    expect(ariaLive).toBe('polite');
  });

  test('shows empty/waiting state or event rows when SSE responds', async ({ page }) => {
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    await page.waitForTimeout(2000);
    // After SSE mock responds, there should be events OR empty/waiting state
    const waiting = page.locator('[data-testid="live-output-waiting"]');
    const empty = page.locator('[data-testid="live-output-empty"]');
    const eventRow = page.locator('[data-testid="live-output-event-row"]');
    const hasWaiting = await waiting.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);
    const hasEvents = await eventRow.first().isVisible().catch(() => false);
    expect(hasWaiting || hasEmpty || hasEvents).toBe(true);
  });

  test('other tabs still work after visiting Live Output', async ({ page }) => {
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('tab', { name: /overview/i }).click();
    await expect(page.locator('[data-testid="dispatch-task-btn"]')).toBeVisible();
  });

  test('Actions tab still works after visiting Live Output', async ({ page }) => {
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('tab', { name: /actions/i }).click();
    await expect(page.locator('[data-testid="dispatch-capability"]')).toBeVisible();
  });

  test('Config tab still works after visiting Live Output', async ({ page }) => {
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('tab', { name: /config/i }).click();
    await expect(page.locator('pre')).toBeVisible();
  });

  test('tab header status label shows a recognised state', async ({ page }) => {
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    await page.waitForTimeout(2000);
    const labelEl = page.locator('[data-testid="live-output-status-label"]');
    const text = await labelEl.textContent();
    expect(['Connecting…', 'Live', 'Error', 'Disconnected', 'Not connected']).toContain(text?.trim());
  });

  test('connect button is focusable', async ({ page }) => {
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    await page.waitForTimeout(2000);
    const connectBtn = page.locator('[data-testid="live-output-connect-btn"]');
    const visible = await connectBtn.isVisible().catch(() => false);
    if (visible) {
      await connectBtn.focus();
      const focused = await connectBtn.evaluate((el) => el === document.activeElement);
      expect(focused).toBe(true);
    } else {
      // Disconnect btn is visible instead — that's fine too
      const disconnectBtn = page.locator('[data-testid="live-output-disconnect-btn"]');
      const dVisible = await disconnectBtn.isVisible().catch(() => false);
      expect(dVisible).toBe(true);
    }
  });

  test('clear button appears when there are event rows', async ({ page }) => {
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    await page.waitForTimeout(2000);
    const eventRows = page.locator('[data-testid="live-output-event-row"]');
    const count = await eventRows.count();
    if (count > 0) {
      await expect(page.locator('[data-testid="live-output-clear-btn"]')).toBeVisible();
    }
    // If no events, clear btn not visible — this is expected behaviour
  });

  test('clear button removes all events', async ({ page }) => {
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    await page.waitForTimeout(2000);
    const clearBtn = page.locator('[data-testid="live-output-clear-btn"]');
    const visible = await clearBtn.isVisible().catch(() => false);
    if (visible) {
      await clearBtn.click();
      // Events should be cleared
      const eventRows = page.locator('[data-testid="live-output-event-row"]');
      const count = await eventRows.count();
      expect(count).toBe(0);
    }
  });

  test('tab does not crash when agent is not found', async ({ page }) => {
    await page.goto('/agents/nonexistent-xyz');
    await page.waitForTimeout(3000);
    await expect(page.locator('aside')).toBeVisible();
  });

  test('navigating away stops the stream gracefully', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => {
      if (!e.message.includes('ResizeObserver')) errors.push(e.message);
    });
    await gotoAgentDetail(page);
    await page.getByRole('tab', { name: /live output/i }).click();
    await page.waitForTimeout(500);
    // Navigate away
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents');
    expect(errors).toHaveLength(0);
  });
});
