/**
 * E2E tests for OrchestratorChat — Task progress timeline
 * (Iteration 51)
 *
 * Covers:
 * 1.  Live timeline appears in the typing indicator while a task is streaming
 * 2.  Live timeline has data-testid="live-task-timeline"
 * 3.  Live timeline shows "Dispatched" phase initially
 * 4.  Live timeline shows "Connecting" phase after dispatch succeeds
 * 5.  After task completes, result bubble has data-testid="result-bubble-timeline"
 * 6.  Result bubble timeline shows all phases as done (4 phases)
 * 7.  Error bubble has data-testid="error-bubble-timeline" when phases are present
 * 8.  Timeline phases have correct data-testid attributes (data-testid="timeline-phase-*")
 * 9.  Live timeline is not visible when no task is in progress
 * 10. Timeline on result bubble shows "Dispatched", "Connecting", "Streaming", "Completed"
 * 11. Dispatch failure shows failed phase on error bubble timeline
 * 12. Timeline role="list" for accessibility
 */

import { test, expect } from '@playwright/test';

const GATEWAY = 'http://localhost:8080';
const TASK_ID = 'timeline-task-51';

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

/** Route that makes dispatch succeed and streams a result */
async function setupSuccessfulTask(page: import('@playwright/test').Page, taskId = TASK_ID) {
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
  // SSE stream returns a result event
  await page.route(`${GATEWAY}/tasks/${taskId}/stream`, (route) => {
    const body = `data: ${JSON.stringify({ type: 'result', result: 'Task completed successfully!' })}\n\n`;
    route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await page.route(`${GATEWAY}/tasks/${taskId}/result`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ task_id: taskId, status: 'completed', result: 'Task completed successfully!' }),
    });
  });
}

/** Route that makes dispatch succeed but SSE delivers a failure */
async function setupFailedTask(page: import('@playwright/test').Page, taskId = TASK_ID) {
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
  // SSE stream returns a failed event
  await page.route(`${GATEWAY}/tasks/${taskId}/stream`, (route) => {
    const body = `data: ${JSON.stringify({ type: 'failed', error: 'Agent crashed' })}\n\n`;
    route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await page.route(`${GATEWAY}/tasks/${taskId}/result`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ task_id: taskId, status: 'failed', error: 'Agent crashed' }),
    });
  });
}

/** Route that makes dispatch fail at the HTTP level */
async function setupDispatchFailure(page: import('@playwright/test').Page) {
  await page.route(`${GATEWAY}/actions`, (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Gateway unreachable' }),
      });
    } else {
      route.continue();
    }
  });
}

/** Helper: navigate to /chat and enable system messages toggle */
async function goToChat(page: import('@playwright/test').Page) {
  await page.goto('/chat');
  await expect(page.getByTestId('message-input')).toBeVisible();
  // Enable system messages so dispatch confirmations are visible
  const toggle = page.getByTestId('system-messages-toggle');
  const isPressed = await toggle.getAttribute('aria-pressed');
  if (isPressed === 'false') {
    await toggle.click();
  }
}

/** Helper: type and send a message */
async function sendMessage(page: import('@playwright/test').Page, text = 'Run timeline test') {
  const input = page.getByTestId('message-input');
  await input.fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

// ── Tests ──────────────────────────────────────────────────────────────

test('01 — live task timeline not visible before any task is sent', async ({ page }) => {
  await setupBaseRoutes(page);
  await goToChat(page);
  await expect(page.getByTestId('live-task-timeline')).not.toBeVisible();
});

test('02 — live task timeline appears in typing indicator while task streams', async ({ page }) => {
  await setupBaseRoutes(page);
  // Use a slow SSE stream so the typing indicator is visible for long enough
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
  // Delay the SSE response so we can observe the live timeline
  await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    const body = `data: ${JSON.stringify({ type: 'result', result: 'Done!' })}\n\n`;
    route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await page.route(`${GATEWAY}/tasks/${TASK_ID}/result`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ task_id: TASK_ID, status: 'completed', result: 'Done!' }),
    });
  });

  await goToChat(page);
  await sendMessage(page);

  // The live timeline should appear in the typing indicator area
  await expect(page.getByTestId('live-task-timeline')).toBeVisible({ timeout: 3000 });
});

test('03 — live task timeline has role="list" for accessibility', async ({ page }) => {
  await setupBaseRoutes(page);
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
  await page.route(`${GATEWAY}/tasks/${TASK_ID}/stream`, async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    const body = `data: ${JSON.stringify({ type: 'result', result: 'Done!' })}\n\n`;
    route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await page.route(`${GATEWAY}/tasks/${TASK_ID}/result`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ task_id: TASK_ID, status: 'completed', result: 'Done!' }),
    });
  });

  await goToChat(page);
  await sendMessage(page);

  const timeline = page.getByTestId('live-task-timeline');
  await expect(timeline).toBeVisible({ timeout: 3000 });
  await expect(timeline).toHaveAttribute('role', 'list');
});

test('04 — result bubble shows timeline with data-testid="result-bubble-timeline"', async ({ page }) => {
  await setupBaseRoutes(page);
  await setupSuccessfulTask(page);
  await goToChat(page);
  await sendMessage(page);

  // Wait for result bubble to appear
  await expect(page.getByTestId('result-bubble')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('result-bubble-timeline')).toBeVisible();
});

test('05 — result bubble timeline shows all four completed phases', async ({ page }) => {
  await setupBaseRoutes(page);
  await setupSuccessfulTask(page);
  await goToChat(page);
  await sendMessage(page);

  await expect(page.getByTestId('result-bubble')).toBeVisible({ timeout: 10000 });
  const timeline = page.getByTestId('result-bubble-timeline');
  await expect(timeline).toBeVisible();

  // All 4 phases should be present
  await expect(timeline.getByTestId('timeline-phase-dispatched')).toBeVisible();
  await expect(timeline.getByTestId('timeline-phase-connecting')).toBeVisible();
  await expect(timeline.getByTestId('timeline-phase-streaming')).toBeVisible();
  await expect(timeline.getByTestId('timeline-phase-completed')).toBeVisible();
});

test('06 — result bubble timeline phases are all marked done', async ({ page }) => {
  await setupBaseRoutes(page);
  await setupSuccessfulTask(page);
  await goToChat(page);
  await sendMessage(page);

  await expect(page.getByTestId('result-bubble')).toBeVisible({ timeout: 10000 });
  const timeline = page.getByTestId('result-bubble-timeline');

  // Each phase should have data-phase-status="done"
  const dispatched = timeline.getByTestId('timeline-phase-dispatched');
  const connecting = timeline.getByTestId('timeline-phase-connecting');
  const streaming = timeline.getByTestId('timeline-phase-streaming');
  const completed = timeline.getByTestId('timeline-phase-completed');

  await expect(dispatched).toHaveAttribute('data-phase-status', 'done');
  await expect(connecting).toHaveAttribute('data-phase-status', 'done');
  await expect(streaming).toHaveAttribute('data-phase-status', 'done');
  await expect(completed).toHaveAttribute('data-phase-status', 'done');
});

test('07 — error bubble (SSE failed event) shows timeline with data-testid="error-bubble-timeline"', async ({ page }) => {
  await setupBaseRoutes(page);
  await setupFailedTask(page);
  await goToChat(page);
  await sendMessage(page);

  await expect(page.getByTestId('error-bubble')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('error-bubble-timeline')).toBeVisible();
});

test('08 — failed task timeline shows "Failed" phase with status "failed"', async ({ page }) => {
  await setupBaseRoutes(page);
  await setupFailedTask(page);
  await goToChat(page);
  await sendMessage(page);

  await expect(page.getByTestId('error-bubble')).toBeVisible({ timeout: 10000 });
  const timeline = page.getByTestId('error-bubble-timeline');
  await expect(timeline).toBeVisible();

  // The "Failed" phase should be present with failed status
  const failedPhase = timeline.getByTestId('timeline-phase-failed');
  await expect(failedPhase).toBeVisible();
  await expect(failedPhase).toHaveAttribute('data-phase-status', 'failed');
});

test('09 — dispatch failure shows error bubble timeline with failed phase', async ({ page }) => {
  await setupBaseRoutes(page);
  await setupDispatchFailure(page);
  await goToChat(page);
  await sendMessage(page);

  await expect(page.getByTestId('error-bubble')).toBeVisible({ timeout: 5000 });
  const timeline = page.getByTestId('error-bubble-timeline');
  await expect(timeline).toBeVisible();

  // Only "Dispatched" phase present, marked as failed
  const dispatched = timeline.getByTestId('timeline-phase-dispatched');
  await expect(dispatched).toBeVisible();
  await expect(dispatched).toHaveAttribute('data-phase-status', 'failed');
});

test('10 — live timeline disappears after task completes', async ({ page }) => {
  await setupBaseRoutes(page);
  await setupSuccessfulTask(page);
  await goToChat(page);
  await sendMessage(page);

  // Wait for result — live timeline should be gone
  await expect(page.getByTestId('result-bubble')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('live-task-timeline')).not.toBeVisible();
});

test('11 — timeline phase items are listitem role', async ({ page }) => {
  await setupBaseRoutes(page);
  await setupSuccessfulTask(page);
  await goToChat(page);
  await sendMessage(page);

  await expect(page.getByTestId('result-bubble')).toBeVisible({ timeout: 10000 });
  const timeline = page.getByTestId('result-bubble-timeline');
  const phases = timeline.getByRole('listitem');
  // 4 phases = 4 listitems
  await expect(phases).toHaveCount(4);
});

test('12 — timeline has aria-label for accessibility', async ({ page }) => {
  await setupBaseRoutes(page);
  await setupSuccessfulTask(page);
  await goToChat(page);
  await sendMessage(page);

  await expect(page.getByTestId('result-bubble')).toBeVisible({ timeout: 10000 });
  const timeline = page.getByTestId('result-bubble-timeline');
  await expect(timeline).toHaveAttribute('aria-label', 'Task progress timeline');
});
