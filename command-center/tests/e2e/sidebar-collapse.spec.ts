import { test, expect } from '@playwright/test';

test.describe('Collapsible Sidebar — icon-only mode', () => {
  test.beforeEach(async ({ page }) => {
    // Clear sidebar collapse state before each test to ensure default (expanded) state
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('kubex-sidebar-collapsed'));
    await page.reload();
    await expect(page.locator('header h1')).toBeVisible();
  });

  // ── Presence ─────────────────────────────────────────────────────────────

  test('collapse toggle button is present in the sidebar', async ({ page }) => {
    await expect(page.getByTestId('sidebar-collapse-toggle')).toBeVisible();
  });

  test('sidebar container has data-testid="sidebar"', async ({ page }) => {
    await expect(page.getByTestId('sidebar')).toBeVisible();
  });

  // ── Default state (expanded) ──────────────────────────────────────────────

  test('sidebar starts expanded by default (data-collapsed="false")', async ({ page }) => {
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
  });

  test('expanded sidebar has normal width (> 150px)', async ({ page }) => {
    const sidebar = page.getByTestId('sidebar');
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(150);
  });

  // ── Collapse interaction ──────────────────────────────────────────────────

  test('clicking toggle collapses the sidebar (data-collapsed="true")', async ({ page }) => {
    const toggle = page.getByTestId('sidebar-collapse-toggle');
    await toggle.click();
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  });

  test('collapsed sidebar has reduced width (< 80px)', async ({ page }) => {
    const toggle = page.getByTestId('sidebar-collapse-toggle');
    await toggle.click();

    // Wait for CSS transition to complete
    await page.waitForTimeout(300);

    const sidebar = page.getByTestId('sidebar');
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThan(80);
  });

  test('clicking toggle again expands the sidebar', async ({ page }) => {
    const toggle = page.getByTestId('sidebar-collapse-toggle');

    // Collapse
    await toggle.click();
    await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');

    // Expand
    await toggle.click();
    await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'false');

    // Wait for transition
    await page.waitForTimeout(300);

    const box = await page.getByTestId('sidebar').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(150);
  });

  // ── Toggle icon changes ───────────────────────────────────────────────────

  test('toggle button shows « when expanded (click to collapse)', async ({ page }) => {
    const toggle = page.getByTestId('sidebar-collapse-toggle');
    const text = await toggle.textContent();
    expect(text).toContain('«');
  });

  test('toggle button shows » when collapsed (click to expand)', async ({ page }) => {
    const toggle = page.getByTestId('sidebar-collapse-toggle');
    await toggle.click();
    const text = await toggle.textContent();
    expect(text).toContain('»');
  });

  // ── Navigation in collapsed mode ──────────────────────────────────────────

  test('nav links still navigate correctly when sidebar is collapsed', async ({ page }) => {
    // Collapse the sidebar
    const toggle = page.getByTestId('sidebar-collapse-toggle');
    await toggle.click();
    await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');

    // Find and click the Agents nav button (by aria-label)
    const agentsBtn = page.locator('[aria-label*="Agents"]').first();
    await agentsBtn.click();

    // Should navigate to /agents
    await expect(page).toHaveURL(/\/agents/);
  });

  // ── Title tooltips in collapsed mode ─────────────────────────────────────

  test('nav items have title attributes when sidebar is collapsed', async ({ page }) => {
    // Collapse the sidebar
    const toggle = page.getByTestId('sidebar-collapse-toggle');
    await toggle.click();
    await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');

    // All nav buttons inside the sidebar should have a title attribute
    const navButtons = page.locator('[data-testid="sidebar"] nav button');
    const count = await navButtons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const titleAttr = await navButtons.nth(i).getAttribute('title');
      expect(titleAttr).toBeTruthy();
    }
  });

  // ── localStorage persistence ──────────────────────────────────────────────

  test('collapse state persists after page reload', async ({ page }) => {
    // Set collapsed state directly in localStorage, then reload
    await page.evaluate(() => {
      localStorage.setItem('kubex-sidebar-collapsed', 'true');
    });
    await page.reload();
    await expect(page.locator('header h1')).toBeVisible();

    // Sidebar should be collapsed after reload
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  });

  test('expand state persists after page reload', async ({ page }) => {
    // Ensure expanded
    await page.evaluate(() => {
      localStorage.setItem('kubex-sidebar-collapsed', 'false');
    });
    await page.reload();
    await expect(page.locator('header h1')).toBeVisible();

    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
  });

  // ── Mobile behavior is unaffected ────────────────────────────────────────

  test('mobile hamburger is still present and mobile sidebar still works', async ({ page }) => {
    // Simulate mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('kubex-sidebar-collapsed'));
    await page.reload();

    // Hamburger should be visible
    const hamburger = page.getByTestId('sidebar-hamburger');
    await expect(hamburger).toBeVisible();

    // Open mobile sidebar
    await hamburger.click();
    const backdrop = page.getByTestId('sidebar-backdrop');
    await expect(backdrop).toBeVisible();
  });
});
