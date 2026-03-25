/**
 * E2E tests for OrchestratorChat — markdown rendering in result bubbles
 * (Iteration 43)
 *
 * Covers:
 * 1. Result with markdown heading renders as h1/h2 inside [data-testid="markdown-content"]
 * 2. Result with fenced code block renders <pre><code> inside markdown content
 * 3. Result with bullet list renders <ul><li>
 * 4. Result with table renders <table>
 * 5. Result with bold renders <strong>
 * 6. Result with italic renders <em>
 * 7. Result starting with { renders in [data-testid="json-content"] (JSON fallback)
 * 8. Result starting with [ renders in [data-testid="json-content"] (JSON array fallback)
 * 9. markdown-content div is present for non-JSON results
 * 10. json-content pre is present for JSON results
 * 11. JSON fallback does NOT render markdown-content
 * 12. Markdown path does NOT render json-content
 * 13. Result with inline code renders <code>
 * 14. Existing result bubble features still work with markdown (copy button, task ID, timestamp)
 */

import { test, expect } from '@playwright/test';
import { isLiveMode, mockBaseRoutes, mockDispatch, GATEWAY } from './helpers';

/**
 * Dispatch a task via SSE and wait until the result bubble is visible.
 * Returns after the result message has been added to the chat.
 */
async function dispatchAndGetResult(
  page: import('@playwright/test').Page,
  taskId: string,
  resultText: string,
) {
  await mockDispatch(page, taskId);

  // Custom SSE body for each unique result text
  await page.route(`${GATEWAY}/tasks/${taskId}/stream`, (route) => {
    const sseBody = `data: ${JSON.stringify({ type: 'result', result: resultText })}\n\n`;
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: sseBody,
    });
  });

  // Fill message and send (using default "task_orchestration" capability)
  await page.locator('[data-testid="message-input"]').fill('test message');
  await page.locator('button', { hasText: 'Send' }).click();

  // Wait for the result bubble to appear — look for the "Result" label
  await expect(page.locator('span.text-emerald-400').filter({ hasText: 'Result' }).first()).toBeVisible({
    timeout: 10_000,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('OrchestratorChat — markdown rendering in result bubbles (Iteration 43)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isLiveMode, 'Markdown content assertions require mock SSE — live mode returns real agent responses');
    await mockBaseRoutes(page, { agents: [], kubexes: [] });
    await page.goto('/chat');
  });

  // ── Markdown rendering path ────────────────────────────────────────────────

  test('result with markdown h1 heading renders <h1> inside markdown-content', async ({ page }) => {
    await dispatchAndGetResult(page, 'md-h1', '# Hello World\n\nThis is a heading.');
    const md = page.locator('[data-testid="markdown-content"]');
    await expect(md).toBeVisible();
    await expect(md.locator('h1')).toBeVisible();
    await expect(md.locator('h1')).toContainText('Hello World');
  });

  test('result with markdown h2 heading renders <h2> inside markdown-content', async ({ page }) => {
    await dispatchAndGetResult(page, 'md-h2', '## Section Title\n\nSome content here.');
    const md = page.locator('[data-testid="markdown-content"]');
    await expect(md.locator('h2')).toBeVisible();
    await expect(md.locator('h2')).toContainText('Section Title');
  });

  test('result with fenced code block renders <pre><code> inside markdown-content', async ({ page }) => {
    const content = '```javascript\nconsole.log("hello");\n```';
    await dispatchAndGetResult(page, 'md-code', content);
    const md = page.locator('[data-testid="markdown-content"]');
    await expect(md).toBeVisible();
    await expect(md.locator('pre')).toBeVisible();
    await expect(md.locator('pre code')).toBeVisible();
  });

  test('result with bullet list renders <ul> and <li> inside markdown-content', async ({ page }) => {
    const content = '- Item one\n- Item two\n- Item three';
    await dispatchAndGetResult(page, 'md-list', content);
    const md = page.locator('[data-testid="markdown-content"]');
    await expect(md.locator('ul')).toBeVisible();
    await expect(md.locator('ul li').first()).toBeVisible();
    await expect(md.locator('ul li').first()).toContainText('Item one');
  });

  test('result with GFM table renders <table> inside markdown-content', async ({ page }) => {
    const content = '| Name | Value |\n| ---- | ----- |\n| foo  | bar   |\n| baz  | qux   |';
    await dispatchAndGetResult(page, 'md-table', content);
    const md = page.locator('[data-testid="markdown-content"]');
    await expect(md.locator('table')).toBeVisible();
    await expect(md.locator('table th').first()).toContainText('Name');
    await expect(md.locator('table td').first()).toContainText('foo');
  });

  test('result with bold text renders <strong> inside markdown-content', async ({ page }) => {
    await dispatchAndGetResult(page, 'md-bold', 'This is **bold text** here.');
    const md = page.locator('[data-testid="markdown-content"]');
    await expect(md.locator('strong')).toBeVisible();
    await expect(md.locator('strong')).toContainText('bold text');
  });

  test('result with italic text renders <em> inside markdown-content', async ({ page }) => {
    await dispatchAndGetResult(page, 'md-italic', 'This is _italic text_ here.');
    const md = page.locator('[data-testid="markdown-content"]');
    await expect(md.locator('em')).toBeVisible();
    await expect(md.locator('em')).toContainText('italic text');
  });

  test('result with inline code renders <code> inside markdown-content', async ({ page }) => {
    await dispatchAndGetResult(page, 'md-inline-code', 'Use the `console.log()` function.');
    const md = page.locator('[data-testid="markdown-content"]');
    await expect(md.locator('code')).toBeVisible();
    await expect(md.locator('code').first()).toContainText('console.log()');
  });

  test('markdown-content div is present for non-JSON results', async ({ page }) => {
    await dispatchAndGetResult(page, 'md-present', 'This is a plain text result without JSON.');
    await expect(page.locator('[data-testid="markdown-content"]')).toBeVisible();
  });

  test('markdown path does NOT render json-content pre', async ({ page }) => {
    await dispatchAndGetResult(page, 'md-no-json', 'This is plain text, not JSON.');
    await expect(page.locator('[data-testid="json-content"]')).not.toBeVisible();
  });

  // ── JSON fallback path ────────────────────────────────────────────────────

  test('result starting with { renders in json-content (JSON object fallback)', async ({ page }) => {
    const jsonResult = '{\n  "status": "ok",\n  "value": 42\n}';
    await dispatchAndGetResult(page, 'json-obj', jsonResult);
    await expect(page.locator('[data-testid="json-content"]')).toBeVisible();
    await expect(page.locator('[data-testid="json-content"]')).toContainText('"status"');
  });

  test('result starting with [ renders in json-content (JSON array fallback)', async ({ page }) => {
    const jsonResult = '[\n  "item1",\n  "item2"\n]';
    await dispatchAndGetResult(page, 'json-arr', jsonResult);
    await expect(page.locator('[data-testid="json-content"]')).toBeVisible();
    await expect(page.locator('[data-testid="json-content"]')).toContainText('item1');
  });

  test('json-content pre is present for JSON object results', async ({ page }) => {
    const jsonResult = '{ "key": "value" }';
    await dispatchAndGetResult(page, 'json-pre', jsonResult);
    await expect(page.locator('[data-testid="json-content"]')).toBeVisible();
  });

  test('JSON fallback does NOT render markdown-content div', async ({ page }) => {
    const jsonResult = '{ "result": "data" }';
    await dispatchAndGetResult(page, 'json-no-md', jsonResult);
    await expect(page.locator('[data-testid="markdown-content"]')).not.toBeVisible();
  });

  test('result starting with whitespace then { is treated as JSON', async ({ page }) => {
    const jsonResult = '  { "trimmed": true }';
    await dispatchAndGetResult(page, 'json-trimmed', jsonResult);
    await expect(page.locator('[data-testid="json-content"]')).toBeVisible();
    await expect(page.locator('[data-testid="markdown-content"]')).not.toBeVisible();
  });

  // ── Existing bubble features preserved ────────────────────────────────────

  test('copy result button is present on markdown result bubble', async ({ page }) => {
    await dispatchAndGetResult(page, 'md-copy', '## Copyable Result\n\nSome content.');
    await expect(page.locator('[data-testid="copy-result-content"]')).toBeVisible();
  });

  test('task ID is shown on markdown result bubble', async ({ page }) => {
    await dispatchAndGetResult(page, 'md-taskid', '## Result with task ID\n\nDetails here.');
    await expect(page.locator('[data-testid="result-task-id"]')).toBeVisible();
    await expect(page.locator('[data-testid="result-task-id"]')).toContainText('md-taskid');
  });

  test('timestamp is shown on markdown result bubble', async ({ page }) => {
    await dispatchAndGetResult(page, 'md-ts', '## Result with timestamp\n\nDetails here.');
    await expect(page.locator('[data-testid="chat-bubble-timestamp"]').last()).toBeVisible();
  });

  test('copy result button is present on JSON fallback result bubble', async ({ page }) => {
    await dispatchAndGetResult(page, 'json-copy', '{"copy": "me"}');
    await expect(page.locator('[data-testid="copy-result-content"]')).toBeVisible();
  });
});
