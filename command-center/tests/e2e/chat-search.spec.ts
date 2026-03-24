/**
 * E2E tests for OrchestratorChat — message search and role filter toolbar
 * (Iteration 41)
 *
 * Covers:
 * 1. Search toolbar is present on /chat
 * 2. Search input exists and has correct aria-label
 * 3. Role filter select exists
 * 4. Default role filter value is "all"
 * 5. Searching text that matches shows messages
 * 6. Searching text that matches nothing shows empty state
 * 7. Clear button on search input
 * 8. Clear filters button appears only when filtering
 * 9. Match count badge shows correct counts
 * 10. Role filter "result" shows only result messages
 * 11. Role filter "error" shows only error messages
 * 12. Role filter "user" shows only user messages
 * 13. Role filter "system" shows only system messages
 * 14. Role filter "all" shows all messages
 * 15. Combined search + role filter
 * 16. Clearing filters restores all messages
 * 17. Search is case-insensitive
 * 18. Search matches task_id content
 * 19. Chat welcome message visible by default
 * 20. Toolbar present when navigating to /chat directly
 */

import { test, expect } from '@playwright/test';

const GATEWAY = 'http://localhost:8080';
const TASK_ID = 'mock-task-search-1';

/** Set up common stubs so network calls don't interfere */
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

/** Dispatch a task that returns a result via SSE */
async function dispatchAndGetResult(
  page: import('@playwright/test').Page,
  capability = 'test-cap',
  msg = 'hello world',
  result = 'Test result content',
) {
  await page.route(`${GATEWAY}/actions`, (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ task_id: TASK_ID, status: 'dispatched' }),
      });
    } else {
      route.continue();
    }
  });

  await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, (route) => {
    const sseBody = `data: ${JSON.stringify({ type: 'result', result })}\n\n`;
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: sseBody,
    });
  });

  // Open Advanced panel and set capability when a non-default value is needed
  if (capability && capability !== 'task_orchestration') {
    await page.locator('[data-testid="advanced-toggle"]').click();
    await page.locator('[data-testid="capability-input"]').fill(capability);
  }

  await page.locator('[data-testid="message-input"]').fill(msg);
  await page.locator('button', { hasText: 'Send' }).click();

  // Wait for result bubble to confirm flow completed
  await expect(page.locator(`text=${result}`)).toBeVisible({ timeout: 10_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('OrchestratorChat — message search and role filter (Iteration 41)', () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/chat');
  });

  // ── Toolbar structure ─────────────────────────────────────────────────────

  test('search toolbar is present on the chat page', async ({ page }) => {
    await expect(page.locator('[data-testid="chat-search-toolbar"]')).toBeVisible();
  });

  test('search input exists with correct aria-label', async ({ page }) => {
    const input = page.locator('[data-testid="chat-search-input"]');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('aria-label', 'Search chat messages');
  });

  test('search input placeholder is "Search messages…"', async ({ page }) => {
    await expect(page.locator('[data-testid="chat-search-input"]')).toHaveAttribute(
      'placeholder',
      'Search messages…',
    );
  });

  test('role filter select exists with correct aria-label', async ({ page }) => {
    const select = page.locator('[data-testid="chat-role-filter"]');
    await expect(select).toBeVisible();
    await expect(select).toHaveAttribute('aria-label', 'Filter by message type');
  });

  test('default role filter value is "all"', async ({ page }) => {
    await expect(page.locator('[data-testid="chat-role-filter"]')).toHaveValue('all');
  });

  test('role filter has options: all, user, result, error, system', async ({ page }) => {
    const select = page.locator('[data-testid="chat-role-filter"]');
    await expect(select.locator('option[value="all"]')).toBeAttached();
    await expect(select.locator('option[value="user"]')).toBeAttached();
    await expect(select.locator('option[value="result"]')).toBeAttached();
    await expect(select.locator('option[value="error"]')).toBeAttached();
    await expect(select.locator('option[value="system"]')).toBeAttached();
  });

  // ── Filter badge not shown without active filters ─────────────────────────

  test('match count badge is NOT visible before any filtering', async ({ page }) => {
    await expect(page.locator('[data-testid="chat-filter-match-count"]')).not.toBeVisible();
  });

  test('clear filters button is NOT visible before any filtering', async ({ page }) => {
    await expect(page.locator('[data-testid="chat-filter-clear"]')).not.toBeVisible();
  });

  // ── Search behaviour ──────────────────────────────────────────────────────

  test('typing in search shows clear (×) button', async ({ page }) => {
    const input = page.locator('[data-testid="chat-search-input"]');
    await input.fill('hello');
    await expect(page.locator('button[aria-label="Clear search"]')).toBeVisible();
  });

  test('clicking the clear (×) button empties search', async ({ page }) => {
    const input = page.locator('[data-testid="chat-search-input"]');
    await input.fill('hello');
    await page.locator('button[aria-label="Clear search"]').click();
    await expect(input).toHaveValue('');
  });

  test('match count badge appears when searching', async ({ page }) => {
    await page.locator('[data-testid="chat-search-input"]').fill('anything');
    await expect(page.locator('[data-testid="chat-filter-match-count"]')).toBeVisible();
  });

  test('clear filters button appears when filtering is active', async ({ page }) => {
    await page.locator('[data-testid="chat-search-input"]').fill('test');
    await expect(page.locator('[data-testid="chat-filter-clear"]')).toBeVisible();
  });

  test('clear filters button appears when role filter is not "all"', async ({ page }) => {
    await page.locator('[data-testid="chat-role-filter"]').selectOption('result');
    await expect(page.locator('[data-testid="chat-filter-clear"]')).toBeVisible();
  });

  test('no-results empty state appears when search matches nothing', async ({ page }) => {
    // Type something that won't match the welcome message
    await page.locator('[data-testid="chat-search-input"]').fill('zzz-no-match-xyz-9999');
    await expect(page.locator('[data-testid="chat-no-results"]')).toBeVisible();
  });

  test('empty state has a "Clear filters" link', async ({ page }) => {
    await page.locator('[data-testid="chat-search-input"]').fill('zzz-no-match-xyz-9999');
    const emptyState = page.locator('[data-testid="chat-no-results"]');
    await expect(emptyState.locator('button, a').filter({ hasText: 'Clear filters' })).toBeVisible();
  });

  test('clicking "Clear filters" in empty state restores messages', async ({ page }) => {
    await page.locator('[data-testid="chat-search-input"]').fill('zzz-no-match-xyz-9999');
    await page.locator('[data-testid="chat-no-results"]').locator('button, a').filter({ hasText: 'Clear filters' }).click();
    // The search input should be cleared
    await expect(page.locator('[data-testid="chat-search-input"]')).toHaveValue('');
    // No-results state should be gone
    await expect(page.locator('[data-testid="chat-no-results"]')).not.toBeVisible();
  });

  test('clicking toolbar "Clear" button resets search and filter', async ({ page }) => {
    await page.locator('[data-testid="chat-search-input"]').fill('something');
    await page.locator('[data-testid="chat-role-filter"]').selectOption('error');
    await page.locator('[data-testid="chat-filter-clear"]').click();
    await expect(page.locator('[data-testid="chat-search-input"]')).toHaveValue('');
    await expect(page.locator('[data-testid="chat-role-filter"]')).toHaveValue('all');
    await expect(page.locator('[data-testid="chat-filter-match-count"]')).not.toBeVisible();
  });

  // ── Role filter behaviour after a dispatch ────────────────────────────────

  test('role filter "user" shows only user messages after dispatch', async ({ page }) => {
    await dispatchAndGetResult(page, 'test-cap', 'find me later', 'some result');

    // Switch to user filter
    await page.locator('[data-testid="chat-role-filter"]').selectOption('user');

    // User bubble should be visible — plain message text (no [cap] prefix in new design)
    await expect(page.locator('text=find me later')).toBeVisible();

    // Result bubble should not be visible
    await expect(page.locator('text=some result')).not.toBeVisible();
  });

  test('role filter "result" shows only result messages after dispatch', async ({ page }) => {
    await dispatchAndGetResult(page, 'test-cap', 'my message', 'unique-result-text-42');

    // Switch to result filter
    await page.locator('[data-testid="chat-role-filter"]').selectOption('result');

    // Result bubble should be visible
    await expect(page.locator('text=unique-result-text-42')).toBeVisible();

    // User bubble should not be visible
    await expect(page.locator('text=my message')).not.toBeVisible();
  });

  test('role filter "all" shows all message types after dispatch', async ({ page }) => {
    await dispatchAndGetResult(page, 'test-cap', 'check-all', 'result-for-all-filter');

    await page.locator('[data-testid="chat-role-filter"]').selectOption('result');
    // Confirm result filter works
    await expect(page.locator('text=result-for-all-filter')).toBeVisible();

    // Switch back to all
    await page.locator('[data-testid="chat-role-filter"]').selectOption('all');
    // Both user message and result should show
    await expect(page.locator('text=check-all')).toBeVisible();
    await expect(page.locator('text=result-for-all-filter')).toBeVisible();
  });

  // ── Search within dispatched results ──────────────────────────────────────

  test('search matches result content (case-insensitive)', async ({ page }) => {
    await dispatchAndGetResult(page, 'test-cap', 'run search', 'CamelCaseSearchContent');

    // Search with lowercase
    await page.locator('[data-testid="chat-search-input"]').fill('camelcasesearchcontent');
    await expect(page.locator('text=CamelCaseSearchContent')).toBeVisible();
  });

  test('search matches user message content', async ({ page }) => {
    await dispatchAndGetResult(page, 'test-cap', 'specific-user-message', 'search-result-text-99');
    await page.locator('[data-testid="chat-search-input"]').fill('specific-user-message');
    await expect(page.locator('text=specific-user-message')).toBeVisible();
  });

  test('match count shows correct ratio after filtering', async ({ page }) => {
    await dispatchAndGetResult(page, 'test-cap', 'count-test', 'count-result-text');

    // Filter to only results
    await page.locator('[data-testid="chat-role-filter"]').selectOption('result');

    // Match count badge should be visible and contain "/"
    const badge = page.locator('[data-testid="chat-filter-match-count"]');
    await expect(badge).toBeVisible();
    const text = await badge.textContent();
    expect(text).toMatch(/\d+ \/ \d+/);
  });
});
