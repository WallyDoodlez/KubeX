import { test, expect } from '@playwright/test';

test.describe('System Status Banner', () => {
  test('renders on the Dashboard page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="system-status-banner"]')).toBeVisible();
  });

  test('shows operational state when all services are healthy', async ({ page }) => {
    // Default MSW handlers return healthy for all services
    await page.goto('/');
    // Wait for health checks to complete
    await page.waitForTimeout(2000);
    const banner = page.locator('[data-testid="system-status-banner"]');
    await expect(banner).toBeVisible();
    // Should show "All Systems Operational" text
    await expect(banner.locator('text=All Systems Operational')).toBeVisible({ timeout: 8000 });
  });

  test('displays summary pill for agent count', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    const agentPill = page.locator('[data-testid="status-banner-agent-count"]');
    await expect(agentPill).toBeVisible();
    // Should show "Agents" label
    await expect(agentPill.locator('text=Agents')).toBeVisible();
  });

  test('displays summary pill for kubex count', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    const kubexPill = page.locator('[data-testid="status-banner-kubex-count"]');
    await expect(kubexPill).toBeVisible();
    await expect(kubexPill.locator('text=Kubexes')).toBeVisible();
  });

  test('displays summary pill for service count ratio', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    const servicePill = page.locator('[data-testid="status-banner-service-count"]');
    await expect(servicePill).toBeVisible();
    await expect(servicePill.locator('text=Services')).toBeVisible();
  });

  test('banner has role="status" for accessibility', async ({ page }) => {
    await page.goto('/');
    const banner = page.locator('[data-testid="system-status-banner"]');
    await expect(banner).toHaveAttribute('role', 'status');
  });

  test('banner has aria-live="polite" for live region', async ({ page }) => {
    await page.goto('/');
    const banner = page.locator('[data-testid="system-status-banner"]');
    await expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  test('initial loading state shows checking indicator', async ({ page }) => {
    await page.goto('/');
    // Immediately after load, services are in 'loading' state
    // The banner should be present even during loading
    const banner = page.locator('[data-testid="system-status-banner"]');
    await expect(banner).toBeVisible();
    // data-status attribute should be set
    const status = await banner.getAttribute('data-status');
    expect(['loading', 'operational', 'degraded', 'critical']).toContain(status);
  });

  test('banner is only rendered on Dashboard (not other pages)', async ({ page }) => {
    // Should not appear on agents page
    await page.goto('/agents');
    await expect(page.locator('[data-testid="system-status-banner"]')).not.toBeVisible();

    // Should not appear on traffic page
    await page.goto('/traffic');
    await expect(page.locator('[data-testid="system-status-banner"]')).not.toBeVisible();
  });
});

test.describe('Breadcrumb Navigation', () => {
  test('breadcrumb renders on agent detail page', async ({ page }) => {
    await page.goto('/agents/agent-alpha-001');
    // Wait for content to load
    await page.waitForTimeout(2000);
    const breadcrumb = page.locator('[data-testid="breadcrumb"]');
    await expect(breadcrumb).toBeVisible();
  });

  test('breadcrumb shows "Agents" as first item on agent detail page', async ({ page }) => {
    await page.goto('/agents/agent-alpha-001');
    await page.waitForTimeout(2000);
    const breadcrumb = page.locator('[data-testid="breadcrumb"]');
    await expect(breadcrumb.locator('text=Agents')).toBeVisible();
  });

  test('breadcrumb shows agent ID as last item', async ({ page }) => {
    await page.goto('/agents/agent-alpha-001');
    await page.waitForTimeout(2000);
    const breadcrumb = page.locator('[data-testid="breadcrumb"]');
    // The agent ID should appear in the breadcrumb
    await expect(breadcrumb.locator('text=agent-alpha-001')).toBeVisible();
  });

  test('breadcrumb last item has aria-current="page"', async ({ page }) => {
    await page.goto('/agents/agent-alpha-001');
    await page.waitForTimeout(2000);
    const breadcrumb = page.locator('[data-testid="breadcrumb"]');
    // The last span should have aria-current=page
    await expect(breadcrumb.locator('[aria-current="page"]')).toBeVisible();
  });

  test('breadcrumb "Agents" link navigates back to agents list', async ({ page }) => {
    await page.goto('/agents/agent-alpha-001');
    await page.waitForTimeout(2000);
    // Click the "Agents" breadcrumb button
    const breadcrumb = page.locator('[data-testid="breadcrumb"]');
    await breadcrumb.locator('button', { hasText: 'Agents' }).click();
    await expect(page.locator('header h1')).toHaveText('Agents');
  });

  test('top bar shows breadcrumb for /agents/:agentId route', async ({ page }) => {
    await page.goto('/agents/agent-alpha-001');
    await page.waitForTimeout(1000);
    // The top-bar header should have a breadcrumb nav
    const topBar = page.locator('header[role="banner"]');
    await expect(topBar.locator('[data-testid="breadcrumb"]')).toBeVisible();
  });

  test('top bar does NOT show breadcrumb on flat routes', async ({ page }) => {
    await page.goto('/agents');
    // The top-bar breadcrumb nav should not be visible on flat routes
    const topBar = page.locator('header[role="banner"]');
    const bc = topBar.locator('[data-testid="breadcrumb"]');
    await expect(bc).not.toBeVisible();
  });

  test('breadcrumb not rendered on agents list page', async ({ page }) => {
    await page.goto('/agents');
    // No breadcrumb at page level
    // (AgentDetailPage is not rendered, so no [data-testid="breadcrumb"] in main)
    const main = page.locator('main');
    await expect(main.locator('[data-testid="breadcrumb"]')).not.toBeVisible();
  });
});
