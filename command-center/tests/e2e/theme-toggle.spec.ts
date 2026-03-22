import { test, expect } from '@playwright/test';

/**
 * Iteration 22: Dark/Light theme toggle
 *
 * Tests that the ThemeToggle button is present in the top bar, correctly
 * toggles between dark and light mode, persists the preference to
 * localStorage, and applies the `data-theme` attribute to <html>.
 */
test.describe('Theme Toggle', () => {

  test.beforeEach(async ({ page }) => {
    // Clear any saved theme preference so tests start in dark mode
    await page.addInitScript(() => {
      localStorage.removeItem('kubex-theme');
    });
    await page.goto('/');
  });

  // ── Presence ─────────────────────────────────────────────────────────

  test('theme toggle button is visible in the top bar', async ({ page }) => {
    await expect(page.getByTestId('theme-toggle')).toBeVisible();
  });

  test('theme toggle has correct aria-label in dark mode', async ({ page }) => {
    const btn = page.getByTestId('theme-toggle');
    await expect(btn).toHaveAttribute('aria-label', 'Switch to light theme');
  });

  test('theme toggle has aria-pressed=false in dark mode', async ({ page }) => {
    const btn = page.getByTestId('theme-toggle');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  // ── Toggle to light mode ──────────────────────────────────────────────

  test('clicking the toggle switches to light mode', async ({ page }) => {
    await page.getByTestId('theme-toggle').click();
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');
  });

  test('aria-label updates to "Switch to dark theme" after switching to light', async ({ page }) => {
    await page.getByTestId('theme-toggle').click();
    const btn = page.getByTestId('theme-toggle');
    await expect(btn).toHaveAttribute('aria-label', 'Switch to dark theme');
  });

  test('aria-pressed becomes true in light mode', async ({ page }) => {
    await page.getByTestId('theme-toggle').click();
    const btn = page.getByTestId('theme-toggle');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  // ── Toggle back to dark mode ──────────────────────────────────────────

  test('clicking toggle twice restores dark mode', async ({ page }) => {
    const btn = page.getByTestId('theme-toggle');
    await btn.click();
    await btn.click();
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-theme');
  });

  test('aria-label returns to "Switch to light theme" after toggling back', async ({ page }) => {
    const btn = page.getByTestId('theme-toggle');
    await btn.click();
    await btn.click();
    await expect(btn).toHaveAttribute('aria-label', 'Switch to light theme');
  });

  // ── Persistence ───────────────────────────────────────────────────────

  test('light mode preference is persisted in localStorage', async ({ page }) => {
    await page.getByTestId('theme-toggle').click();
    const stored = await page.evaluate(() => localStorage.getItem('kubex-theme'));
    expect(stored).toBe('"light"');
  });

  test('dark mode preference is persisted in localStorage', async ({ page }) => {
    // Switch to light first, then back to dark
    const btn = page.getByTestId('theme-toggle');
    await btn.click();
    await btn.click();
    const stored = await page.evaluate(() => localStorage.getItem('kubex-theme'));
    expect(stored).toBe('"dark"');
  });

  test('saved light theme is applied on page reload', async ({ browser }) => {
    // Create a fresh context WITHOUT the initScript so localStorage persists
    const context = await browser.newContext();
    const freshPage = await context.newPage();
    // Navigate and switch to light theme
    await freshPage.goto('/');
    await freshPage.getByTestId('theme-toggle').click();
    await expect(freshPage.locator('html')).toHaveAttribute('data-theme', 'light');
    // Reload the page — localStorage should persist the preference
    await freshPage.reload();
    await expect(freshPage.locator('html')).toHaveAttribute('data-theme', 'light');
    await context.close();
  });

  // ── Cross-page persistence ────────────────────────────────────────────

  test('theme toggle is visible on Agents page', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.getByTestId('theme-toggle')).toBeVisible();
  });

  test('theme toggle is visible on Traffic page', async ({ page }) => {
    await page.goto('/traffic');
    await expect(page.getByTestId('theme-toggle')).toBeVisible();
  });

  test('light theme applies data-theme attribute on Agents page after SPA navigation', async ({ page }) => {
    // Switch to light, then use in-app navigation (not a full reload) — theme stays
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // Navigate within the SPA — no page reload, useTheme state persists
    await page.getByRole('button', { name: /agents/i }).first().click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  // ── Accessibility ─────────────────────────────────────────────────────

  test('theme toggle is keyboard focusable', async ({ page }) => {
    const btn = page.getByTestId('theme-toggle');
    await btn.focus();
    await expect(btn).toBeFocused();
  });

  test('theme toggle can be activated with Enter key', async ({ page }) => {
    const btn = page.getByTestId('theme-toggle');
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  // ── Dark mode default ────────────────────────────────────────────────

  test('no data-theme attribute in dark mode (CSS :root variables apply)', async ({ page }) => {
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-theme');
  });
});
