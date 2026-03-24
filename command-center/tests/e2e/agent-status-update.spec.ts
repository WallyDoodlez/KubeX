import { test, expect } from '@playwright/test';

/**
 * Iteration 68 — Agent status update
 *
 * Tests cover the new AgentStatusControls panel on the Overview tab
 * of AgentDetailPage:
 * - Panel renders with all four status buttons
 * - Active status is visually indicated and disabled
 * - Inactive status buttons are enabled
 * - Clicking a status calls PATCH /agents/{id}/status and shows success
 * - Error path: shows error message on 500
 * - Success message auto-clears
 * - Controls only visible on Overview tab
 */

const AGENT_ID = 'agent-alpha-001';

const MOCK_AGENTS = [
  {
    agent_id: 'agent-alpha-001',
    capabilities: ['summarise', 'classify', 'extract'],
    status: 'running',
    boundary: 'internal',
    registered_at: '2026-03-22T08:00:00Z',
    metadata: { version: '1.2.0' },
  },
];

async function mockApis(page: import('@playwright/test').Page) {
  // PATCH agent status — Registry (must be registered before the broader agents route)
  await page.route('**/agents/*/status', (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { status?: string };
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ agent_id: AGENT_ID, status: body?.status ?? 'unknown' }),
      });
    } else {
      route.continue();
    }
  });

  // Registry agents list (GET only — after specific routes)
  await page.route('**/agents', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_AGENTS) });
    } else {
      route.continue();
    }
  });

  // Health endpoints
  await page.route('**/health', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'healthy' }) });
  });

  // Kubexes (Manager)
  await page.route('**/kubexes', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  // Escalations
  await page.route('**/escalations', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

test.describe('Iteration 68 — Agent status update', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page);
    await page.goto(`/agents/${AGENT_ID}`);
    // Wait for the agent to load (tablist appears once agent data is resolved)
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10000 });
    // Overview tab is default — status controls should be visible
    await expect(page.getByTestId('agent-status-controls')).toBeVisible({ timeout: 8000 });
  });

  test('status controls panel is visible on overview tab', async ({ page }) => {
    await expect(page.getByTestId('agent-status-controls')).toBeVisible();
  });

  test('all four status buttons are rendered', async ({ page }) => {
    for (const status of ['running', 'busy', 'stopped', 'unknown']) {
      await expect(page.getByTestId(`status-btn-${status}`)).toBeVisible();
    }
  });

  test('current status button (running) has aria-pressed=true', async ({ page }) => {
    await expect(page.getByTestId('status-btn-running')).toHaveAttribute('aria-pressed', 'true');
  });

  test('current status button is disabled', async ({ page }) => {
    await expect(page.getByTestId('status-btn-running')).toBeDisabled();
  });

  test('inactive status buttons are enabled', async ({ page }) => {
    await expect(page.getByTestId('status-btn-stopped')).toBeEnabled();
    await expect(page.getByTestId('status-btn-busy')).toBeEnabled();
    await expect(page.getByTestId('status-btn-unknown')).toBeEnabled();
  });

  test('clicking a different status shows success feedback', async ({ page }) => {
    await page.getByTestId('status-btn-stopped').click();
    await expect(page.getByTestId('status-update-success')).toBeVisible({ timeout: 6000 });
    await expect(page.getByTestId('status-update-success')).toContainText('stopped');
  });

  test('success message auto-clears after ~4 seconds', async ({ page }) => {
    await page.getByTestId('status-btn-busy').click();
    await expect(page.getByTestId('status-update-success')).toBeVisible({ timeout: 6000 });
    // Message should disappear after the 4s timeout
    await expect(page.getByTestId('status-update-success')).not.toBeVisible({ timeout: 7000 });
  });

  test('error message shown when backend returns 500', async ({ page }) => {
    // Override the PATCH handler to return an error
    await page.route('**/agents/*/status', (route) => {
      if (route.request().method() === 'PATCH') {
        route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Internal error' }) });
      } else {
        route.continue();
      }
    });

    await page.getByTestId('status-btn-stopped').click();
    await expect(page.getByTestId('status-update-error')).toBeVisible({ timeout: 6000 });
  });

  test('status controls not visible on Actions tab', async ({ page }) => {
    await page.getByRole('tab', { name: 'Actions' }).click();
    await expect(page.getByTestId('agent-status-controls')).not.toBeVisible();
  });

  test('status controls not visible on Config tab', async ({ page }) => {
    await page.getByRole('tab', { name: 'Config' }).click();
    await expect(page.getByTestId('agent-status-controls')).not.toBeVisible();
  });

  test('navigating back to overview restores status controls', async ({ page }) => {
    await page.getByRole('tab', { name: 'Actions' }).click();
    await expect(page.getByTestId('agent-status-controls')).not.toBeVisible();
    await page.getByRole('tab', { name: 'Overview' }).click();
    await expect(page.getByTestId('agent-status-controls')).toBeVisible();
  });

  test('each status button has a descriptive aria-label', async ({ page }) => {
    for (const [value, label] of [
      ['running', 'Running'],
      ['busy', 'Busy'],
      ['stopped', 'Stopped'],
      ['unknown', 'Unknown'],
    ]) {
      await expect(page.getByTestId(`status-btn-${value}`)).toHaveAttribute(
        'aria-label',
        `Set agent status to ${label}`,
      );
    }
  });
});
