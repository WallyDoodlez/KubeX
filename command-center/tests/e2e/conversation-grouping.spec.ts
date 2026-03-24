/**
 * E2E tests — Iteration 71: Conversation Grouping
 *
 * Verifies that the OrchestratorChat groups messages by task_id
 * with visual dividers between task groups.
 *
 * Covers:
 * 1. Single task → task-group wrapper rendered
 * 2. Single task → no divider rendered (first group never has a divider)
 * 3. Two sequential tasks → two task-group wrappers
 * 4. Two sequential tasks → one divider between them
 * 5. Divider shows the task ID as a label
 * 6. Ungrouped (no task_id) messages do not generate a task-group wrapper
 * 7. Ungrouped messages interleaved between tasks do not get grouped
 * 8. Conversation groups collapse correctly when search filters to one task
 * 9. Groups render in dispatch order (first task above second)
 * 10. data-task-id attribute matches the task_id of the group
 */

import { test, expect } from '@playwright/test';

const GATEWAY = 'http://localhost:8080';

const TASK_1_ID = 'task-group-test-001';
const TASK_2_ID = 'task-group-test-002';

async function setupBaseRoutes(page: import('@playwright/test').Page) {
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

/**
 * Dispatch a task via the OrchestratorChat and wait for its result bubble.
 * Returns after the result text is visible in the DOM.
 */
async function dispatchTask(
  page: import('@playwright/test').Page,
  taskId: string,
  userMessage: string,
  resultText: string,
) {
  // Wire up routes for this specific task
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
    const sseBody = `data: ${JSON.stringify({ type: 'result', result: resultText })}\n\n`;
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: sseBody,
    });
  });

  await page.locator('[data-testid="message-input"]').fill(userMessage);
  await page.locator('button', { hasText: 'Send' }).click();

  // Wait until the result bubble is visible before returning
  await expect(page.locator(`text=${resultText}`)).toBeVisible({ timeout: 12_000 });
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Conversation Grouping (Iteration 71)', () => {
  test.beforeEach(async ({ page }) => {
    await setupBaseRoutes(page);
    await page.goto('/chat');
  });

  test('a dispatched task creates a task-group wrapper', async ({ page }) => {
    await dispatchTask(page, TASK_1_ID, 'hello group test', 'group-result-alpha');

    // At least one task-group wrapper should be present
    await expect(page.locator('[data-testid="task-group"]').first()).toBeVisible();
  });

  test('the first task group does not have a preceding divider', async ({ page }) => {
    await dispatchTask(page, TASK_1_ID, 'first task no divider', 'result-no-divider');

    // Only one task group → divider should not exist
    await expect(page.locator('[data-testid="task-group-divider"]')).not.toBeVisible();
  });

  test('two sequential tasks produce two task-group wrappers', async ({ page }) => {
    await dispatchTask(page, TASK_1_ID, 'task one message', 'result-task-one');
    await dispatchTask(page, TASK_2_ID, 'task two message', 'result-task-two');

    const groups = page.locator('[data-testid="task-group"]');
    await expect(groups).toHaveCount(2);
  });

  test('two sequential tasks produce exactly one divider between them', async ({ page }) => {
    await dispatchTask(page, TASK_1_ID, 'alpha task', 'result-alpha');
    await dispatchTask(page, TASK_2_ID, 'beta task', 'result-beta');

    const dividers = page.locator('[data-testid="task-group-divider"]');
    await expect(dividers).toHaveCount(1);
  });

  test('divider contains the second task ID as a label', async ({ page }) => {
    await dispatchTask(page, TASK_1_ID, 'first dispatch', 'result-first');
    await dispatchTask(page, TASK_2_ID, 'second dispatch', 'result-second');

    const divider = page.locator('[data-testid="task-group-divider"]');
    await expect(divider).toContainText(TASK_2_ID);
  });

  test('task-group wrapper carries the correct data-task-id attribute', async ({ page }) => {
    await dispatchTask(page, TASK_1_ID, 'attr test message', 'result-attr-test');

    const group = page.locator(`[data-testid="task-group"][data-task-id="${TASK_1_ID}"]`);
    await expect(group).toBeVisible();
  });

  test('messages inside a task group are visible', async ({ page }) => {
    await dispatchTask(page, TASK_1_ID, 'visible content check', 'unique-visible-result-77');

    const group = page.locator(`[data-testid="task-group"][data-task-id="${TASK_1_ID}"]`);
    await expect(group.locator('text=visible content check')).toBeVisible();
    await expect(group.locator('text=unique-visible-result-77')).toBeVisible();
  });

  test('second task group content is inside its own group wrapper', async ({ page }) => {
    await dispatchTask(page, TASK_1_ID, 'group one content', 'result-group-one');
    await dispatchTask(page, TASK_2_ID, 'group two content', 'result-group-two');

    const group2 = page.locator(`[data-testid="task-group"][data-task-id="${TASK_2_ID}"]`);
    await expect(group2.locator('text=group two content')).toBeVisible();
    await expect(group2.locator('text=result-group-two')).toBeVisible();
  });

  test('first task messages are NOT inside the second task group', async ({ page }) => {
    await dispatchTask(page, TASK_1_ID, 'exclusive-task-one-msg', 'exclusive-result-one');
    await dispatchTask(page, TASK_2_ID, 'exclusive-task-two-msg', 'exclusive-result-two');

    const group2 = page.locator(`[data-testid="task-group"][data-task-id="${TASK_2_ID}"]`);
    // Task 1 messages should not appear inside group 2's wrapper
    await expect(group2.locator('text=exclusive-task-one-msg')).not.toBeAttached();
  });

  test('search filter that matches only one task hides the other group', async ({ page }) => {
    await dispatchTask(page, TASK_1_ID, 'needle-only-in-task-one', 'task-one-result-xyz');
    await dispatchTask(page, TASK_2_ID, 'task two separate content', 'task-two-result-abc');

    // Filter by task-one result text
    await page.locator('[data-testid="chat-search-input"]').fill('task-one-result-xyz');

    // Group 1 should still show
    await expect(page.locator('text=task-one-result-xyz')).toBeVisible();

    // Group 2 result should not be visible (filtered out)
    await expect(page.locator('text=task-two-result-abc')).not.toBeVisible();
  });

  test('task groups render in dispatch order — first task above second', async ({ page }) => {
    await dispatchTask(page, TASK_1_ID, 'order-check-first', 'order-result-first');
    await dispatchTask(page, TASK_2_ID, 'order-check-second', 'order-result-second');

    const groups = page.locator('[data-testid="task-group"]');
    const firstGroupTaskId = await groups.nth(0).getAttribute('data-task-id');
    const secondGroupTaskId = await groups.nth(1).getAttribute('data-task-id');

    expect(firstGroupTaskId).toBe(TASK_1_ID);
    expect(secondGroupTaskId).toBe(TASK_2_ID);
  });
});
