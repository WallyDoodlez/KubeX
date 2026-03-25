import { test, expect } from '@playwright/test';

test.describe('Service Info Tooltips and Descriptions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    // Wait for service health section to be visible
    await expect(page.getByText('Service Health', { exact: true })).toBeVisible();
  });

  // Iteration 88: inline description was removed — descriptions now live only in the tooltip.
  // Verify descriptions are accessible via hover tooltip (not inline paragraph).

  test('Gateway card description "Routes tasks" is in tooltip, not inline', async ({ page }) => {
    // Inline description paragraph must be gone
    await expect(page.locator('p.text-\\[10px\\]', { hasText: 'Routes tasks' })).not.toBeVisible();
    // Tooltip must contain the description on hover
    await page.locator('[data-testid="service-info-Gateway"]').hover();
    await expect(page.locator('[role="tooltip"]').first()).toContainText('Routes tasks', { timeout: 3000 });
  });

  test('Registry card description "Tracks registered agents" is in tooltip, not inline', async ({ page }) => {
    await expect(page.locator('p.text-\\[10px\\]', { hasText: 'Tracks registered agents' })).not.toBeVisible();
    await page.locator('[data-testid="service-info-Registry"]').hover();
    await expect(page.locator('[role="tooltip"]').first()).toContainText('Tracks registered agents', { timeout: 3000 });
  });

  test('Manager card description "Spawns" is in tooltip, not inline', async ({ page }) => {
    await expect(page.locator('p.text-\\[10px\\]', { hasText: 'Spawns' })).not.toBeVisible();
    await page.locator('[data-testid="service-info-Manager"]').hover();
    await expect(page.locator('[role="tooltip"]').first()).toContainText('Spawns', { timeout: 3000 });
  });

  test('Broker card description "Distributes tasks" is in tooltip, not inline', async ({ page }) => {
    await expect(page.locator('p.text-\\[10px\\]', { hasText: 'Distributes tasks' })).not.toBeVisible();
    await page.locator('[data-testid="service-info-Broker"]').hover();
    await expect(page.locator('[role="tooltip"]').first()).toContainText('Distributes tasks', { timeout: 3000 });
  });

  test('info icon is present on Gateway service card', async ({ page }) => {
    await expect(page.locator('[data-testid="service-info-Gateway"]')).toBeVisible();
  });

  test('info icon is present on Registry service card', async ({ page }) => {
    await expect(page.locator('[data-testid="service-info-Registry"]')).toBeVisible();
  });

  test('info icon is present on Manager service card', async ({ page }) => {
    await expect(page.locator('[data-testid="service-info-Manager"]')).toBeVisible();
  });

  test('info icon is present on Broker service card', async ({ page }) => {
    await expect(page.locator('[data-testid="service-info-Broker"]')).toBeVisible();
  });

  test('all 4 service info icons are present (count check)', async ({ page }) => {
    const infoIcons = page.locator('[data-testid^="service-info-"]');
    // At minimum Gateway, Registry, Manager, Broker
    const count = await infoIcons.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('hovering Gateway info icon shows tooltip content', async ({ page }) => {
    const icon = page.locator('[data-testid="service-info-Gateway"]');
    await icon.hover();
    // Tooltip should appear with some content
    await expect(page.locator('[role="tooltip"]').first()).toBeVisible({ timeout: 3000 });
    // Should mention the Gateway description
    await expect(page.locator('[role="tooltip"]').first()).toContainText('Routes tasks');
  });

  test('hovering Registry info icon shows tooltip content', async ({ page }) => {
    const icon = page.locator('[data-testid="service-info-Registry"]');
    await icon.hover();
    await expect(page.locator('[role="tooltip"]').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[role="tooltip"]').first()).toContainText('Tracks registered agents');
  });

  test('Gateway tooltip mentions port number', async ({ page }) => {
    const icon = page.locator('[data-testid="service-info-Gateway"]');
    await icon.hover();
    const tooltip = page.locator('[role="tooltip"]').first();
    await expect(tooltip).toBeVisible({ timeout: 3000 });
    await expect(tooltip).toContainText('8080');
  });

  test('Registry tooltip mentions port number', async ({ page }) => {
    const icon = page.locator('[data-testid="service-info-Registry"]');
    await icon.hover();
    const tooltip = page.locator('[role="tooltip"]').first();
    await expect(tooltip).toBeVisible({ timeout: 3000 });
    await expect(tooltip).toContainText('8070');
  });

  test('Manager tooltip mentions port number', async ({ page }) => {
    const icon = page.locator('[data-testid="service-info-Manager"]');
    await icon.hover();
    const tooltip = page.locator('[role="tooltip"]').first();
    await expect(tooltip).toBeVisible({ timeout: 3000 });
    await expect(tooltip).toContainText('8090');
  });

  test('Broker tooltip mentions internal service (no port)', async ({ page }) => {
    const icon = page.locator('[data-testid="service-info-Broker"]');
    await icon.hover();
    const tooltip = page.locator('[role="tooltip"]').first();
    await expect(tooltip).toBeVisible({ timeout: 3000 });
    await expect(tooltip).toContainText('Internal service');
  });
});
