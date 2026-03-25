import { test, expect } from '@playwright/test';
import { mockBaseRoutes } from './helpers';

/**
 * Responsive layout tests for the Traffic Log page.
 *
 * Three breakpoints are tested:
 *   - Mobile  : 375 × 812  (< 768px  — md breakpoint)
 *   - Tablet  : 900 × 1024 (768px–1023px — md to lg)
 *   - Desktop : 1280 × 800 (≥ 1024px — lg+)
 */

const MOBILE_VIEWPORT  = { width: 375,  height: 812  };
const TABLET_VIEWPORT  = { width: 900,  height: 1024 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800  };

test.describe('Traffic Log — responsive layout', () => {
  test.describe('Mobile (<768px)', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(MOBILE_VIEWPORT);
      await mockBaseRoutes(page);
      await page.goto('/traffic');
      await expect(page.locator('header h1')).toHaveText('Traffic');
    });

    test('renders page header and title', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'Traffic / Actions Log' })).toBeVisible();
    });

    test('hides legend dots on mobile', async ({ page }) => {
      // Legend dots are wrapped in a hidden sm:flex span — should not be visible
      const legendWrapper = page.locator('span.hidden.sm\\:flex');
      await expect(legendWrapper).toBeHidden();
    });

    test('filter bar is accessible on mobile', async ({ page }) => {
      // Status select should be visible and usable
      const statusSelect = page.locator('select').first();
      await expect(statusSelect).toBeVisible();

      // Search input should be visible
      await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
    });

    test('filter bar wraps correctly on narrow screen', async ({ page }) => {
      // All filter controls should be present in the DOM (flex-wrap handles overflow)
      const filterBar = page.locator('.flex.items-center.gap-3.mb-4.flex-wrap');
      await expect(filterBar).toBeVisible();
    });

    test('shows empty state when no traffic entries', async ({ page }) => {
      await expect(page.getByText('No traffic yet')).toBeVisible();
    });

    test('export menu is accessible on mobile', async ({ page }) => {
      const exportMenu = page.getByTestId('traffic-export-menu');
      await expect(exportMenu).toBeVisible();
    });
  });

  test.describe('Tablet (768px–1023px)', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(TABLET_VIEWPORT);
      await mockBaseRoutes(page);
      await page.goto('/traffic');
      await expect(page.locator('header h1')).toHaveText('Traffic');
    });

    test('renders page header and title', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'Traffic / Actions Log' })).toBeVisible();
    });

    test('filter bar is fully visible on tablet', async ({ page }) => {
      await expect(page.locator('select').first()).toBeVisible();
      await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
    });

    test('legend dots are visible at tablet width (sm+)', async ({ page }) => {
      // sm breakpoint is 640px — tablet (900px) is above sm, so legend should show
      const legendWrapper = page.locator('span.hidden.sm\\:flex');
      await expect(legendWrapper).toBeVisible();
    });

    test('shows empty state when no traffic entries', async ({ page }) => {
      await expect(page.getByText('No traffic yet')).toBeVisible();
    });
  });

  test.describe('Desktop (≥1024px)', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await mockBaseRoutes(page);
      await page.goto('/traffic');
      await expect(page.locator('header h1')).toHaveText('Traffic');
    });

    test('renders page header and title', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'Traffic / Actions Log' })).toBeVisible();
    });

    test('filter bar is fully visible on desktop', async ({ page }) => {
      await expect(page.locator('select').first()).toBeVisible();
      await expect(page.locator('select').nth(1)).toBeVisible();
      await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
    });

    test('legend dots are visible on desktop', async ({ page }) => {
      await expect(page.getByText('allowed', { exact: true })).toBeVisible();
      await expect(page.getByText('denied',  { exact: true })).toBeVisible();
      await expect(page.getByText('escalated', { exact: true })).toBeVisible();
      await expect(page.getByText('pending', { exact: true })).toBeVisible();
    });

    test('shows empty state when no traffic entries', async ({ page }) => {
      await expect(page.getByText('No traffic yet')).toBeVisible();
    });

    test('export menu is accessible on desktop', async ({ page }) => {
      const exportMenu = page.getByTestId('traffic-export-menu');
      await expect(exportMenu).toBeVisible();
    });
  });

  test.describe('Viewport resize transitions', () => {
    test('page remains functional when resized from desktop to mobile', async ({ page }) => {
      await mockBaseRoutes(page);
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto('/traffic');
      await expect(page.getByRole('heading', { name: 'Traffic / Actions Log' })).toBeVisible();

      // Shrink to mobile
      await page.setViewportSize(MOBILE_VIEWPORT);
      // Page header still present
      await expect(page.getByRole('heading', { name: 'Traffic / Actions Log' })).toBeVisible();
      // Filter bar still functional
      await expect(page.locator('select').first()).toBeVisible();
      await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
    });

    test('page remains functional when resized from mobile to desktop', async ({ page }) => {
      await mockBaseRoutes(page);
      await page.setViewportSize(MOBILE_VIEWPORT);
      await page.goto('/traffic');
      await expect(page.getByRole('heading', { name: 'Traffic / Actions Log' })).toBeVisible();

      // Expand to desktop
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await expect(page.getByRole('heading', { name: 'Traffic / Actions Log' })).toBeVisible();
      // Legend dots should now be visible
      await expect(page.getByText('allowed', { exact: true })).toBeVisible();
    });
  });
});
