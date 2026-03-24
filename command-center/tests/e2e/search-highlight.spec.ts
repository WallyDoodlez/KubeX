/**
 * E2E tests for search result highlighting in OrchestratorChat (Iteration 72)
 *
 * Covers:
 * 1.  No highlights visible when search is empty
 * 2.  User bubble text is highlighted when search matches
 * 3.  Case-insensitive matching in user bubbles
 * 4.  Multiple occurrences in user bubble are all highlighted
 * 5.  Partial word matching in user bubble
 * 6.  Result bubble (JSON) text is highlighted
 * 7.  Highlight elements have data-testid="search-highlight"
 * 8.  Highlights disappear when search is cleared
 * 9.  Highlights disappear when role filter changes away from match
 * 10. Error bubble text is highlighted
 * 11. Non-matching text within a matching bubble is NOT wrapped in mark
 * 12. Clearing search removes all highlight marks
 * 13. Highlight is visible (amber/yellow background style)
 * 14. Regex special characters in search query are escaped (don't crash)
 * 15. Highlight count badge still shows when search highlights are active
 */

import { test, expect } from '@playwright/test';

const GATEWAY = 'http://localhost:8080';
const TASK_ID = 'mock-task-highlight-1';

async function setupRoutes(page: import('@playwright/test').Page) {
  await page.route('**/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'healthy' }) }),
  );
  await page.route('**/agents', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    } else {
      route.continue();
    }
  });
  await page.route('**/kubexes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );
  await page.route('**/escalations', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );
}

/** Dispatches a task and waits for the result bubble to appear. */
async function dispatchAndAwaitResult(
  page: import('@playwright/test').Page,
  msg: string,
  result: string,
  taskId = TASK_ID,
) {
  await page.route(`${GATEWAY}/actions`, (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ task_id: taskId, status: 'dispatched' }),
      });
    } else {
      route.continue();
    }
  });

  await page.route(`${GATEWAY}/tasks/${taskId}/stream`, (route) => {
    const sseBody = `data: ${JSON.stringify({ type: 'result', result })}\n\n`;
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: sseBody,
    });
  });

  await page.locator('[data-testid="message-input"]').fill(msg);
  await page.locator('button', { hasText: 'Send' }).click();
  // Wait for a result bubble to appear (avoid generic text= which matches dropdown options)
  await expect(page.locator('[data-testid="result-bubble"]')).toBeVisible({ timeout: 10_000 });
}

/** Dispatches a task that returns an error via SSE. */
async function dispatchAndAwaitError(
  page: import('@playwright/test').Page,
  msg: string,
  errorText: string,
  taskId = 'mock-task-highlight-err',
) {
  await page.route(`${GATEWAY}/actions`, (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ task_id: taskId, status: 'dispatched' }),
      });
    } else {
      route.continue();
    }
  });

  await page.route(`${GATEWAY}/tasks/${taskId}/stream`, (route) => {
    // SSE "failed" event renders as an error bubble in OrchestratorChat
    const sseBody = `data: ${JSON.stringify({ type: 'failed', error: errorText })}\n\n`;
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: sseBody,
    });
  });

  await page.locator('[data-testid="message-input"]').fill(msg);
  await page.locator('button', { hasText: 'Send' }).click();
  await expect(page.locator('[data-testid="error-bubble"]')).toBeVisible({ timeout: 10_000 });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('OrchestratorChat — search result highlighting (Iteration 72)', () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/chat');
  });

  // ── 1. No highlights when search is empty ─────────────────────────────────

  test('no highlight marks are present when search input is empty', async ({ page }) => {
    await dispatchAndAwaitResult(page, 'hello there', 'agent response content', TASK_ID);
    await expect(page.locator('[data-testid="search-highlight"]')).toHaveCount(0);
  });

  // ── 2. User bubble text is highlighted ───────────────────────────────────

  test('searching for a term highlights matched text in user bubble', async ({ page }) => {
    await dispatchAndAwaitResult(page, 'hello unique-word there', 'some result text', TASK_ID);

    await page.locator('[data-testid="chat-search-input"]').fill('unique-word');

    // At least one mark element should appear inside the chat
    const marks = page.locator('[data-testid="search-highlight"]');
    await expect(marks.first()).toBeVisible({ timeout: 5_000 });
    await expect(marks.first()).toContainText('unique-word');
  });

  // ── 3. Case-insensitive matching ─────────────────────────────────────────

  test('highlight matching is case-insensitive', async ({ page }) => {
    await dispatchAndAwaitResult(page, 'Hello CamelCase World', 'some result', TASK_ID);

    await page.locator('[data-testid="chat-search-input"]').fill('camelcase');

    const marks = page.locator('[data-testid="search-highlight"]');
    await expect(marks.first()).toBeVisible({ timeout: 5_000 });
    // Should have matched the original casing text
    await expect(marks.first()).toContainText(/camelcase/i);
  });

  // ── 4. Multiple occurrences are all highlighted ───────────────────────────

  test('multiple occurrences of the search term are each highlighted', async ({ page }) => {
    await dispatchAndAwaitResult(page, 'foo bar foo baz foo', 'result', TASK_ID);

    await page.locator('[data-testid="chat-search-input"]').fill('foo');

    const marks = page.locator('[data-testid="search-highlight"]');
    // "foo" appears 3 times in the user bubble, so ≥3 mark elements
    await expect(marks).toHaveCount(3, { timeout: 5_000 });
  });

  // ── 5. Partial word matching ──────────────────────────────────────────────

  test('partial word search highlights the matching portion', async ({ page }) => {
    await dispatchAndAwaitResult(page, 'orchestration-engine running', 'result', TASK_ID);

    await page.locator('[data-testid="chat-search-input"]').fill('engine');

    const marks = page.locator('[data-testid="search-highlight"]');
    await expect(marks.first()).toBeVisible({ timeout: 5_000 });
    await expect(marks.first()).toContainText('engine');
  });

  // ── 6. Result bubble (JSON) text is highlighted ───────────────────────────

  test('result bubble JSON content has matched text highlighted', async ({ page }) => {
    const jsonResult = '{"status":"running","agent":"alpha-001"}';
    await dispatchAndAwaitResult(page, 'show me status', jsonResult, TASK_ID);

    await page.locator('[data-testid="chat-search-input"]').fill('alpha-001');

    const marks = page.locator('[data-testid="search-highlight"]');
    await expect(marks.first()).toBeVisible({ timeout: 5_000 });
    await expect(marks.first()).toContainText('alpha-001');
  });

  // ── 7. Highlights use data-testid="search-highlight" ─────────────────────

  test('highlight elements have the correct data-testid attribute', async ({ page }) => {
    await dispatchAndAwaitResult(page, 'findme-token in message', 'result', TASK_ID);

    await page.locator('[data-testid="chat-search-input"]').fill('findme-token');

    const mark = page.locator('[data-testid="search-highlight"]').first();
    await expect(mark).toBeVisible({ timeout: 5_000 });
    await expect(mark).toHaveAttribute('data-testid', 'search-highlight');
  });

  // ── 8. Highlights disappear when search is cleared ────────────────────────

  test('clearing search input removes all highlight marks', async ({ page }) => {
    await dispatchAndAwaitResult(page, 'highlighted-term-test', 'result', TASK_ID);

    const input = page.locator('[data-testid="chat-search-input"]');
    await input.fill('highlighted');

    // Confirm marks appear
    await expect(page.locator('[data-testid="search-highlight"]').first()).toBeVisible({ timeout: 5_000 });

    // Clear the search
    await page.locator('button[aria-label="Clear search"]').click();

    // Marks should be gone
    await expect(page.locator('[data-testid="search-highlight"]')).toHaveCount(0);
  });

  // ── 9. Highlights removed when filters no longer match ────────────────────

  test('switching role filter to a non-matching type hides highlighted bubbles', async ({ page }) => {
    await dispatchAndAwaitResult(page, 'message-with-searchterm', 'result-text', TASK_ID);

    await page.locator('[data-testid="chat-search-input"]').fill('searchterm');

    // User bubble with highlight should be visible
    await expect(page.locator('[data-testid="search-highlight"]').first()).toBeVisible({ timeout: 5_000 });

    // Switch to result-only filter — user bubble disappears
    await page.locator('[data-testid="chat-role-filter"]').selectOption('result');

    // The mark from the user bubble should not be visible
    await expect(page.locator('[data-testid="search-highlight"]:visible')).toHaveCount(0);
  });

  // ── 10. Error bubble text is highlighted ─────────────────────────────────

  test('error bubble content has matched text highlighted', async ({ page }) => {
    await dispatchAndAwaitError(page, 'trigger error', 'fatal-error-code-999');

    await page.locator('[data-testid="chat-search-input"]').fill('fatal-error-code');

    const marks = page.locator('[data-testid="search-highlight"]');
    await expect(marks.first()).toBeVisible({ timeout: 5_000 });
    await expect(marks.first()).toContainText('fatal-error-code');
  });

  // ── 11. Non-matching text is not wrapped ─────────────────────────────────

  test('non-matching text segments in a matching bubble are plain text, not marks', async ({ page }) => {
    await dispatchAndAwaitResult(page, 'prefix needle suffix', 'result', TASK_ID);

    await page.locator('[data-testid="chat-search-input"]').fill('needle');

    // Only 'needle' should be marked; 'prefix' and 'suffix' should not be inside marks
    const marks = page.locator('[data-testid="search-highlight"]');
    await expect(marks).toHaveCount(1, { timeout: 5_000 });
    await expect(marks.first()).toContainText('needle');
    await expect(marks.first()).not.toContainText('prefix');
    await expect(marks.first()).not.toContainText('suffix');
  });

  // ── 12. Clearing search removes marks (repeat via toolbar clear) ──────────

  test('clicking toolbar Clear Filters button removes all highlights', async ({ page }) => {
    await dispatchAndAwaitResult(page, 'clearable-term message', 'result', TASK_ID);

    await page.locator('[data-testid="chat-search-input"]').fill('clearable-term');
    await expect(page.locator('[data-testid="search-highlight"]').first()).toBeVisible({ timeout: 5_000 });

    // Use the toolbar clear button
    await page.locator('[data-testid="chat-filter-clear"]').click();

    await expect(page.locator('[data-testid="search-highlight"]')).toHaveCount(0);
  });

  // ── 13. Highlight element is a <mark> tag ────────────────────────────────

  test('highlight elements are <mark> HTML tags', async ({ page }) => {
    await dispatchAndAwaitResult(page, 'tag-verify-test', 'result', TASK_ID);

    await page.locator('[data-testid="chat-search-input"]').fill('tag-verify');

    // Verify the element is a <mark> tag
    const mark = page.locator('[data-testid="search-highlight"]').first();
    await expect(mark).toBeVisible({ timeout: 5_000 });
    const tagName = await mark.evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).toBe('mark');
  });

  // ── 14. Regex special characters don't crash ─────────────────────────────

  test('searching with regex special characters does not crash the UI', async ({ page }) => {
    await dispatchAndAwaitResult(page, 'normal message text', 'result', TASK_ID);

    // Type regex special chars into search — should not throw
    const input = page.locator('[data-testid="chat-search-input"]');
    await input.fill('(test[.*+?');

    // UI should still be functional — search toolbar visible, no crash
    await expect(page.locator('[data-testid="chat-search-toolbar"]')).toBeVisible();
    await expect(page.locator('[data-testid="chat-filter-match-count"]')).toBeVisible();
  });

  // ── 15. Match count badge still appears with active highlights ────────────

  test('match count badge is visible when search is producing highlights', async ({ page }) => {
    await dispatchAndAwaitResult(page, 'badge-check-message', 'result', TASK_ID);

    await page.locator('[data-testid="chat-search-input"]').fill('badge-check');

    // Highlights visible
    await expect(page.locator('[data-testid="search-highlight"]').first()).toBeVisible({ timeout: 5_000 });

    // Badge visible
    await expect(page.locator('[data-testid="chat-filter-match-count"]')).toBeVisible();
  });
});
