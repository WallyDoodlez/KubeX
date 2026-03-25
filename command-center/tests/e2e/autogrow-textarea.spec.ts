/**
 * E2E tests for OrchestratorChat — multi-line auto-grow textarea
 * (Iteration 54)
 *
 * Covers:
 * 1.  Textarea is present on /chat
 * 2.  Textarea has a minimum height on initial load (2-row equivalent)
 * 3.  Typing a single line does not increase height beyond minimum
 * 4.  Typing many lines increases the textarea height
 * 5.  Height is capped — does not grow beyond the 8-row maximum
 * 6.  Clearing the textarea (Escape) resets height to minimum
 * 7.  Height resets after sending a message
 * 8.  Placeholder text is visible on initial load
 * 9.  Textarea is disabled while sending (disabled attribute)
 * 10. Ctrl+Enter still submits even in multi-line state
 * 11. resize-none CSS — textarea cannot be manually resized by the user
 * 12. overflowY is 'auto' when content exceeds max height (scroll appears, no overflow clipping)
 */

import { test, expect } from '@playwright/test';
import { mockBaseRoutes, isLiveMode } from './helpers';

const CHAT_MESSAGES_KEY = 'kubex-chat-messages';

async function goToFreshChat(page: import('@playwright/test').Page) {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await page.addInitScript((key: string) => {
    localStorage.removeItem(key);
  }, CHAT_MESSAGES_KEY);
  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');
}

// ── Tests ──────────────────────────────────────────────────────────────────

test('1. textarea is present on /chat', async ({ page }) => {
  await goToFreshChat(page);
  await expect(page.getByTestId('message-input')).toBeVisible();
});

test('2. textarea has a minimum height on initial load', async ({ page }) => {
  await goToFreshChat(page);
  const textarea = page.getByTestId('message-input');
  const initialHeight = await textarea.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
  // Minimum should be approximately 2 rows (≥ 40px, some padding expected)
  expect(initialHeight).toBeGreaterThanOrEqual(40);
});

test('3. single-line content does not increase height beyond minimum', async ({ page }) => {
  await goToFreshChat(page);
  const textarea = page.getByTestId('message-input');
  const initialHeight = await textarea.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
  await textarea.fill('Hello world');
  const afterHeight = await textarea.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
  // Should stay roughly the same (within 4px rounding)
  expect(afterHeight).toBeLessThanOrEqual(initialHeight + 4);
});

test('4. typing many lines increases the textarea height', async ({ page }) => {
  await goToFreshChat(page);
  const textarea = page.getByTestId('message-input');
  const initialHeight = await textarea.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);

  // Type 4 lines — should grow
  const multilineText = 'Line one\nLine two\nLine three\nLine four';
  await textarea.fill(multilineText);
  // Trigger input event so React state + adjustTextareaHeight fires
  await textarea.dispatchEvent('input');

  const afterHeight = await textarea.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
  expect(afterHeight).toBeGreaterThan(initialHeight);
});

test('5. height is capped — does not grow beyond max height', async ({ page }) => {
  await goToFreshChat(page);
  const textarea = page.getByTestId('message-input');

  // Type 20 lines — way beyond the 8-row cap
  const manyLines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
  await textarea.fill(manyLines);
  await textarea.dispatchEvent('input');

  const height = await textarea.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
  // Max height: 8 rows * 24px + 16px padding = 208px. Allow up to 220px for rounding.
  expect(height).toBeLessThanOrEqual(220);
});

test('6. pressing Escape resets height to minimum', async ({ page }) => {
  await goToFreshChat(page);
  const textarea = page.getByTestId('message-input');

  // Grow it first
  await textarea.fill('Line one\nLine two\nLine three\nLine four');
  await textarea.dispatchEvent('input');
  const grownHeight = await textarea.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
  expect(grownHeight).toBeGreaterThan(50);

  // Press Escape to clear
  await textarea.press('Escape');
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="message-input"]') as HTMLTextAreaElement | null;
    return el && el.value === '';
  });

  const resetHeight = await textarea.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
  // Height should return to near minimum
  expect(resetHeight).toBeLessThanOrEqual(grownHeight - 10);
});

test('7. height resets after sending a message', async ({ page }) => {
  // This test uses a custom route pattern (**/tasks) that is non-standard — keep inline
  test.skip(isLiveMode, 'Requires mock route for /tasks endpoint');

  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await page.addInitScript((key: string) => {
    localStorage.removeItem(key);
  }, CHAT_MESSAGES_KEY);

  // Mock the dispatch endpoint so the form can be submitted
  await page.route('**/tasks', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ task_id: 'test-task-54', status: 'queued' }),
      });
    } else {
      await route.continue();
    }
  });
  // Mock SSE stream endpoint — immediately close
  await page.route('**/tasks/test-task-54/stream', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  );

  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');

  const textarea = page.getByTestId('message-input');

  // Grow the textarea
  await textarea.fill('Line one\nLine two\nLine three\nLine four');
  await textarea.dispatchEvent('input');
  const grownHeight = await textarea.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
  expect(grownHeight).toBeGreaterThan(50);

  // Send the message
  await page.getByRole('button', { name: /^Send$/ }).click();

  // Wait for textarea to clear
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="message-input"]') as HTMLTextAreaElement | null;
    return el && el.value === '';
  });

  const resetHeight = await textarea.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
  expect(resetHeight).toBeLessThanOrEqual(grownHeight - 10);
});

test('8. placeholder text is visible on initial load', async ({ page }) => {
  await goToFreshChat(page);
  const textarea = page.getByTestId('message-input');
  await expect(textarea).toHaveAttribute('placeholder', /Message the orchestrator/);
});

test('9. textarea is disabled while sending', async ({ page }) => {
  // This test uses a custom route pattern (**/tasks) that is non-standard — keep inline
  test.skip(isLiveMode, 'Requires mock route for /tasks endpoint');

  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await page.addInitScript((key: string) => {
    localStorage.removeItem(key);
  }, CHAT_MESSAGES_KEY);

  await page.route('**/tasks', async (route) => {
    if (route.request().method() === 'POST') {
      // Delay response to keep "sending" state active
      await new Promise((r) => setTimeout(r, 500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ task_id: 'task-disabled-test', status: 'queued' }),
      });
    } else {
      await route.continue();
    }
  });
  await page.route('**/tasks/task-disabled-test/stream', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  );

  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');

  const textarea = page.getByTestId('message-input');
  await textarea.fill('Disable me while sending');
  await page.getByRole('button', { name: /^Send$/ }).click();

  // Immediately check disabled — sending state should kick in
  await expect(textarea).toBeDisabled();
});

test('10. Ctrl+Enter submits even in multi-line state', async ({ page }) => {
  // This test uses a custom route pattern (**/tasks) that is non-standard — keep inline
  test.skip(isLiveMode, 'Requires mock route for /tasks endpoint');

  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await page.addInitScript((key: string) => {
    localStorage.removeItem(key);
  }, CHAT_MESSAGES_KEY);

  await page.route('**/tasks', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ task_id: 'task-ctrl-enter', status: 'queued' }),
      });
    } else {
      await route.continue();
    }
  });
  await page.route('**/tasks/task-ctrl-enter/stream', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  );

  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');

  const textarea = page.getByTestId('message-input');
  await textarea.fill('Multi\nLine\nMessage');
  await textarea.dispatchEvent('input');

  // Use Ctrl+Enter to submit
  await textarea.press('Control+Enter');

  // Wait for textarea to clear — confirms submit was triggered
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="message-input"]') as HTMLTextAreaElement | null;
    return el && el.value === '';
  }, { timeout: 5000 });
});

test('11. textarea has resize-none styling — user cannot resize it', async ({ page }) => {
  await goToFreshChat(page);
  const textarea = page.getByTestId('message-input');
  const resize = await textarea.evaluate((el) => window.getComputedStyle(el).resize);
  expect(resize).toBe('none');
});

test('12. overflowY is auto when content exceeds max height', async ({ page }) => {
  await goToFreshChat(page);
  const textarea = page.getByTestId('message-input');
  const overflowY = await textarea.evaluate((el) => window.getComputedStyle(el).overflowY);
  // The textarea uses overflowY: auto so a scrollbar appears when capped
  expect(['auto', 'scroll']).toContain(overflowY);
});
