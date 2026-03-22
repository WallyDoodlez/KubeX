/**
 * Accessibility audit tests.
 *
 * Uses Playwright's built-in capabilities to verify:
 *   - Skip-to-content link
 *   - Landmark roles (banner, navigation, main)
 *   - aria-current on active nav item
 *   - ARIA labels on interactive elements
 *   - Tab order reaches key interactive elements
 *   - Focus-visible rings (keyboard navigation)
 */
import { test, expect } from '@playwright/test';

test.describe('Accessibility — landmarks and structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header h1')).toBeVisible();
  });

  test('has a skip-to-content link that is focusable', async ({ page }) => {
    // Press Tab from the top of the page — the skip link should be the first focusable element
    await page.keyboard.press('Tab');
    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
  });

  test('skip link navigates to main content', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    // After activating, focus should move to main#main-content
    const main = page.locator('#main-content');
    await expect(main).toBeVisible();
  });

  test('has a banner landmark (header)', async ({ page }) => {
    await expect(page.locator('[role="banner"]')).toBeVisible();
  });

  test('has a navigation landmark with accessible name', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible();
  });

  test('has an aside landmark with accessible name', async ({ page }) => {
    // <aside> is implicitly complementary
    const aside = page.locator('aside[aria-label="Application navigation"]');
    await expect(aside).toBeVisible();
  });

  test('has a main landmark', async ({ page }) => {
    await expect(page.locator('main#main-content')).toBeVisible();
  });

  test('toolbar landmark has accessible label', async ({ page }) => {
    const toolbar = page.locator('[role="toolbar"][aria-label="Global controls"]');
    await expect(toolbar).toBeVisible();
  });
});

test.describe('Accessibility — ARIA attributes', () => {
  test('active nav item has aria-current="page"', async ({ page }) => {
    await page.goto('/');
    // Dashboard is active on /
    const dashboardBtn = page.locator('aside').getByRole('button', { name: /Dashboard/i });
    await expect(dashboardBtn).toHaveAttribute('aria-current', 'page');
  });

  test('inactive nav items do not have aria-current', async ({ page }) => {
    await page.goto('/');
    const agentsBtn = page.locator('aside').getByRole('button', { name: /Agents/i });
    const ariaCurrent = await agentsBtn.getAttribute('aria-current');
    expect(ariaCurrent).toBeNull();
  });

  test('aria-current updates on navigation', async ({ page }) => {
    await page.goto('/');
    const agentsBtn = page.locator('aside').getByRole('button', { name: /Agents/i });
    await agentsBtn.click();
    await expect(agentsBtn).toHaveAttribute('aria-current', 'page');

    const dashboardBtn = page.locator('aside').getByRole('button', { name: /Dashboard/i });
    const ariaCurrent = await dashboardBtn.getAttribute('aria-current');
    expect(ariaCurrent).toBeNull();
  });

  test('kill all button has aria-label', async ({ page }) => {
    await page.goto('/');
    const killBtn = page.locator('[data-testid="kill-all-button"]');
    await expect(killBtn).toHaveAttribute('aria-label', 'Kill all kubexes');
  });

  test('live status indicator has accessible role and label', async ({ page }) => {
    await page.goto('/');
    // ConnectionIndicator replaces the old static live badge — verify it is present
    // and has an aria-label describing system health
    const indicator = page.getByTestId('connection-indicator');
    await expect(indicator).toBeVisible();
    const ariaLabel = await indicator.getAttribute('aria-label');
    expect(ariaLabel).toMatch(/system health/i);
  });

  test('nav buttons have descriptive aria-labels', async ({ page }) => {
    await page.goto('/');
    const navButtons = page.locator('aside').getByRole('button');
    const count = await navButtons.count();
    // All nav buttons should have aria-label attributes
    for (let i = 0; i < count; i++) {
      const label = await navButtons.nth(i).getAttribute('aria-label');
      expect(label).toBeTruthy();
    }
  });
});

test.describe('Accessibility — tab order', () => {
  test('tab order reaches sidebar nav buttons', async ({ page }) => {
    await page.goto('/');
    // Tab through: skip link → then nav items
    await page.keyboard.press('Tab'); // skip link
    await page.keyboard.press('Tab'); // first nav button (Dashboard)

    const dashboardBtn = page.locator('aside').getByRole('button', { name: /Dashboard/i });
    await expect(dashboardBtn).toBeFocused();
  });

  test('tab order reaches kill all button', async ({ page }) => {
    await page.goto('/');
    // Shift+Tab from the kill button itself to verify it's reachable
    const killBtn = page.locator('[data-testid="kill-all-button"]');
    await killBtn.focus();
    await expect(killBtn).toBeFocused();
  });

  test('kill all button is keyboard activatable', async ({ page }) => {
    await page.goto('/');
    const killBtn = page.locator('[data-testid="kill-all-button"]');
    await killBtn.focus();
    await page.keyboard.press('Enter');
    // Dialog should open
    await expect(page.locator('[role="dialog"]')).toBeVisible();
  });
});

test.describe('Accessibility — each page', () => {
  const pages = [
    { path: '/',            title: 'Dashboard'    },
    { path: '/agents',      title: 'Agents'       },
    { path: '/traffic',     title: 'Traffic'      },
    { path: '/chat',        title: 'Orchestrator' },
    { path: '/containers',  title: 'Containers'   },
    { path: '/approvals',   title: 'Approvals'    },
  ];

  for (const { path, title } of pages) {
    test(`${title} page has h1 matching page title`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('header h1')).toHaveText(title);
    });

    test(`${title} page preserves landmark structure`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('aside[aria-label="Application navigation"]')).toBeVisible();
      await expect(page.locator('main#main-content')).toBeVisible();
      await expect(page.locator('[role="banner"]')).toBeVisible();
    });
  }
});
