import { test, expect } from '@playwright/test';

/**
 * Iteration 21: Connection Health Indicator (Top Bar)
 *
 * Tests that the ConnectionIndicator is present on every page, reflects
 * aggregate service health, and that its popover shows individual service
 * statuses with correct accessibility attributes.
 */
test.describe('Connection Health Indicator', () => {

  // ── Presence ─────────────────────────────────────────────────────────

  test('indicator is visible in the top bar on Dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('connection-indicator')).toBeVisible();
  });

  test('indicator is visible on the Agents page (not just Dashboard)', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.getByTestId('connection-indicator')).toBeVisible();
  });

  test('indicator is visible on the Traffic page', async ({ page }) => {
    await page.goto('/traffic');
    await expect(page.getByTestId('connection-indicator')).toBeVisible();
  });

  test('indicator is visible on the Chat/Orchestrator page', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.getByTestId('connection-indicator')).toBeVisible();
  });

  test('indicator is visible on the Containers page', async ({ page }) => {
    await page.goto('/containers');
    await expect(page.getByTestId('connection-indicator')).toBeVisible();
  });

  test('indicator is visible on the Approvals page', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.getByTestId('connection-indicator')).toBeVisible();
  });

  // ── Healthy state (default MSW handlers return healthy) ──────────────

  test('dot turns emerald green when all services are healthy', async ({ page }) => {
    await page.goto('/');
    // Wait for health check to complete
    await page.waitForTimeout(2500);
    const dot = page.getByTestId('connection-indicator-dot');
    await expect(dot).toBeVisible();
    // In healthy state data-status should be "operational"
    await expect(dot).toHaveAttribute('data-status', 'operational');
  });

  test('label shows "live" when all services are operational', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2500);
    const label = page.getByTestId('connection-indicator-label');
    await expect(label).toBeVisible();
    await expect(label).toHaveText('live');
  });

  // ── Accessibility ────────────────────────────────────────────────────

  test('indicator button has aria-label describing system health', async ({ page }) => {
    await page.goto('/');
    const btn = page.getByTestId('connection-indicator');
    const ariaLabel = await btn.getAttribute('aria-label');
    expect(ariaLabel).toMatch(/system health/i);
  });

  test('indicator button has aria-haspopup="true"', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('connection-indicator')).toHaveAttribute('aria-haspopup', 'true');
  });

  test('indicator button has aria-expanded="false" when closed', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('connection-indicator')).toHaveAttribute('aria-expanded', 'false');
  });

  // ── Popover open/close ───────────────────────────────────────────────

  test('popover is not visible before clicking the indicator', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('connection-indicator-popover')).not.toBeVisible();
  });

  test('popover opens when indicator is clicked', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('connection-indicator').click();
    await expect(page.getByTestId('connection-indicator-popover')).toBeVisible();
  });

  test('aria-expanded becomes "true" when popover is open', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('connection-indicator').click();
    await expect(page.getByTestId('connection-indicator')).toHaveAttribute('aria-expanded', 'true');
  });

  test('popover closes when indicator is clicked again', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('connection-indicator').click();
    await expect(page.getByTestId('connection-indicator-popover')).toBeVisible();
    await page.getByTestId('connection-indicator').click();
    await expect(page.getByTestId('connection-indicator-popover')).not.toBeVisible();
  });

  test('popover closes when Escape is pressed', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('connection-indicator').click();
    await expect(page.getByTestId('connection-indicator-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('connection-indicator-popover')).not.toBeVisible();
  });

  test('popover closes when clicking outside', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('connection-indicator').click();
    await expect(page.getByTestId('connection-indicator-popover')).toBeVisible();
    // Click somewhere else in the layout
    await page.locator('main').click({ position: { x: 10, y: 200 } });
    await expect(page.getByTestId('connection-indicator-popover')).not.toBeVisible();
  });

  // ── Popover content ─────────────────────────────────────────────────

  test('popover lists all five services', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2500); // wait for health checks
    await page.getByTestId('connection-indicator').click();
    const popover = page.getByTestId('connection-indicator-popover');
    await expect(popover).toBeVisible();

    // All five services should appear
    for (const name of ['gateway', 'registry', 'manager', 'broker', 'redis']) {
      await expect(
        page.getByTestId(`service-status-row-${name}`)
      ).toBeVisible();
    }
  });

  test('popover shows "healthy" status for services when all up', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2500);
    await page.getByTestId('connection-indicator').click();
    const popover = page.getByTestId('connection-indicator-popover');
    // At least one service row should show "healthy"
    const healthyRows = popover.locator('text=healthy');
    await expect(healthyRows.first()).toBeVisible();
  });

  test('popover has role="tooltip" for semantics', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('connection-indicator').click();
    await expect(page.getByTestId('connection-indicator-popover')).toHaveAttribute('role', 'tooltip');
  });

  test('popover service list has aria-label', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('connection-indicator').click();
    const list = page.getByRole('list', { name: /individual service statuses/i });
    await expect(list).toBeVisible();
  });

  test('popover shows refresh interval hint text', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('connection-indicator').click();
    await expect(page.getByTestId('connection-indicator-popover')).toContainText('Refreshes every 15s');
  });

  // ── Degraded state simulation ────────────────────────────────────────

  test('indicator shows degraded state when a service is down', async ({ page }) => {
    // Override health endpoint to return unhealthy for Registry
    await page.route('**/localhost:8070/health', (route) => {
      route.fulfill({ status: 503, body: JSON.stringify({ status: 'unhealthy' }) });
    });

    await page.goto('/');
    // Wait for health checks (hook fires immediately)
    await page.waitForTimeout(2000);

    const dot = page.getByTestId('connection-indicator-dot');
    const status = await dot.getAttribute('data-status');
    // Should be either degraded or critical (not operational)
    expect(['degraded', 'critical']).toContain(status);
  });

  // ── Navigation persistence ────────────────────────────────────────

  test('indicator persists when navigating between pages', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('connection-indicator')).toBeVisible();

    // Navigate to Agents
    await page.goto('/agents');
    await expect(page.getByTestId('connection-indicator')).toBeVisible();

    // Navigate to Traffic
    await page.goto('/traffic');
    await expect(page.getByTestId('connection-indicator')).toBeVisible();
  });
});
