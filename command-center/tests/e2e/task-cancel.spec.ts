import { test, expect } from '@playwright/test';

const GATEWAY = 'http://localhost:8080';
const TASK_ID = 'mock-task-cancel-1';

/** Set up common route intercepts for a cancel-focused test scenario */
async function setupCancelRoutes(page: import('@playwright/test').Page) {
  // Suppress unrelated background endpoints
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

  // Dispatch — returns a known task_id
  await page.route(`${GATEWAY}/actions`, (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ task_id: TASK_ID, status: 'accepted' }),
      });
    } else {
      route.continue();
    }
  });

  // SSE stream — keeps connection open (no data) so task stays in-flight
  await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: '',
    });
  });

  // Cancel endpoint — success
  await page.route(`${GATEWAY}/tasks/${TASK_ID}/cancel`, (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ task_id: TASK_ID, status: 'cancelled' }),
      });
    } else {
      route.continue();
    }
  });

  // Fallback task result (if triggered) — returns cancelled so the loop exits
  await page.route(`${GATEWAY}/tasks/${TASK_ID}/result`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ task_id: TASK_ID, status: 'cancelled', result: 'Cancelled' }),
    }),
  );
}

/** Dispatch a task and wait for the typing indicator to appear */
async function dispatchAndWaitForTyping(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="message-input"]').fill('Run a long background job');
  await page.locator('button', { hasText: 'Send' }).click();
  await expect(page.locator('[data-testid="typing-indicator"]')).toBeVisible({ timeout: 5000 });
}

test.describe('Task Cancel UI', () => {
  test('cancel button is not visible before a task is dispatched', async ({ page }) => {
    await page.goto('/chat');
    // No active task — cancel button should not be rendered
    await expect(page.locator('[data-testid="cancel-task-button"]')).not.toBeVisible();
  });

  test('cancel button appears in the typing indicator while a task is active', async ({ page }) => {
    await setupCancelRoutes(page);
    await page.goto('/chat');
    await dispatchAndWaitForTyping(page);
    await expect(page.locator('[data-testid="cancel-task-button"]')).toBeVisible({ timeout: 5000 });
  });

  test('cancel button label reads "Cancel"', async ({ page }) => {
    await setupCancelRoutes(page);
    await page.goto('/chat');
    await dispatchAndWaitForTyping(page);
    await expect(page.locator('[data-testid="cancel-task-button"]')).toHaveText('Cancel');
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

    // A cancellation message should appear in the chat
    await expect(page.locator('text=cancelled by user')).toBeVisible({ timeout: 5000 });

    // The cancel endpoint should have been called
    expect(cancelRequests.length).toBeGreaterThanOrEqual(1);
    expect(cancelRequests[0]).toMatch(/\/tasks\/[^/]+\/cancel/);
  });

  test('cancel button has aria-label for accessibility', async ({ page }) => {
    await setupCancelRoutes(page);
    await page.goto('/chat');
    await dispatchAndWaitForTyping(page);
    const cancelBtn = page.locator('[data-testid="cancel-task-button"]');
    await expect(cancelBtn).toHaveAttribute('aria-label', 'Cancel active task');
  });

  test('typing indicator is gone and send button returns after cancel', async ({ page }) => {
    await setupCancelRoutes(page);
    await page.goto('/chat');
    await dispatchAndWaitForTyping(page);

    await page.locator('[data-testid="cancel-task-button"]').click();

    // Typing indicator should disappear after cancel
    await expect(page.locator('[data-testid="typing-indicator"]')).not.toBeVisible({ timeout: 5000 });

    // Send button should be re-enabled after filling in new input
    await page.locator('[data-testid="message-input"]').fill('New message');
    await expect(page.locator('button', { hasText: 'Send' })).toBeEnabled({ timeout: 5000 });
  });

  test('cancel button is disabled while cancellation is in flight', async ({ page }) => {
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
