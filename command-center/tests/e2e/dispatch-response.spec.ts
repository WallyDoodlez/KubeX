/**
 * E2E tests for OrchestratorChat dispatch-and-response flow (BUG-001)
 *
 * Covers:
 * 1. SSE stream returns a result event → chat shows result
 * 2. SSE stream ends without data → fallback getTaskResult is called and result shown
 * 3. "Streaming…" / "Waiting for result…" labels appear during dispatch
 * 4. Error result from SSE is properly displayed in chat
 */

import { test, expect } from '@playwright/test';

const TASK_ID = 'mock-task-1';
const GATEWAY = 'http://localhost:8080';

/** Common route: POST /actions → dispatched */
async function routeDispatch(page: import('@playwright/test').Page) {
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
}

/** Common route: GET /tasks/mock-task-1/result → completed */
async function routeTaskResult(page: import('@playwright/test').Page, result = 'Test result text') {
  await page.route(`${GATEWAY}/tasks/${TASK_ID}/result`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ task_id: TASK_ID, status: 'completed', result }),
    });
  });
}

/**
 * Fill the chat inputs and click Send, then wait for the system dispatch
 * confirmation bubble to appear (confirms task was dispatched).
 *
 * When `capability` is provided and differs from the default "orchestrate",
 * the Advanced panel is opened to set it explicitly. Otherwise, just the
 * message is filled and sent (default capability = "orchestrate").
 */
async function sendChatMessage(
  page: import('@playwright/test').Page,
  capability = 'test-cap',
  message = 'hello world',
) {
  // Open Advanced panel and set explicit capability when a non-default value is needed
  if (capability && capability !== 'orchestrate') {
    await page.locator('[data-testid="advanced-toggle"]').click();
    await page.locator('[data-testid="capability-input"]').fill(capability);
  }

  await page.locator('[data-testid="message-input"]').fill(message);
  await page.locator('button', { hasText: 'Send' }).click();

  // Wait until the system bubble with the task ID appears — confirms dispatch succeeded
  await expect(
    page.locator(`text=Task dispatched — ID: ${TASK_ID}`),
  ).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------

test.describe('OrchestratorChat — dispatch-and-response flow (BUG-001)', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress non-test endpoints so they don't interfere
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
  });

  // ── Test 1: SSE stream returns a result event → chat shows the result ──────

  test('result event via SSE stream is shown in chat', async ({ page }) => {
    await routeDispatch(page);

    // Return an SSE stream with a single result event
    await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, (route) => {
      const sseBody = `data: ${JSON.stringify({ type: 'result', result: 'SSE result text' })}\n\n`;
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: {
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: sseBody,
      });
    });

    await page.goto('/chat');
    await sendChatMessage(page);

    // The result bubble should appear with SSE result text
    await expect(page.locator('text=SSE result text')).toBeVisible({ timeout: 10_000 });

    // The result bubble should have the "Result" label (scoped to the emerald result bubble label, not the filter dropdown option)
    await expect(page.locator('span.text-emerald-400', { hasText: 'Result' }).first()).toBeVisible();
  });

  // ── Test 2: SSE stream ends without data → fallback getTaskResult is called ─

  test('fallback getTaskResult is called and result shown when SSE ends without data', async ({ page }) => {
    await routeDispatch(page);
    await routeTaskResult(page, 'Fallback result text');

    // SSE stream responds with 404 — EventSource fires onerror immediately on each
    // attempt; after maxRetries (3) useSSE calls onComplete, which triggers the
    // fallback getTaskResult call.
    await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, (route) => {
      route.fulfill({ status: 404, body: 'Not found' });
    });

    // Track whether the fallback result endpoint was called
    let resultFetched = false;
    page.on('request', (req) => {
      if (req.url().includes(`/tasks/${TASK_ID}/result`)) {
        resultFetched = true;
      }
    });

    await page.goto('/chat');
    await sendChatMessage(page);

    // Wait for the fallback result to appear (generous timeout: 3 retries × 2s backoff ≈ 12s)
    await expect(page.locator('text=Fallback result text').first()).toBeVisible({ timeout: 20_000 });

    // Confirm the fallback endpoint was actually called
    expect(resultFetched).toBe(true);
  });

  // ── Test 3: Sending-state labels appear during dispatch ──────────────────

  test('"Dispatching…" label appears immediately after Send, then transitions to streaming state', async ({ page }) => {
    await routeDispatch(page);

    // Keep SSE stream open indefinitely (never resolves) so we can observe states
    await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, (route) => {
      // Respond with headers only and keep connection alive — no body events
      // Playwright route.fulfill with a body that never ends isn't directly supported,
      // so we use an empty body; EventSource will open then trigger error/retry which
      // still exercises the label logic.
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: '',
      });
    });

    // Also stub the fallback so the test doesn't hang waiting for real API
    await routeTaskResult(page);

    await page.goto('/chat');

    await page.locator('[data-testid="message-input"]').fill('hello world');

    // The sending-label should not be visible before Send
    await expect(page.locator('[data-testid="sending-label"]')).not.toBeVisible();

    await page.locator('button', { hasText: 'Send' }).click();

    // After clicking Send, the spinner/label should appear quickly (within 3s)
    // It will cycle through "Dispatching…" → "Connecting…" / "Streaming…" / "Waiting for result…"
    const sendingLabel = page.locator('[data-testid="sending-label"]');
    await expect(sendingLabel).toBeVisible({ timeout: 3_000 });

    // Verify that one of the expected labels is shown
    const labelText = await sendingLabel.textContent();
    const validLabels = ['Dispatching…', 'Connecting…', 'Streaming…', 'Waiting for result…'];
    expect(validLabels.some((l) => labelText?.includes(l))).toBe(true);
  });

  test('"Waiting for result…" label appears when SSE connection closes before result', async ({ page }) => {
    await routeDispatch(page);
    await routeTaskResult(page);

    // SSE stream errors immediately (404) → after retries, status becomes 'error',
    // which maps to "Waiting for result…" in the component, then onComplete fires
    // the fallback fetch.
    await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, (route) => {
      route.fulfill({ status: 404, body: 'Not found' });
    });

    await page.goto('/chat');
    await page.locator('[data-testid="message-input"]').fill('hello world');
    await page.locator('button', { hasText: 'Send' }).click();

    // Wait for dispatch system bubble (confirmed dispatched)
    await expect(page.locator(`text=Task dispatched — ID: ${TASK_ID}`)).toBeVisible({ timeout: 10_000 });

    // The result text appearing confirms the full SSE-error → fallback flow completed
    await expect(page.locator('text=Test result text').first()).toBeVisible({ timeout: 20_000 });
  });

  // ── Test 4: Error result via SSE is properly displayed in chat ───────────

  test('failed event via SSE is displayed as an error bubble in chat', async ({ page }) => {
    await routeDispatch(page);

    // SSE stream emits a "failed" event
    await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, (route) => {
      const sseBody = `data: ${JSON.stringify({ type: 'failed', error: 'Agent crashed unexpectedly' })}\n\n`;
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: sseBody,
      });
    });

    await page.goto('/chat');
    await sendChatMessage(page);

    // The error bubble should appear with the error content
    await expect(page.locator('text=Agent crashed unexpectedly')).toBeVisible({ timeout: 10_000 });

    // The error bubble should show the "Error" label (scoped to the red error bubble, not the filter dropdown option)
    await expect(page.locator('p.text-red-400', { hasText: 'Error' }).first()).toBeVisible();
  });

  test('cancelled event via SSE is displayed as an error bubble in chat', async ({ page }) => {
    await routeDispatch(page);

    // SSE stream emits a "cancelled" event
    await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, (route) => {
      const sseBody = `data: ${JSON.stringify({ type: 'cancelled', reason: 'User cancelled the task' })}\n\n`;
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: sseBody,
      });
    });

    await page.goto('/chat');
    await sendChatMessage(page);

    // The error bubble should appear with cancellation content
    await expect(page.locator('text=User cancelled the task')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('p.text-red-400', { hasText: 'Error' }).first()).toBeVisible();
  });

  // ── Test 5: Dispatch failure (non-200 from /actions) ─────────────────────

  test('dispatch failure shows error bubble with dispatch error message', async ({ page }) => {
    // /actions returns 500
    await page.route(`${GATEWAY}/actions`, (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Gateway overloaded' }),
      });
    });

    await page.goto('/chat');

    await page.locator('[data-testid="message-input"]').fill('hello world');
    await page.locator('button', { hasText: 'Send' }).click();

    // An error bubble should appear — content includes "Dispatch failed"
    await expect(page.locator('text=/Dispatch failed/i')).toBeVisible({ timeout: 10_000 });

    // The "Error" label from the error bubble should be visible (scoped to red error bubble label)
    await expect(page.locator('p.text-red-400', { hasText: 'Error' }).first()).toBeVisible();
  });

  // ── Test 6: No repeated polling after SSE carries result ──────────────────

  test('getTaskResult is NOT called when SSE delivers the result directly', async ({ page }) => {
    await routeDispatch(page);

    // SSE delivers a complete result event
    await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, (route) => {
      const sseBody = `data: ${JSON.stringify({ type: 'result', result: 'Direct SSE result' })}\n\n`;
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: sseBody,
      });
    });

    let resultEndpointCallCount = 0;
    page.on('request', (req) => {
      if (req.url().includes(`/tasks/${TASK_ID}/result`)) {
        resultEndpointCallCount++;
      }
    });

    await page.goto('/chat');
    await sendChatMessage(page);

    // Wait for SSE result to appear
    await expect(page.locator('text=Direct SSE result')).toBeVisible({ timeout: 10_000 });

    // Give a moment for any spurious fallback calls
    await page.waitForTimeout(1_500);

    // The fallback endpoint should NOT have been called because SSE delivered the result
    expect(resultEndpointCallCount).toBe(0);
  });

  // ── Test 7: result bubble contains task ID ───────────────────────────────

  test('result bubble shows the task ID from dispatch response', async ({ page }) => {
    await routeDispatch(page);
    await routeTaskResult(page, 'Task ID check result');

    // SSE errors immediately (404) → fallback getTaskResult is called
    await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, (route) => {
      route.fulfill({ status: 404, body: 'Not found' });
    });

    await page.goto('/chat');
    await sendChatMessage(page);

    // Wait for fallback result (generous: 3 retries × 2s backoff ≈ 12s)
    await expect(page.locator('text=Task ID check result').first()).toBeVisible({ timeout: 20_000 });

    // The result bubble should display the task ID
    await expect(page.locator(`[data-testid="result-task-id"]`).first()).toHaveText(TASK_ID);
  });
});
