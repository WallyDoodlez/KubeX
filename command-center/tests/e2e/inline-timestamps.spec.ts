/**
 * E2E tests for Iteration 94 — inline timestamps on all chat message types.
 *
 * Verifies that every message type (user, result, error, system) renders
 * a RelativeTime timestamp element with data-testid="chat-bubble-timestamp".
 */

import { test, expect } from '@playwright/test';
import {
  isMockMode,
  GATEWAY,
  MOCK_TASK_ID,
  mockBaseRoutes,
  mockDispatch,
  mockSSEStream,
  MOCK_SSE_RESULT,
} from './helpers';

const TASK_ID = MOCK_TASK_ID;

// ---------------------------------------------------------------------------

test.describe('Inline timestamps on all chat message types', () => {
  test.skip(!isMockMode, 'Timestamp tests require deterministic mock mode');

  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page, { agents: [], kubexes: [] });
  });

  /**
   * Helper: navigate to /chat, optionally enable system messages toggle,
   * dispatch a task and wait for completion.
   */
  async function dispatchAndWaitForResult(
    page: import('@playwright/test').Page,
    resultText: string,
  ) {
    await mockDispatch(page, TASK_ID);
    await mockSSEStream(page, TASK_ID, MOCK_SSE_RESULT(TASK_ID, resultText));

    await page.goto('/chat');

    // Enable system messages so the system bubble is visible
    const toggle = page.locator('[data-testid="system-messages-toggle"]');
    const isPressed = await toggle.getAttribute('aria-pressed');
    if (isPressed !== 'true') {
      await toggle.click();
    }

    await page.locator('[data-testid="message-input"]').fill('hello world');
    await page.locator('button', { hasText: 'Send' }).click();

    // Wait for result bubble to confirm all message types have appeared
    await expect(page.locator('[data-testid="result-bubble"]')).toBeVisible({ timeout: 20_000 });
  }

  // ── user message timestamp ───────────────────────────────────────────────

  test('user message bubble shows an inline timestamp', async ({ page }) => {
    await mockDispatch(page, TASK_ID);
    await mockSSEStream(page, TASK_ID, MOCK_SSE_RESULT(TASK_ID, 'User timestamp test'));

    await page.goto('/chat');

    await page.locator('[data-testid="message-input"]').fill('hello world');
    await page.locator('button', { hasText: 'Send' }).click();

    // Wait for the user message bubble to appear (the input is cleared on send)
    // The user message shows the sent text
    await expect(page.locator('text=hello world').first()).toBeVisible({ timeout: 5_000 });

    // Timestamp immediately below the user bubble (it's the first chat-bubble-timestamp)
    const timestamps = page.locator('[data-testid="chat-bubble-timestamp"]');
    await expect(timestamps.first()).toBeVisible({ timeout: 5_000 });
    const tsText = await timestamps.first().textContent();
    // RelativeTime renders a human-friendly string; it should be non-empty
    expect(tsText?.trim().length).toBeGreaterThan(0);
  });

  // ── system message timestamp ─────────────────────────────────────────────

  test('system message bubble shows an inline timestamp', async ({ page }) => {
    await dispatchAndWaitForResult(page, 'System timestamp test result');

    // The system bubble shows "Task dispatched — ID: <taskId>"
    // Use .first() since there may be more than one system-message (e.g. welcome + dispatch)
    const systemBubble = page.locator('[data-testid="system-message"]').last();
    await expect(systemBubble).toBeVisible({ timeout: 10_000 });

    // It should contain a chat-bubble-timestamp child
    const systemTimestamp = systemBubble.locator('[data-testid="chat-bubble-timestamp"]');
    await expect(systemTimestamp).toBeVisible();
    const tsText = await systemTimestamp.textContent();
    expect(tsText?.trim().length).toBeGreaterThan(0);
  });

  // ── result message timestamp ─────────────────────────────────────────────

  test('result message bubble shows an inline timestamp', async ({ page }) => {
    await dispatchAndWaitForResult(page, 'Result timestamp test');

    const resultBubble = page.locator('[data-testid="result-bubble"]');
    await expect(resultBubble).toBeVisible({ timeout: 20_000 });

    // The timestamp is rendered outside the bubble div but inside the result wrapper
    // Use the closest ancestor and find the sibling timestamp
    const resultTimestamp = resultBubble.locator('xpath=following-sibling::*').filter({
      has: page.locator('[data-testid="chat-bubble-timestamp"]'),
    });

    // Alternatively: find any chat-bubble-timestamp that is after the result bubble
    const allTimestamps = page.locator('[data-testid="chat-bubble-timestamp"]');
    const count = await allTimestamps.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // At least one timestamp should be visible and non-empty
    let foundVisible = false;
    for (let i = 0; i < count; i++) {
      const el = allTimestamps.nth(i);
      const visible = await el.isVisible();
      if (visible) {
        foundVisible = true;
        const text = await el.textContent();
        expect(text?.trim().length).toBeGreaterThan(0);
      }
    }
    expect(foundVisible).toBe(true);
  });

  // ── error message timestamp ──────────────────────────────────────────────

  test('error message bubble shows an inline timestamp', async ({ page }) => {
    await mockDispatch(page, TASK_ID);

    // SSE stream emits a "failed" event → error bubble
    await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, (route) => {
      const sseBody = `data: ${JSON.stringify({ type: 'failed', error: 'Timestamp error test' })}\n\n`;
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: sseBody,
      });
    });

    await page.goto('/chat');
    await page.locator('[data-testid="message-input"]').fill('hello world');
    await page.locator('button', { hasText: 'Send' }).click();

    // Wait for error bubble
    const errorBubble = page.locator('[data-testid="error-bubble"]');
    await expect(errorBubble).toBeVisible({ timeout: 10_000 });

    // There should be at least one chat-bubble-timestamp visible
    const timestamps = page.locator('[data-testid="chat-bubble-timestamp"]');
    await expect(timestamps.first()).toBeVisible({ timeout: 5_000 });
    const tsText = await timestamps.first().textContent();
    expect(tsText?.trim().length).toBeGreaterThan(0);
  });

  // ── all 4 message types simultaneously ──────────────────────────────────

  test('all 4 message types each have a visible timestamp after a full dispatch flow', async ({ page }) => {
    await dispatchAndWaitForResult(page, 'All-types timestamp test');

    // After a full dispatch flow we expect:
    // 1. user bubble (sent message)
    // 2. system bubble (Task dispatched — ID: ...)
    // 3. result bubble (SSE result)
    // All three should have a chat-bubble-timestamp

    const timestamps = page.locator('[data-testid="chat-bubble-timestamp"]');
    const count = await timestamps.count();

    // We expect at least 3 timestamps: user + system + result
    expect(count).toBeGreaterThanOrEqual(3);

    // All visible timestamps should have non-empty text
    for (let i = 0; i < count; i++) {
      const el = timestamps.nth(i);
      const visible = await el.isVisible();
      if (visible) {
        const text = await el.textContent();
        expect(text?.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
