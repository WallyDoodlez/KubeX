/**
 * E2E tests for BUG-007: SSE race condition — task completes before stream opens.
 *
 * Scenario: The task dispatches successfully, but the orchestrator finishes the task
 * in < 2 seconds (before the FE SSE stream connects). The SSE stream opens (200 OK)
 * but sits idle — no events arrive. The FE must detect this by polling getTaskResult
 * immediately on SSE open and render the result.
 *
 * Fix location: OrchestratorChat.tsx — useEffect watching sseStatus === 'open'.
 */

import { test, expect } from '@playwright/test';
import {
  isMockMode,
  isLiveMode,
  GATEWAY,
  MOCK_TASK_ID,
  mockBaseRoutes,
  mockDispatch,
  mockTaskResult,
  expectResultText,
  expectResultLabel,
} from './helpers';

const TASK_ID = MOCK_TASK_ID;

/**
 * Fill and send a chat message, waiting for the system dispatch bubble.
 */
async function sendChatMessage(
  page: import('@playwright/test').Page,
  message = 'quick task',
) {
  // Enable system messages so the dispatch confirmation bubble is visible
  const toggle = page.locator('[data-testid="system-messages-toggle"]');
  const isPressed = await toggle.getAttribute('aria-pressed');
  if (isPressed !== 'true') {
    await toggle.click();
  }

  await page.locator('[data-testid="message-input"]').fill(message);
  await page.locator('button', { hasText: 'Send' }).click();

  if (isMockMode) {
    await expect(
      page.locator(`text=Task dispatched — ID: ${TASK_ID}`),
    ).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(
      page.locator('[data-testid="typing-indicator"]'),
    ).toBeVisible({ timeout: 15_000 });
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('OrchestratorChat — SSE race condition (BUG-007)', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page, { agents: [], kubexes: [] });
  });

  test('result is rendered when SSE stream opens but task already completed (race condition)', async ({ page }) => {
    test.skip(isLiveMode, 'SSE race simulation only works in mock mode');

    await mockDispatch(page, TASK_ID);

    // The task result is already available when the stream opens — task completed before SSE connected
    await mockTaskResult(page, TASK_ID, {
      task_id: TASK_ID,
      status: 'completed',
      result: 'Race condition result text',
    });

    // SSE stream returns 200 with empty body — opens successfully but never sends events.
    // This simulates the race: task done before stream opened, pub/sub events already fired.
    await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: '',
      });
    });

    // Track that getTaskResult is called (confirms the on-open poll fired)
    let resultPolled = false;
    page.on('request', (req) => {
      if (req.url().includes(`/tasks/${TASK_ID}/result`)) {
        resultPolled = true;
      }
    });

    await page.goto('/chat');
    await sendChatMessage(page);

    // The on-open poll should detect completed status immediately (within 5s)
    await expectResultText(page, 'Race condition result text', 10_000);
    await expectResultLabel(page, 10_000);

    // Confirm the result endpoint was actually polled
    expect(resultPolled).toBe(true);
  });

  test('chat input is unlocked after race-condition result renders', async ({ page }) => {
    test.skip(isLiveMode, 'SSE race simulation only works in mock mode');

    await mockDispatch(page, TASK_ID);

    await mockTaskResult(page, TASK_ID, {
      task_id: TASK_ID,
      status: 'completed',
      result: 'Input unlock test result',
    });

    await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: '',
      });
    });

    await page.goto('/chat');
    await sendChatMessage(page);

    // Wait for result to render
    await expectResultText(page, 'Input unlock test result', 10_000);

    // Chat input must be enabled again (sending state cleared)
    const input = page.locator('[data-testid="message-input"]');
    await expect(input).toBeEnabled({ timeout: 5_000 });
  });

  test('failed task from race-condition poll renders error bubble', async ({ page }) => {
    test.skip(isLiveMode, 'SSE race simulation only works in mock mode');

    await mockDispatch(page, TASK_ID);

    await mockTaskResult(page, TASK_ID, {
      task_id: TASK_ID,
      status: 'failed',
      result: 'Agent reported an error',
    });

    await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: '',
      });
    });

    await page.goto('/chat');
    await sendChatMessage(page);

    // Failed result should show an error bubble
    await expect(
      page.locator('[data-testid="result-bubble"][data-role="error"], [data-testid="chat-bubble-error"]').first(),
    ).toBeVisible({ timeout: 10_000 }).catch(async () => {
      // Fallback: look for the error text content directly
      await expect(
        page.locator('text=Task failed: Agent reported an error').first(),
      ).toBeVisible({ timeout: 10_000 });
    });

    // Input should be unlocked
    await expect(page.locator('[data-testid="message-input"]')).toBeEnabled({ timeout: 5_000 });
  });
});
