/**
 * E2E tests for Iteration 74 — Dark/light Mermaid theme
 *
 * Verifies that MermaidBlock reacts to the application theme toggle:
 * - In dark mode (default) the diagram renders with data-mermaid-theme="dark"
 * - After toggling to light mode the diagram re-renders with data-mermaid-theme="light"
 * - Toggling back to dark mode restores data-mermaid-theme="dark"
 * - The SVG is still present after each theme switch
 * - data-mermaid-theme is on the mermaid-diagram container
 */

import { test, expect } from '@playwright/test';
import { mockBaseRoutes, mockDispatch, GATEWAY } from './helpers';

/** Dispatch a task and wait for a mermaid result bubble. */
async function dispatchMermaidResult(page: import('@playwright/test').Page, taskId: string) {
  const mermaidContent = '```mermaid\ngraph TD\n  A[Start] --> B[End]\n```';

  await mockDispatch(page, taskId);

  await page.route(`${GATEWAY}/tasks/${taskId}/stream`, (route) => {
    const sseBody = `data: ${JSON.stringify({ type: 'result', result: mermaidContent })}\n\n`;
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: sseBody,
    });
  });

  await page.locator('[data-testid="message-input"]').fill('show diagram');
  await page.locator('button', { hasText: 'Send' }).click();

  // Wait for result bubble
  await expect(
    page.locator('span.text-emerald-400').filter({ hasText: 'Result' }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Wait for mermaid diagram to render
  await expect(
    page.locator('[data-testid="mermaid-diagram"]').first(),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe('MermaidBlock — theme-aware rendering (Iteration 74)', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page, { agents: [], kubexes: [] });
    // Start in dark mode (clear any saved light preference)
    await page.addInitScript(() => {
      localStorage.setItem('kubex-theme', 'dark');
    });
    await page.goto('/chat');
  });

  test('mermaid diagram renders with dark theme by default', async ({ page }) => {
    await dispatchMermaidResult(page, 'mermaid-theme-dark-default');

    const diagram = page.locator('[data-testid="mermaid-diagram"]').first();
    await expect(diagram).toBeVisible({ timeout: 10_000 });
    await expect(diagram).toHaveAttribute('data-mermaid-theme', 'dark');
  });

  test('mermaid diagram contains an SVG in dark mode', async ({ page }) => {
    await dispatchMermaidResult(page, 'mermaid-theme-dark-svg');

    const diagram = page.locator('[data-testid="mermaid-diagram"]').first();
    await expect(diagram.locator('svg')).toBeVisible({ timeout: 10_000 });
    await expect(diagram).toHaveAttribute('data-mermaid-theme', 'dark');
  });

  test('switching to light mode re-renders diagram with light theme', async ({ page }) => {
    await dispatchMermaidResult(page, 'mermaid-theme-switch-light');

    const diagram = page.locator('[data-testid="mermaid-diagram"]').first();
    await expect(diagram).toBeVisible({ timeout: 10_000 });

    // Confirm starts in dark
    await expect(diagram).toHaveAttribute('data-mermaid-theme', 'dark');

    // Toggle to light theme
    const themeBtn = page.locator('[data-testid="theme-toggle"]');
    await themeBtn.click();

    // Diagram should re-render with light theme
    await expect(diagram).toHaveAttribute('data-mermaid-theme', 'light', { timeout: 8_000 });
  });

  test('SVG is still present after switching to light theme', async ({ page }) => {
    await dispatchMermaidResult(page, 'mermaid-theme-svg-light');

    const diagram = page.locator('[data-testid="mermaid-diagram"]').first();
    await expect(diagram).toBeVisible({ timeout: 10_000 });

    // Toggle to light
    await page.locator('[data-testid="theme-toggle"]').click();
    await expect(diagram).toHaveAttribute('data-mermaid-theme', 'light', { timeout: 8_000 });

    // SVG should still be present
    await expect(diagram.locator('svg')).toBeVisible({ timeout: 8_000 });
  });

  test('toggling back to dark mode re-renders diagram with dark theme', async ({ page }) => {
    await dispatchMermaidResult(page, 'mermaid-theme-round-trip');

    const diagram = page.locator('[data-testid="mermaid-diagram"]').first();
    await expect(diagram).toBeVisible({ timeout: 10_000 });

    const themeBtn = page.locator('[data-testid="theme-toggle"]');

    // Dark → Light
    await themeBtn.click();
    await expect(diagram).toHaveAttribute('data-mermaid-theme', 'light', { timeout: 8_000 });

    // Light → Dark
    await themeBtn.click();
    await expect(diagram).toHaveAttribute('data-mermaid-theme', 'dark', { timeout: 8_000 });
  });

  test('data-mermaid-theme attribute is on the mermaid-diagram container', async ({ page }) => {
    await dispatchMermaidResult(page, 'mermaid-theme-attr-loc');

    const container = page.locator('[data-testid="mermaid-diagram"]').first();
    await expect(container).toBeVisible({ timeout: 10_000 });

    // The attribute should be on the container div, not a child
    const attr = await container.getAttribute('data-mermaid-theme');
    expect(attr).toBe('dark');
  });

  test('switching to light before dispatching renders diagram in light theme', async ({ page }) => {
    // Toggle to light BEFORE dispatching a diagram — verifies that MermaidBlock
    // initialises with the correct theme when the app is already in light mode.
    const themeBtn = page.locator('[data-testid="theme-toggle"]');
    await themeBtn.click();

    // Verify the HTML root reflects light mode
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await dispatchMermaidResult(page, 'mermaid-theme-light-before-dispatch');

    const diagram = page.locator('[data-testid="mermaid-diagram"]').first();
    await expect(diagram).toBeVisible({ timeout: 10_000 });
    await expect(diagram).toHaveAttribute('data-mermaid-theme', 'light', { timeout: 8_000 });
  });

  test('theme toggle button is visible on the chat page', async ({ page }) => {
    await expect(page.locator('[data-testid="theme-toggle"]')).toBeVisible();
  });
});
