/**
 * Responsive layout tests.
 *
 * Verifies sidebar and layout behaviour at different viewport widths.
 * The current implementation keeps the sidebar visible at all sizes
 * (no responsive collapse has been implemented yet), so these tests
 * document the current behaviour and serve as a regression baseline.
 */
import { test, expect } from '@playwright/test';

const VIEWPORTS = {
  mobile:  { width: 375,  height: 812  }, // iPhone 14
  tablet:  { width: 768,  height: 1024 }, // iPad
  laptop:  { width: 1280, height: 800  }, // Standard laptop
  desktop: { width: 1920, height: 1080 }, // Full HD
};

test.describe('Responsive — sidebar visibility', () => {
  test('sidebar is visible at laptop width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.laptop);
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible();
  });

  test('sidebar is visible at desktop width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible();
  });

  test('sidebar is visible at tablet width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet);
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible();
  });

  test('sidebar is visible at mobile width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible();
  });
});

test.describe('Responsive — main content area', () => {
  test('main content is visible at all widths', async ({ page }) => {
    for (const [, size] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(size);
      await page.goto('/');
      await expect(page.locator('main#main-content')).toBeVisible();
    }
  });

  test('header h1 is visible at tablet width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet);
    await page.goto('/');
    await expect(page.locator('header h1')).toBeVisible();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('header h1 is visible at mobile width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');
    await expect(page.locator('header h1')).toBeVisible();
  });

  test('kill all button remains visible at tablet width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet);
    await page.goto('/');
    await expect(page.locator('[data-testid="kill-all-button"]')).toBeVisible();
  });
});

test.describe('Responsive — navigation at various widths', () => {
  for (const [name, size] of Object.entries(VIEWPORTS)) {
    test(`nav links are functional at ${name} (${size.width}px)`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/');

      // Click Agents nav item
      await page.locator('aside').getByText('Agents', { exact: true }).click();
      await expect(page.locator('header h1')).toHaveText('Agents');

      // Navigate back to Dashboard
      await page.locator('aside').getByText('Dashboard', { exact: true }).click();
      await expect(page.locator('header h1')).toHaveText('Dashboard');
    });
  }
});

test.describe('Responsive — layout structure', () => {
  test('sidebar and main content are side-by-side at desktop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/');

    const aside = page.locator('aside');
    const main  = page.locator('main#main-content');

    const asideBox = await aside.boundingBox();
    const mainBox  = await main.boundingBox();

    expect(asideBox).not.toBeNull();
    expect(mainBox).not.toBeNull();

    if (asideBox && mainBox) {
      // Sidebar is to the left of main content
      expect(asideBox.x).toBeLessThan(mainBox.x);
      // They are on approximately the same vertical start
      expect(Math.abs(asideBox.y - mainBox.y)).toBeLessThan(5);
    }
  });

  test('brand logo is visible at laptop width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.laptop);
    await page.goto('/');
    await expect(page.locator('text=KubexClaw')).toBeVisible();
  });

  test('live indicator is visible at all common widths', async ({ page }) => {
    for (const [, size] of [
      ['tablet', VIEWPORTS.tablet],
      ['laptop', VIEWPORTS.laptop],
      ['desktop', VIEWPORTS.desktop],
    ] as [string, typeof VIEWPORTS.laptop][]) {
      await page.setViewportSize(size);
      await page.goto('/');
      await expect(page.locator('[role="status"][aria-label="Connection status: live"]')).toBeVisible();
    }
  });
});
