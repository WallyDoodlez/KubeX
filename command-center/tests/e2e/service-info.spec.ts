import { test, expect } from '@playwright/test';

test.describe('Service Info Tooltips and Descriptions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    // Wait for service health section to be visible
    await expect(page.getByText('Service Health', { exact: true })).toBeVisible();
  });

  test('Gateway card shows description subtitle containing "Routes tasks"', async ({ page }) => {
    const description = page.locator('p', { hasText: 'Routes tasks' }).first();
    await expect(description).toBeVisible();
  });

  test('Registry card shows description subtitle containing "Tracks registered agents"', async ({ page }) => {
    const description = page.locator('p', { hasText: 'Tracks registered agents' }).first();
    await expect(description).toBeVisible();
  });

  test('Manager card shows description subtitle containing "Spawns"', async ({ page }) => {
    const description = page.locator('p', { hasText: 'Spawns' }).first();
    await expect(description).toBeVisible();
  });

  test('Broker card shows description subtitle containing "Distributes tasks"', async ({ page }) => {
    const description = page.locator('p', { hasText: 'Distributes tasks' }).first();
    await expect(description).toBeVisible();
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
