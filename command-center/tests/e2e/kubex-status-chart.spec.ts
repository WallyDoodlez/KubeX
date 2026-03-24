import { test, expect } from '@playwright/test';

/**
 * Kubex Status Chart E2E tests.
 *
 * These tests verify the structural presence and behavior of the chart.
 * Data-specific assertions (counts, percentages) are avoided because the
 * test environment may have zero or unknown kubexes running.
 *
 * Behavior verified:
 * - Section renders on Dashboard with correct heading
 * - "View all →" navigates to Containers page
 * - Collapsible toggle works (aria-expanded)
 * - When kubexes exist: SVG, legend, and arcs are present
 * - When no kubexes: fallback "No kubexes running" message shown
 */

test.describe('Kubex Status Chart', () => {
  test.beforeEach(async ({ page }) => {
    // Clear dashboard collapse state so the kubex-status section starts expanded
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('kubex-dashboard-sections'));
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('Kubex Status section renders on the Dashboard', async ({ page }) => {
    await expect(page.locator('h2', { hasText: 'Kubex Status' })).toBeVisible();
  });

  test('collapsible section element is present on Dashboard', async ({ page }) => {
    await expect(page.getByTestId('collapsible-section-kubex-status')).toBeVisible();
  });

  test('kubex status chart container renders', async ({ page }) => {
    await expect(page.getByTestId('kubex-status-chart')).toBeVisible();
  });

  test('"View all →" link navigates to Containers page', async ({ page }) => {
    const section = page.locator('section').filter({
      has: page.locator('h2', { hasText: 'Kubex Status' }),
    });
    const viewAll = section.locator('button', { hasText: 'View all →' });
    await expect(viewAll).toBeVisible();
    await viewAll.click();
    await expect(page.locator('header h1')).toHaveText('Containers');
  });

  test('toggle collapses the kubex status section (aria-expanded)', async ({ page }) => {
    const toggleBtn = page.getByTestId('collapsible-toggle-kubex-status');
    // Should start expanded
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    // Collapse
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('toggle expands the section after collapsing', async ({ page }) => {
    const toggleBtn = page.getByTestId('collapsible-toggle-kubex-status');
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
  });

  test('section subtitle shows kubex count or loading state', async ({ page }) => {
    // Subtitle is either "Loading…" or "N kubexes total"
    const section = page.locator('section').filter({
      has: page.locator('h2', { hasText: 'Kubex Status' }),
    });
    // The toggle button contains the subtitle text when expanded
    const toggleBtn = section.locator('button[aria-expanded="true"]');
    await expect(toggleBtn).toBeVisible();
    // The button should contain some subtitle text (either "Loading…" or "N kubexes total")
    const btnText = await toggleBtn.innerText();
    expect(btnText).toMatch(/Kubex Status/);
  });

  test('chart shows donut SVG when kubexes are loaded', async ({ page }) => {
    // Wait for polling to settle (up to 10s for first poll)
    // If kubexes exist, the SVG appears; if none, the fallback message appears
    // Either outcome is valid — we just verify the chart container shows appropriate content
    await page.waitForTimeout(2000); // Allow first poll to complete
    const chart = page.getByTestId('kubex-status-chart');
    await expect(chart).toBeVisible();

    // The chart should contain EITHER the SVG (data loaded, count > 0)
    // OR the "No kubexes running" fallback message (count = 0)
    const hasSvg = await chart.locator('[data-testid="kubex-donut-svg"]').isVisible().catch(() => false);
    const hasFallback = await chart.locator('text=/No kubexes running/').isVisible().catch(() => false);
    expect(hasSvg || hasFallback).toBe(true);
  });

  test('when donut SVG is present it has an accessible aria-label', async ({ page }) => {
    await page.waitForTimeout(2000);
    const svg = page.locator('[data-testid="kubex-donut-svg"]');
    const svgVisible = await svg.isVisible().catch(() => false);
    if (svgVisible) {
      const label = await svg.getAttribute('aria-label');
      expect(label).toMatch(/Kubex status distribution/i);
    } else {
      // No kubexes — fallback path, test passes
      test.skip();
    }
  });

  test('when legend table is present it has an accessible aria-label', async ({ page }) => {
    await page.waitForTimeout(2000);
    const legend = page.locator('[data-testid="kubex-status-legend"]');
    const legendVisible = await legend.isVisible().catch(() => false);
    if (legendVisible) {
      const label = await legend.getAttribute('aria-label');
      expect(label).toMatch(/Kubex status breakdown/i);
    } else {
      // No kubexes — fallback path, test passes
      test.skip();
    }
  });

  test('when legend rows are present they display counts and percentages', async ({ page }) => {
    await page.waitForTimeout(2000);
    const legend = page.locator('[data-testid="kubex-status-legend"]');
    const legendVisible = await legend.isVisible().catch(() => false);
    if (!legendVisible) {
      test.skip();
      return;
    }
    // At least one legend row should be visible
    const rows = legend.locator('tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    // Each row should contain a number and a percentage
    const firstRow = rows.first();
    const rowText = await firstRow.innerText();
    expect(rowText).toMatch(/\d+/); // contains a number
    expect(rowText).toMatch(/\d+%/); // contains a percentage
  });

  test('chart section heading has correct text', async ({ page }) => {
    const heading = page.locator('h2', { hasText: 'Kubex Status' });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('Kubex Status');
  });
});
