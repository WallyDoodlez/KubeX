import { test, expect } from '@playwright/test';

test.describe('Collapsible Dashboard Sections', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test to ensure default (expanded) state
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('kubex-dashboard-sections'));
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  // ── Presence ─────────────────────────────────────────────────────────

  test('Service Health section is present', async ({ page }) => {
    await expect(page.getByTestId('collapsible-section-service-health')).toBeVisible();
  });

  test('Registered Agents section is present', async ({ page }) => {
    await expect(page.getByTestId('collapsible-section-registered-agents')).toBeVisible();
  });

  test('Activity Feed section is present', async ({ page }) => {
    await expect(page.getByTestId('collapsible-section-activity-feed')).toBeVisible();
  });

  // ── Toggle buttons ────────────────────────────────────────────────────

  test('Service Health toggle button is visible', async ({ page }) => {
    await expect(page.getByTestId('collapsible-toggle-service-health')).toBeVisible();
  });

  test('Registered Agents toggle button is visible', async ({ page }) => {
    await expect(page.getByTestId('collapsible-toggle-registered-agents')).toBeVisible();
  });

  test('Activity Feed toggle button is visible', async ({ page }) => {
    await expect(page.getByTestId('collapsible-toggle-activity-feed')).toBeVisible();
  });

  // ── Default state (expanded) ──────────────────────────────────────────

  test('Service Health content is expanded by default', async ({ page }) => {
    const content = page.getByTestId('collapsible-content-service-health');
    await expect(content).toBeVisible();
    // Chevron should point down (expanded) — aria-expanded true on button
    const toggle = page.getByTestId('collapsible-toggle-service-health');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('Registered Agents content is expanded by default', async ({ page }) => {
    const toggle = page.getByTestId('collapsible-toggle-registered-agents');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('Activity Feed content is expanded by default', async ({ page }) => {
    const toggle = page.getByTestId('collapsible-toggle-activity-feed');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  // ── Section titles render ─────────────────────────────────────────────

  test('Service Health section title is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="collapsible-section-service-health"] h2', { hasText: 'Service Health' })).toBeVisible();
  });

  test('Registered Agents section title is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="collapsible-section-registered-agents"] h2', { hasText: 'Registered Agents' })).toBeVisible();
  });

  test('Activity Feed section title is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="collapsible-section-activity-feed"] h2', { hasText: 'Recent Activity' })).toBeVisible();
  });

  // ── Collapse interaction ──────────────────────────────────────────────

  test('clicking Service Health toggle collapses the section', async ({ page }) => {
    const toggle = page.getByTestId('collapsible-toggle-service-health');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('clicking Registered Agents toggle collapses the section', async ({ page }) => {
    const toggle = page.getByTestId('collapsible-toggle-registered-agents');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('clicking Activity Feed toggle collapses the section', async ({ page }) => {
    const toggle = page.getByTestId('collapsible-toggle-activity-feed');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('toggle is idempotent — collapse then expand restores expanded state', async ({ page }) => {
    const toggle = page.getByTestId('collapsible-toggle-service-health');
    // Collapse
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Expand again
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  // ── localStorage persistence ──────────────────────────────────────────

  test('collapsed state persists in localStorage after collapse', async ({ page }) => {
    const toggle = page.getByTestId('collapsible-toggle-service-health');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Read localStorage and verify service-health is marked collapsed
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('kubex-dashboard-sections');
      return raw ? JSON.parse(raw) : null;
    });
    expect(stored).not.toBeNull();
    expect(stored['service-health']).toBe(true);
  });

  test('expanded state does not mark section as collapsed in localStorage', async ({ page }) => {
    // Sections are expanded by default; check localStorage doesn't mark them as collapsed
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('kubex-dashboard-sections');
      return raw ? JSON.parse(raw) : {};
    });
    // Either no entry at all, or the value is falsy for service-health
    expect(!stored || !stored['service-health']).toBe(true);
  });

  test('collapsed state persists across page reload', async ({ page }) => {
    // Collapse the Registered Agents section
    const toggle = page.getByTestId('collapsible-toggle-registered-agents');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Reload the page
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');

    // Section should still be collapsed after reload
    const toggleAfterReload = page.getByTestId('collapsible-toggle-registered-agents');
    await expect(toggleAfterReload).toHaveAttribute('aria-expanded', 'false');
  });

  test('multiple sections can be collapsed independently', async ({ page }) => {
    const serviceToggle = page.getByTestId('collapsible-toggle-service-health');
    const agentToggle = page.getByTestId('collapsible-toggle-registered-agents');

    await serviceToggle.click();
    await expect(serviceToggle).toHaveAttribute('aria-expanded', 'false');
    // Agents should remain expanded
    await expect(agentToggle).toHaveAttribute('aria-expanded', 'true');

    await agentToggle.click();
    await expect(agentToggle).toHaveAttribute('aria-expanded', 'false');
    // Service Health stays collapsed
    await expect(serviceToggle).toHaveAttribute('aria-expanded', 'false');
  });

  // ── Accessibility ─────────────────────────────────────────────────────

  test('toggle button has aria-controls pointing to content panel', async ({ page }) => {
    const toggle = page.getByTestId('collapsible-toggle-service-health');
    const controlsId = await toggle.getAttribute('aria-controls');
    expect(controlsId).toBe('collapsible-panel-service-health');

    // The panel element should exist with that id
    const panel = page.locator(`#${controlsId}`);
    await expect(panel).toBeAttached();
  });

  test('content panel has role=region and aria-labelledby', async ({ page }) => {
    const panel = page.locator('#collapsible-panel-service-health');
    await expect(panel).toHaveAttribute('role', 'region');
    await expect(panel).toHaveAttribute('aria-labelledby', 'collapsible-header-service-health');
  });
});
