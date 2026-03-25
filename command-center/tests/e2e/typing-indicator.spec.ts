/**
 * E2E tests for OrchestratorChat — typing indicator and welcome empty state
 * (Iteration 44)
 *
 * Covers:
 * 1.  Typing indicator is NOT visible on page load
 * 2.  [data-testid="typing-indicator"] is absent when not sending
 * 3.  Welcome section is visible on fresh chat ([data-testid="chat-welcome"])
 * 4.  Welcome heading text is "What can I help you with?"
 * 5.  Welcome sub-text is present
 * 6.  Welcome prompts container is present ([data-testid="welcome-prompts"])
 * 7.  Welcome has exactly 4 prompt buttons ([data-testid="welcome-prompt-button"])
 * 8.  Clicking "Summarize recent logs" fills the message textarea
 * 9.  Clicking "Check system health" fills the message textarea
 * 10. Clicking "List running agents" fills the message textarea
 * 11. Clicking "Deploy a service" fills the message textarea
 * 12. Welcome disappears after messages are added
 * 13. Welcome does not appear when chat-search filter is active
 * 14. Welcome does not appear when role filter is active
 * 15. Typing indicator has three dot spans
 * 16. Sending label is present inside typing indicator
 */

import { test, expect } from '@playwright/test';
import { mockBaseRoutes, GATEWAY, isLiveMode } from './helpers';

const CHAT_MESSAGES_KEY = 'kubex-chat-messages';

/** Navigate to /chat with a fresh empty chat (only the welcome system message). */
async function goToFreshChat(page: import('@playwright/test').Page) {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  // Remove any stored chat messages so the app starts with only the welcome message
  await page.addInitScript((key: string) => {
    localStorage.removeItem(key);
  }, CHAT_MESSAGES_KEY);
  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');
}

// ── Welcome empty state ────────────────────────────────────────────────────

test('welcome section is visible on fresh chat', async ({ page }) => {
  await goToFreshChat(page);
  await expect(page.locator('[data-testid="chat-welcome"]')).toBeVisible();
});

test('welcome heading text is "What can I help you with?"', async ({ page }) => {
  await goToFreshChat(page);
  const heading = page.locator('[data-testid="chat-welcome"] h2');
  await expect(heading).toHaveText('What can I help you with?');
});

test('welcome sub-text is present', async ({ page }) => {
  await goToFreshChat(page);
  const sub = page.locator('[data-testid="chat-welcome"] p');
  await expect(sub).toContainText('orchestrator');
});

test('welcome prompts container is present', async ({ page }) => {
  await goToFreshChat(page);
  await expect(page.locator('[data-testid="welcome-prompts"]')).toBeVisible();
});

test('welcome has exactly 4 prompt buttons', async ({ page }) => {
  await goToFreshChat(page);
  const buttons = page.locator('[data-testid="welcome-prompt-button"]');
  await expect(buttons).toHaveCount(4);
});

test('clicking "Summarize recent logs" fills the message textarea', async ({ page }) => {
  await goToFreshChat(page);
  await page.locator('[data-testid="welcome-prompt-button"]', { hasText: 'Summarize recent logs' }).click();
  const input = page.locator('[data-testid="message-input"]');
  await expect(input).toHaveValue('Summarize recent logs');
});

test('clicking "Check system health" fills the message textarea', async ({ page }) => {
  await goToFreshChat(page);
  await page.locator('[data-testid="welcome-prompt-button"]', { hasText: 'Check system health' }).click();
  const input = page.locator('[data-testid="message-input"]');
  await expect(input).toHaveValue('Check system health');
});

test('clicking "List running agents" fills the message textarea', async ({ page }) => {
  await goToFreshChat(page);
  await page.locator('[data-testid="welcome-prompt-button"]', { hasText: 'List running agents' }).click();
  const input = page.locator('[data-testid="message-input"]');
  await expect(input).toHaveValue('List running agents');
});

test('clicking "Deploy a service" fills the message textarea', async ({ page }) => {
  await goToFreshChat(page);
  await page.locator('[data-testid="welcome-prompt-button"]', { hasText: 'Deploy a service' }).click();
  const input = page.locator('[data-testid="message-input"]');
  await expect(input).toHaveValue('Deploy a service');
});

test('welcome disappears after messages are added', async ({ page }) => {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  // Pre-seed localStorage with a user message so messages.length > 1
  const welcomeMsg = {
    id: 'welcome',
    role: 'system',
    content: 'KubexClaw Command Center — dispatch tasks to the orchestrator via the Gateway. Enter a capability and message below.',
    timestamp: new Date().toISOString(),
  };
  const userMsg = {
    id: 'user-1',
    role: 'user',
    content: 'Hello orchestrator',
    timestamp: new Date().toISOString(),
  };
  await page.addInitScript(
    ({ key, messages }: { key: string; messages: object[] }) => {
      localStorage.setItem(key, JSON.stringify(messages));
    },
    { key: CHAT_MESSAGES_KEY, messages: [welcomeMsg, userMsg] },
  );
  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');
  await expect(page.locator('[data-testid="chat-welcome"]')).not.toBeVisible();
});

test('welcome does not appear when chat-search filter is active', async ({ page }) => {
  await goToFreshChat(page);
  // Activate the search filter
  await page.locator('[data-testid="chat-search-input"]').fill('something');
  // isFiltering becomes true → welcome should be hidden
  await expect(page.locator('[data-testid="chat-welcome"]')).not.toBeVisible();
});

test('welcome does not appear when role filter is active', async ({ page }) => {
  await goToFreshChat(page);
  // Activate role filter (not "all")
  await page.locator('[data-testid="chat-role-filter"]').selectOption('user');
  await expect(page.locator('[data-testid="chat-welcome"]')).not.toBeVisible();
});

// ── Typing indicator ───────────────────────────────────────────────────────

test('typing indicator is NOT visible on page load', async ({ page }) => {
  await goToFreshChat(page);
  await expect(page.locator('[data-testid="typing-indicator"]')).not.toBeVisible();
});

test('typing indicator is absent (not in DOM) when not sending', async ({ page }) => {
  await goToFreshChat(page);
  const indicator = page.locator('[data-testid="typing-indicator"]');
  // Either not in DOM or not visible
  const count = await indicator.count();
  if (count > 0) {
    await expect(indicator).not.toBeVisible();
  }
});

test('typing indicator has three dot spans when sending', async ({ page }) => {
  test.skip(isLiveMode, 'Requires slow-dispatch mock to observe transient typing indicator state');
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  // Mock a slow dispatch that keeps sending=true long enough to check the indicator
  await page.route(`${GATEWAY}/actions`, async (route) => {
    // Delay response briefly so we can catch the indicator
    await new Promise((resolve) => setTimeout(resolve, 2000));
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ task_id: 'mock-task-typing-1' }),
    });
  });
  // Also stub the SSE stream to never resolve (keeps sending=true)
  await page.route(`${GATEWAY}/tasks/mock-task-typing-1/stream`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    }),
  );
  await page.addInitScript((key: string) => {
    localStorage.removeItem(key);
  }, CHAT_MESSAGES_KEY);
  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');

  // Type and send
  await page.locator('[data-testid="message-input"]').fill('ping');
  await page.locator('button:has-text("Send")').click();

  // Typing indicator should appear
  const indicator = page.locator('[data-testid="typing-indicator"]');
  await expect(indicator).toBeVisible({ timeout: 5000 });

  // Should have 3 dot spans (all are span elements with rounded-full)
  const dots = indicator.locator('div > span.rounded-full');
  await expect(dots).toHaveCount(3);
});

test('sending label is present inside typing indicator when sending', async ({ page }) => {
  test.skip(isLiveMode, 'Requires slow-dispatch mock to observe transient typing indicator state');
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await page.route(`${GATEWAY}/actions`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ task_id: 'mock-task-typing-2' }),
    });
  });
  await page.route(`${GATEWAY}/tasks/mock-task-typing-2/stream`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    }),
  );
  await page.addInitScript((key: string) => {
    localStorage.removeItem(key);
  }, CHAT_MESSAGES_KEY);
  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');

  await page.locator('[data-testid="message-input"]').fill('ping');
  await page.locator('button:has-text("Send")').click();

  const indicator = page.locator('[data-testid="typing-indicator"]');
  await expect(indicator).toBeVisible({ timeout: 5000 });

  const label = indicator.locator('[data-testid="sending-label"]');
  await expect(label).toBeVisible();
  await expect(label).not.toHaveText('');
});
