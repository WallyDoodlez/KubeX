/**
 * E2E tests for MermaidBlock — mermaid diagram rendering in result bubbles
 * (Iteration 45)
 *
 * Covers:
 * 1. Result with valid mermaid code block renders an SVG (data-testid="mermaid-diagram" is visible, contains <svg>)
 * 2. Result with invalid mermaid falls back to code block (data-testid="mermaid-fallback" is visible)
 * 3. Mermaid diagram SVG has width/height attributes or viewBox
 * 4. Mermaid fallback shows the raw code text
 * 5. Regular (non-mermaid) code blocks still render normally alongside mermaid blocks
 * 6. mermaid-diagram container has overflow-x-auto class
 */

import { test, expect } from '@playwright/test';
import { mockBaseRoutes, mockDispatch, GATEWAY } from './helpers';

/**
 * Dispatch a task via SSE and wait until the result bubble is visible.
 */
async function dispatchAndGetResult(
  page: import('@playwright/test').Page,
  taskId: string,
  resultText: string,
) {
  await mockDispatch(page, taskId);

  await page.route(`${GATEWAY}/tasks/${taskId}/stream`, (route) => {
    const sseBody = `data: ${JSON.stringify({ type: 'result', result: resultText })}\n\n`;
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: sseBody,
    });
  });

  await page.locator('[data-testid="message-input"]').fill('test mermaid');
  await page.locator('button', { hasText: 'Send' }).click();

  // Wait for the result bubble to appear
  await expect(page.locator('span.text-emerald-400').filter({ hasText: 'Result' }).first()).toBeVisible({
    timeout: 10_000,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('OrchestratorChat — Mermaid diagram rendering in result bubbles (Iteration 45)', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page, { agents: [], kubexes: [] });
    await page.goto('/chat');
  });

  test('valid mermaid code block renders mermaid-diagram container', async ({ page }) => {
    const content = '```mermaid\ngraph TD\n  A-->B\n```';
    await dispatchAndGetResult(page, 'mermaid-valid-1', content);
    const md = page.locator('[data-testid="markdown-content"]');
    await expect(md).toBeVisible();
    // Give mermaid async render extra time
    await expect(md.locator('[data-testid="mermaid-diagram"]')).toBeVisible({ timeout: 10_000 });
  });

  test('valid mermaid diagram container contains an <svg> element', async ({ page }) => {
    const content = '```mermaid\ngraph TD\n  A[Start] --> B[End]\n```';
    await dispatchAndGetResult(page, 'mermaid-svg-1', content);
    const md = page.locator('[data-testid="markdown-content"]');
    await expect(md).toBeVisible();
    const diagramContainer = md.locator('[data-testid="mermaid-diagram"]');
    await expect(diagramContainer).toBeVisible({ timeout: 10_000 });
    await expect(diagramContainer.locator('svg')).toBeVisible({ timeout: 10_000 });
  });

  test('invalid mermaid shows mermaid-fallback instead of diagram', async ({ page }) => {
    const content = '```mermaid\ninvalid diagram syntax!!!\n```';
    await dispatchAndGetResult(page, 'mermaid-invalid-1', content);
    const md = page.locator('[data-testid="markdown-content"]');
    await expect(md).toBeVisible();
    // Fallback should appear after error is detected
    await expect(md.locator('[data-testid="mermaid-fallback"]')).toBeVisible({ timeout: 10_000 });
  });

  test('mermaid fallback shows the raw code text', async ({ page }) => {
    const content = '```mermaid\ninvalid diagram syntax!!!\n```';
    await dispatchAndGetResult(page, 'mermaid-fallback-text', content);
    const md = page.locator('[data-testid="markdown-content"]');
    await expect(md).toBeVisible();
    const fallback = md.locator('[data-testid="mermaid-fallback"]');
    await expect(fallback).toBeVisible({ timeout: 10_000 });
    await expect(fallback.locator('code')).toContainText('invalid diagram syntax!!!');
  });

  test('mermaid diagram SVG has viewBox or width attribute', async ({ page }) => {
    const content = '```mermaid\ngraph LR\n  X --> Y --> Z\n```';
    await dispatchAndGetResult(page, 'mermaid-attrs', content);
    const md = page.locator('[data-testid="markdown-content"]');
    const diagramContainer = md.locator('[data-testid="mermaid-diagram"]');
    await expect(diagramContainer).toBeVisible({ timeout: 10_000 });
    const svg = diagramContainer.locator('svg');
    await expect(svg).toBeVisible({ timeout: 10_000 });

    // SVG should have viewBox or width
    const viewBox = await svg.getAttribute('viewBox');
    const width = await svg.getAttribute('width');
    const hasAttr = (viewBox !== null && viewBox !== '') || (width !== null && width !== '');
    expect(hasAttr).toBe(true);
  });

  test('mermaid-diagram container has overflow-x-auto class', async ({ page }) => {
    const content = '```mermaid\ngraph TD\n  A-->B\n```';
    await dispatchAndGetResult(page, 'mermaid-overflow', content);
    const md = page.locator('[data-testid="markdown-content"]');
    const diagramContainer = md.locator('[data-testid="mermaid-diagram"]');
    await expect(diagramContainer).toBeVisible({ timeout: 10_000 });
    await expect(diagramContainer).toHaveClass(/overflow-x-auto/);
  });

  test('non-mermaid code blocks still render as <pre><code> alongside mermaid', async ({ page }) => {
    const content = '```mermaid\ngraph TD\n  A-->B\n```\n\nSome text\n\n```javascript\nconsole.log("hello");\n```';
    await dispatchAndGetResult(page, 'mermaid-and-code', content);
    const md = page.locator('[data-testid="markdown-content"]');
    await expect(md).toBeVisible();
    // Mermaid diagram should render
    await expect(md.locator('[data-testid="mermaid-diagram"]')).toBeVisible({ timeout: 10_000 });
    // Regular code block should also render (use first() since mermaid may inject internal <pre> elements)
    await expect(md.locator('pre').first()).toBeVisible();
    await expect(md.locator('pre code').first()).toBeVisible();
  });
});
