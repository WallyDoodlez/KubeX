/**
 * E2E tests for Iteration 95 — Smart Agent Result Rendering + Auto-Scroll Fix
 *
 * Covers:
 * 1. Result bubble does NOT show raw JSON envelope (no `"type": "result"` visible)
 * 2. Agent badge is visible with correct agent_id text
 * 3. Duration footer shows "completed in" text
 * 4. Scroll-on-send: typing indicator visible after sending a message
 */

import { test, expect } from '@playwright/test';
import { mockBaseRoutes, mockDispatch, mockSSEStream, mockTaskResult, GATEWAY } from './helpers';

const MOCK_TASK_ID = 'task-render-test-001';

/** Double-encoded SSE result payload simulating a knowledge agent response */
const DOUBLE_ENCODED_RESULT = JSON.stringify({
  result: JSON.stringify({
    output: JSON.stringify({
      role_summary: 'I am a knowledge agent specializing in information retrieval.',
      capabilities: ['search', 'summarize', 'classify'],
    }),
    agent_id: 'knowledge',
    metadata: {
      agent_id: 'knowledge',
      duration_ms: 3200,
    },
  }),
});

function buildSSEBody(taskId: string): string {
  return `data: ${JSON.stringify({
    type: 'result',
    result: JSON.stringify({
      output: JSON.stringify({
        role_summary: 'I am a knowledge agent specializing in information retrieval.',
        capabilities: ['search', 'summarize', 'classify'],
      }),
      agent_id: 'knowledge',
      metadata: {
        agent_id: 'knowledge',
        duration_ms: 3200,
      },
    }),
  })}\n\n`;
}

const CHAT_MESSAGES_KEY = 'kubex-chat-messages';

async function goToFreshChat(page: import('@playwright/test').Page) {
  await mockBaseRoutes(page);
  await mockDispatch(page, MOCK_TASK_ID);
  await mockSSEStream(page, MOCK_TASK_ID, buildSSEBody(MOCK_TASK_ID));
  await mockTaskResult(page, MOCK_TASK_ID, {
    task_id: MOCK_TASK_ID,
    status: 'completed',
    result: 'Task completed.',
  });
  await page.addInitScript((key: string) => {
    localStorage.removeItem(key);
    localStorage.removeItem('kubex-active-task');
  }, CHAT_MESSAGES_KEY);
  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');
}

async function sendMessage(page: import('@playwright/test').Page, text: string) {
  const input = page.getByTestId('message-input');
  await input.fill(text);
  await page.click('button:has-text("Send")');
}

// ── Smart rendering ────────────────────────────────────────────────────

test('1. result bubble does NOT contain raw JSON envelope text', async ({ page }) => {
  await goToFreshChat(page);
  await sendMessage(page, 'What do you know?');

  // Wait for a result bubble to appear
  const resultBubble = page.getByTestId('result-bubble');
  await expect(resultBubble.first()).toBeVisible({ timeout: 10000 });

  // The bubble should NOT contain the raw SSE envelope type field
  const bubbleText = await resultBubble.first().textContent();
  expect(bubbleText).not.toContain('"type": "result"');
  expect(bubbleText).not.toContain('"type":"result"');
});

test('2. agent badge is visible with agent_id text', async ({ page }) => {
  await goToFreshChat(page);
  await sendMessage(page, 'What do you know?');

  const resultBubble = page.getByTestId('result-bubble');
  await expect(resultBubble.first()).toBeVisible({ timeout: 10000 });

  // Check for the agent badge
  const badge = page.getByTestId('agent-badge');
  await expect(badge.first()).toBeVisible();
  await expect(badge.first()).toContainText('knowledge');
});

test('3. duration footer shows "completed in" text', async ({ page }) => {
  await goToFreshChat(page);
  await sendMessage(page, 'What do you know?');

  const resultBubble = page.getByTestId('result-bubble');
  await expect(resultBubble.first()).toBeVisible({ timeout: 10000 });

  // Check for duration footer
  const duration = page.getByTestId('duration-footer');
  await expect(duration.first()).toBeVisible();
  await expect(duration.first()).toContainText('completed in');
  // 3200ms = 3.2s
  await expect(duration.first()).toContainText('3.2s');
});

test('4. scroll-on-send: typing indicator is visible after sending', async ({ page }) => {
  // Use a stream that does NOT immediately return a result, so the typing indicator stays visible
  await mockBaseRoutes(page);
  await mockDispatch(page, 'task-scroll-test');
  // Empty SSE body = non-terminating stream (typing indicator stays)
  await mockSSEStream(page, 'task-scroll-test', '');
  await page.addInitScript((key: string) => {
    localStorage.removeItem(key);
    localStorage.removeItem('kubex-active-task');
  }, CHAT_MESSAGES_KEY);
  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');

  // First, disable auto-scroll by clicking the toggle
  await page.getByTestId('autoscroll-toggle').click();
  await expect(page.getByTestId('autoscroll-toggle')).toHaveAttribute('aria-pressed', 'false');

  // Now send a message — this should force auto-scroll back on
  const input = page.getByTestId('message-input');
  await input.fill('Test scroll on send');
  await page.click('button:has-text("Send")');

  // The typing indicator should be visible (auto-scroll was forced on by send)
  const typing = page.getByTestId('typing-indicator');
  await expect(typing).toBeVisible({ timeout: 5000 });

  // Auto-scroll should be re-engaged
  await expect(page.getByTestId('autoscroll-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('5. result with plain string renders without JSON wrapping', async ({ page }) => {
  // Test that a simple string result still works correctly after refactor
  await mockBaseRoutes(page);
  await mockDispatch(page, 'task-plain-test');
  const plainSSE = `data: ${JSON.stringify({ type: 'result', result: 'Simple plain text result.' })}\n\n`;
  await mockSSEStream(page, 'task-plain-test', plainSSE);
  await mockTaskResult(page, 'task-plain-test', {
    task_id: 'task-plain-test',
    status: 'completed',
    result: 'Simple plain text result.',
  });
  await page.addInitScript((key: string) => {
    localStorage.removeItem(key);
    localStorage.removeItem('kubex-active-task');
  }, CHAT_MESSAGES_KEY);
  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');

  await sendMessage(page, 'Give me a simple answer');

  const resultBubble = page.getByTestId('result-bubble');
  await expect(resultBubble.first()).toBeVisible({ timeout: 10000 });

  const text = await resultBubble.first().textContent();
  expect(text).toContain('Simple plain text result.');
});
