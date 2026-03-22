/**
 * Responsive layout tests — Iteration 19: collapsible sidebar.
 *
 * Mobile (< 768 px): sidebar is hidden by default; hamburger opens it.
 * ≥ 768 px: sidebar is always visible in flow.
 */
import { test, expect } from '@playwright/test';

const VIEWPORTS = {
  mobile:  { width: 375,  height: 812  }, // iPhone 14
  tablet:  { width: 768,  height: 1024 }, // iPad (md breakpoint boundary)
  laptop:  { width: 1280, height: 800  }, // Standard laptop
  desktop: { width: 1920, height: 1080 }, // Full HD
};

// ── Sidebar visibility at rest ──────────────────────────────────────
test.describe('Responsive — sidebar visibility at rest', () => {
  test('sidebar is visible at laptop width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.laptop);
    await page.goto('/');
    const sidebar = page.locator('[data-testid="sidebar"]');
    await expect(sidebar).toBeVisible();
  });

  test('sidebar is visible at desktop width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/');
    const sidebar = page.locator('[data-testid="sidebar"]');
    await expect(sidebar).toBeVisible();
  });

  test('sidebar is visible at tablet width (≥ 768 px)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet);
    await page.goto('/');
    const sidebar = page.locator('[data-testid="sidebar"]');
    await expect(sidebar).toBeVisible();
  });

  test('sidebar is off-screen (closed) at mobile width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');
    const sidebar = page.locator('[data-testid="sidebar"]');
    // The sidebar element exists in the DOM but is translated off-screen
    await expect(sidebar).toBeAttached();
    // It should NOT be in the visible viewport (translateX(-100%))
    const box = await sidebar.boundingBox();
    // Either bounding box is null or the right edge is ≤ 0
    if (box) {
      expect(box.x + box.width).toBeLessThanOrEqual(0);
    }
  });

  test('hamburger button is visible on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');
    await expect(page.locator('[data-testid="sidebar-hamburger"]')).toBeVisible();
  });

  test('hamburger button is not visible on laptop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.laptop);
    await page.goto('/');
    // hidden via md:hidden — should not be visible
    await expect(page.locator('[data-testid="sidebar-hamburger"]')).not.toBeVisible();
  });
});

// ── Mobile sidebar open / close ──────────────────────────────────────
test.describe('Responsive — mobile sidebar toggle', () => {
  test('hamburger opens sidebar on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    const sidebar = page.locator('[data-testid="sidebar"]');
    const hamburger = page.locator('[data-testid="sidebar-hamburger"]');

    // Sidebar starts closed (translated off-screen)
    let box = await sidebar.boundingBox();
    if (box) expect(box.x + box.width).toBeLessThanOrEqual(0);

    // Tap hamburger
    await hamburger.click();
    await page.waitForTimeout(350); // allow CSS transition

    // Now sidebar should be visible (translateX(0))
    box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.x).toBeGreaterThanOrEqual(0);
  });

  test('close button inside sidebar closes it on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    await page.locator('[data-testid="sidebar-hamburger"]').click();
    await page.waitForTimeout(350);

    // Sidebar should be open
    const sidebar = page.locator('[data-testid="sidebar"]');
    let box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.x).toBeGreaterThanOrEqual(0);

    // Click the ✕ close button inside the sidebar
    await page.locator('[data-testid="sidebar-close"]').click();
    await page.waitForTimeout(350);

    box = await sidebar.boundingBox();
    if (box) expect(box.x + box.width).toBeLessThanOrEqual(0);
  });

  test('backdrop appears when sidebar is open on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    await expect(page.locator('[data-testid="sidebar-backdrop"]')).not.toBeAttached();

    await page.locator('[data-testid="sidebar-hamburger"]').click();
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid="sidebar-backdrop"]')).toBeAttached();
  });

  test('tapping backdrop closes sidebar on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    await page.locator('[data-testid="sidebar-hamburger"]').click();
    await page.waitForTimeout(350);

    // Verify sidebar is open
    const sidebar = page.locator('[data-testid="sidebar"]');
    let box = await sidebar.boundingBox();
    if (box) expect(box.x).toBeGreaterThanOrEqual(0);

    // Click backdrop in the area to the right of the sidebar (outside w-56 = 224 px)
    // The backdrop covers the full screen but the sidebar overlaps the left portion,
    // so we click at the right side of the viewport where the backdrop is unobstructed.
    await page.mouse.click(VIEWPORTS.mobile.width - 20, VIEWPORTS.mobile.height / 2);
    await page.waitForTimeout(350);

    box = await sidebar.boundingBox();
    if (box) expect(box.x + box.width).toBeLessThanOrEqual(0);
  });

  test('navigating via sidebar closes it on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    await page.locator('[data-testid="sidebar-hamburger"]').click();
    await page.waitForTimeout(350);

    // Click Agents in the open sidebar
    await page.locator('[data-testid="sidebar"]').getByText('Agents', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Agents');
    await page.waitForTimeout(350);

    // Sidebar should be closed again
    const sidebar = page.locator('[data-testid="sidebar"]');
    const box = await sidebar.boundingBox();
    if (box) expect(box.x + box.width).toBeLessThanOrEqual(0);
  });

  test('hamburger aria-expanded reflects open state', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    const hamburger = page.locator('[data-testid="sidebar-hamburger"]');
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');

    await hamburger.click();
    await page.waitForTimeout(200);
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
  });
});

// ── Main content area ────────────────────────────────────────────────
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

  test('kill all button remains visible at mobile width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');
    await expect(page.locator('[data-testid="kill-all-button"]')).toBeVisible();
  });

  test('kill all button remains visible at tablet width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet);
    await page.goto('/');
    await expect(page.locator('[data-testid="kill-all-button"]')).toBeVisible();
  });
});

// ── Navigation at various widths ────────────────────────────────────
test.describe('Responsive — navigation at various widths', () => {
  test('nav links are functional at laptop width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.laptop);
    await page.goto('/');

    await page.locator('[data-testid="sidebar"]').getByText('Agents', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Agents');

    await page.locator('[data-testid="sidebar"]').getByText('Dashboard', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('nav links are functional at desktop width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/');

    await page.locator('[data-testid="sidebar"]').getByText('Agents', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Agents');

    await page.locator('[data-testid="sidebar"]').getByText('Dashboard', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('nav links are functional at tablet width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet);
    await page.goto('/');

    await page.locator('[data-testid="sidebar"]').getByText('Agents', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Agents');

    await page.locator('[data-testid="sidebar"]').getByText('Dashboard', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('nav links accessible on mobile (via hamburger)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    // Open sidebar first
    await page.locator('[data-testid="sidebar-hamburger"]').click();
    await page.waitForTimeout(350);

    await page.locator('[data-testid="sidebar"]').getByText('Agents', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Agents');
  });
});

// ── Layout structure ────────────────────────────────────────────────
test.describe('Responsive — layout structure', () => {
  test('sidebar and main content are side-by-side at desktop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/');

    const sidebar = page.locator('[data-testid="sidebar"]');
    const main    = page.locator('main#main-content');

    const asideBox = await sidebar.boundingBox();
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

  test('live indicator is visible on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');
    await expect(page.locator('[role="status"][aria-label="Connection status: live"]')).toBeVisible();
  });

  test('main content fills available width on mobile (no sidebar offset)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');
    const main = page.locator('main#main-content');
    const box = await main.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // Main should start at or near x=0 on mobile (sidebar is off-screen)
      expect(box.x).toBeLessThanOrEqual(10);
      // Main should fill most of the viewport width
      expect(box.width).toBeGreaterThan(300);
    }
  });
});
