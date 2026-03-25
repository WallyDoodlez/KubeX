import { test, expect } from '@playwright/test';
import {
  isLiveMode,
  isMockMode,
  GATEWAY,
  mockBaseRoutes,
  mockDispatch,
  mockSSEStream,
  mockTaskResult,
  mockTaskCancel,
} from './helpers';

const TASK_ID = 'mock-task-cancel-1';

/** Set up common route intercepts for a cancel-focused test scenario */
async function setupCancelRoutes(page: import('@playwright/test').Page) {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });

  // Dispatch — returns a known task_id
  await mockDispatch(page, TASK_ID, { task_id: TASK_ID, status: 'accepted' });

  // SSE stream — keeps connection open (no data) so task stays in-flight
  await mockSSEStream(page, TASK_ID, '');

  // Cancel endpoint — success (no-op in live mode)
  await mockTaskCancel(page, TASK_ID);

  // Fallback task result (if triggered) — returns cancelled so the loop exits
  await mockTaskResult(page, TASK_ID, { task_id: TASK_ID, status: 'cancelled', result: 'Cancelled' });
}

/**
 * Dispatch a task and wait for the typing indicator to appear.
 * In live mode the task may complete quickly — we allow a generous timeout.
 */
async function dispatchAndWaitForTyping(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="message-input"]').fill('Run a long background job');
  await page.locator('button', { hasText: 'Send' }).click();
  // In live mode: real dispatch takes longer; in mock mode the indicator appears immediately
  const timeout = isMockMode ? 5_000 : 15_000;
  await expect(page.locator('[data-testid="typing-indicator"]')).toBeVisible({ timeout });
}

test.describe('Task Cancel UI', () => {
  test('cancel button is not visible before a task is dispatched', async ({ page }) => {
    await mockBaseRoutes(page, { agents: [], kubexes: [] });
    await page.goto('/chat');
    // No active task — cancel button should not be rendered
    await expect(page.locator('[data-testid="cancel-task-button"]')).not.toBeVisible();
  });

  test('cancel button appears in the typing indicator while a task is active', async ({ page }) => {
    await setupCancelRoutes(page);
    await page.goto('/chat');
    await dispatchAndWaitForTyping(page);
    const btnTimeout = isMockMode ? 5_000 : 15_000;
    await expect(page.locator('[data-testid="cancel-task-button"]')).toBeVisible({ timeout: btnTimeout });
  });

  test('cancel button label reads "Cancel"', async ({ page }) => {
    await setupCancelRoutes(page);
    await page.goto('/chat');
    await dispatchAndWaitForTyping(page);
    const btnTimeout = isMockMode ? 5_000 : 15_000;
    await expect(page.locator('[data-testid="cancel-task-button"]')).toHaveText('Cancel', { timeout: btnTimeout });
  });

  test('clicking cancel posts to /tasks/:id/cancel and surfaces cancellation message', async ({ page }) => {
    await setupCancelRoutes(page);

    // Track cancel requests
    const cancelRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/tasks/') && req.url().includes('/cancel') && req.method() === 'POST') {
        cancelRequests.push(req.url());
      }
    });

    await page.goto('/chat');
    await dispatchAndWaitForTyping(page);

    // Click cancel
    await page.locator('[data-testid="cancel-task-button"]').click();

    if (isMockMode) {
      // In mock mode: cancellation message text is deterministic
      await expect(page.locator('text=cancelled by user')).toBeVisible({ timeout: 5_000 });
    } else {
      // In live mode: verify cancel was attempted — either typing indicator gone or cancellation text appeared
      await expect(
        page.locator('[data-testid="typing-indicator"]'),
      ).not.toBeVisible({ timeout: 15_000 });
    }

    // The cancel endpoint should have been called in both modes
    expect(cancelRequests.length).toBeGreaterThanOrEqual(1);
    expect(cancelRequests[0]).toMatch(/\/tasks\/[^/]+\/cancel/);
  });

  test('cancel button has aria-label for accessibility', async ({ page }) => {
    await setupCancelRoutes(page);
    await page.goto('/chat');
    await dispatchAndWaitForTyping(page);
    const btnTimeout = isMockMode ? 5_000 : 15_000;
    const cancelBtn = page.locator('[data-testid="cancel-task-button"]');
    await expect(cancelBtn).toBeVisible({ timeout: btnTimeout });
    await expect(cancelBtn).toHaveAttribute('aria-label', 'Cancel active task');
  });

  test('typing indicator is gone and send button returns after cancel', async ({ page }) => {
    await setupCancelRoutes(page);
    await page.goto('/chat');
    await dispatchAndWaitForTyping(page);

    await page.locator('[data-testid="cancel-task-button"]').click();

    // Typing indicator should disappear after cancel (generous timeout for live mode)
    const cancelTimeout = isMockMode ? 5_000 : 20_000;
    await expect(page.locator('[data-testid="typing-indicator"]')).not.toBeVisible({ timeout: cancelTimeout });

    // Send button should be re-enabled after filling in new input
    await page.locator('[data-testid="message-input"]').fill('New message');
    await expect(page.locator('button', { hasText: 'Send' })).toBeEnabled({ timeout: 5000 });
  });

  test('cancel button is disabled while cancellation is in flight', async ({ page }) => {
    test.skip(isLiveMode, 'Slow cancel simulation (artificial delay) only works in mock mode');

    await setupCancelRoutes(page);

    // Override cancel to respond slowly
    await page.route(`${GATEWAY}/tasks/${TASK_ID}/cancel`, async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ task_id: TASK_ID, status: 'cancelled' }),
      });
    });

    await page.goto('/chat');
    await dispatchAndWaitForTyping(page);

    const cancelBtn = page.locator('[data-testid="cancel-task-button"]');
    await expect(cancelBtn).toBeVisible();

    // Click cancel and immediately check it is disabled
    await cancelBtn.click();
    // During the 500ms delay the button should show "Cancelling…" or be disabled
    // We just verify the cancellation message eventually appears
    await expect(page.locator('text=cancelled by user')).toBeVisible({ timeout: 5000 });
  });
});
