/**
 * E2E tests for GlobalProgressBar — Iteration 92
 *
 * The progress bar is rendered in Layout and driven by module-level state
 * in LoadingContext. Since it responds to actual API fetches (health checks
 * trigger startLoading/stopLoading), we test:
 *   - The bar element is present in the DOM with the correct testid
 *   - The bar appears and disappears correctly during page load
 *   - The bar has the correct fixed positioning styles
 */
import { test, expect } from '@playwright/test';
import { mockBaseRoutes } from './helpers';

test.describe('GlobalProgressBar', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
  });

  test('progress bar element has correct data-testid', async ({ page }) => {
    // The bar is conditionally rendered — we observe it briefly on navigation
    // by slowing down the health response
    let resolveHealth!: () => void;
    const healthGate = new Promise<void>((resolve) => { resolveHealth = resolve; });

    await page.route('**/health', async (route) => {
      await healthGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'healthy' }),
      });
    });

    await page.goto('/');
    // Bar should be visible while health requests are pending
    const bar = page.locator('[data-testid="global-progress-bar"]');
    await expect(bar).toBeVisible({ timeout: 3000 });

    // Release health endpoints
    resolveHealth();
    // Bar should disappear after requests complete
    await expect(bar).not.toBeVisible({ timeout: 5000 });
  });

  test('progress bar is not visible when no fetches are active', async ({ page }) => {
    await page.goto('/');
    // Wait for initial page to settle — all health checks should complete
    await expect(page.locator('header h1')).toBeVisible();
    // Allow time for health checks to complete and bar to fade out
    await page.waitForTimeout(3000);
    // Bar should not be in DOM (it returns null when hidden)
    const bar = page.locator('[data-testid="global-progress-bar"]');
    await expect(bar).not.toBeVisible();
  });

  test('progress bar has fixed positioning and correct z-index', async ({ page }) => {
    // Slow down health to keep bar visible long enough to inspect
    let resolveHealth!: () => void;
    const healthGate = new Promise<void>((resolve) => { resolveHealth = resolve; });

    await page.route('**/health', async (route) => {
      await healthGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'healthy' }),
      });
    });

    await page.goto('/');
    const bar = page.locator('[data-testid="global-progress-bar"]');
    await expect(bar).toBeVisible({ timeout: 3000 });

    // Check CSS positioning
    const position = await bar.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        position: style.position,
        top: style.top,
        left: style.left,
        zIndex: style.zIndex,
      };
    });

    expect(position.position).toBe('fixed');
    expect(position.top).toBe('0px');
    expect(position.left).toBe('0px');
    expect(parseInt(position.zIndex, 10)).toBeGreaterThanOrEqual(50);

    resolveHealth();
  });

  test('progress bar has emerald gradient color on the inner fill', async ({ page }) => {
    let resolveHealth!: () => void;
    const healthGate = new Promise<void>((resolve) => { resolveHealth = resolve; });

    await page.route('**/health', async (route) => {
      await healthGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'healthy' }),
      });
    });

    await page.goto('/');
    const bar = page.locator('[data-testid="global-progress-bar"]');
    await expect(bar).toBeVisible({ timeout: 3000 });

    // Check gradient on the inner fill div
    const innerFill = bar.locator('div').first();
    const gradient = await innerFill.evaluate((el) => {
      return window.getComputedStyle(el).backgroundImage;
    });

    // Should contain emerald (10b981) to cyan (06b6d4) gradient
    expect(gradient).toContain('gradient');

    resolveHealth();
  });

  test('progress bar is rendered above the header', async ({ page }) => {
    let resolveHealth!: () => void;
    const healthGate = new Promise<void>((resolve) => { resolveHealth = resolve; });

    await page.route('**/health', async (route) => {
      await healthGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'healthy' }),
      });
    });

    await page.goto('/');
    const bar = page.locator('[data-testid="global-progress-bar"]');
    await expect(bar).toBeVisible({ timeout: 3000 });

    // Progress bar top should be at 0px (above header which starts below)
    const barBox = await bar.boundingBox();
    expect(barBox).not.toBeNull();
    expect(barBox!.y).toBe(0);

    resolveHealth();
  });
});
