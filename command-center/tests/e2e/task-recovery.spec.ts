/**
 * E2E tests for OrchestratorChat — Task recovery on navigation (BUG-004)
 *
 * Covers:
 * 1.  When `kubex-active-task` exists in localStorage on mount, component enters sending state
 * 2.  When no `kubex-active-task` in localStorage, component starts normally (welcome state)
 * 3.  Stale task (>5 min old) triggers poll instead of SSE reconnect
 * 4.  `kubex-active-task` is removed after a result message appears
 */

import { test, expect } from '@playwright/test';

const GATEWAY = 'http://localhost:8080';
const RECOVERY_TASK_ID = 'recovery-task-004';

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

// ── 1. kubex-active-task in localStorage → component enters sending state ────

test('1. when kubex-active-task exists in localStorage on mount, component enters sending state', async ({ page }) => {
  await setupBaseRoutes(page);

  // Route a non-terminating SSE stream so sending stays true
  await page.route(`${GATEWAY}/tasks/${RECOVERY_TASK_ID}/stream`, (route) => {
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
  });

  // Inject the active task into localStorage before navigating to the chat page
  const recentStartedAt = new Date().toISOString();
  await page.addInitScript((args) => {
    const { taskId, startedAt } = args;
    localStorage.setItem(
      'kubex-active-task',
      JSON.stringify({ taskId, capability: 'task_orchestration', message: 'Recover me', startedAt }),
    );
  }, { taskId: RECOVERY_TASK_ID, startedAt: recentStartedAt });

  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');

  // The typing indicator should appear because recovery reconnects SSE and sets sending=true
  await expect(page.locator('[data-testid="typing-indicator"]')).toBeVisible({ timeout: 10_000 });
});

// ── 2. No kubex-active-task → normal welcome state ───────────────────────────

test('2. when no kubex-active-task in localStorage, component starts normally in welcome state', async ({ page }) => {
  await setupBaseRoutes(page);

  // Explicitly clear any lingering recovery state before navigating
  await page.addInitScript(() => {
    localStorage.removeItem('kubex-active-task');
  });

  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');

  // No typing indicator — nothing is sending
  await expect(page.locator('[data-testid="typing-indicator"]')).not.toBeVisible();

  // Welcome message should be visible
  await expect(page.locator('text=KubexClaw Command Center')).toBeVisible();
});

// ── 3. Stale task (>5 min) triggers poll, not SSE reconnect ─────────────────

test('3. stale task (older than 5 minutes) triggers result poll instead of SSE reconnect', async ({ page }) => {
  await setupBaseRoutes(page);

  // Track which endpoints are called
  const streamRequests: string[] = [];
  const resultRequests: string[] = [];

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes(`/tasks/${RECOVERY_TASK_ID}/stream`)) streamRequests.push(url);
    if (url.includes(`/tasks/${RECOVERY_TASK_ID}/result`)) resultRequests.push(url);
  });

  // Route a completed result response for the poll
  await page.route(`${GATEWAY}/tasks/${RECOVERY_TASK_ID}/result`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        task_id: RECOVERY_TASK_ID,
        status: 'completed',
        result: 'Recovered stale result',
      }),
    });
  });

  // Stale task: started more than 5 minutes ago
  const staleStartedAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  await page.addInitScript((args) => {
    const { taskId, startedAt } = args;
    localStorage.setItem(
      'kubex-active-task',
      JSON.stringify({ taskId, capability: 'task_orchestration', message: 'Old task', startedAt }),
    );
  }, { taskId: RECOVERY_TASK_ID, startedAt: staleStartedAt });

  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');

  // Wait for poll to complete and result bubble to appear
  await expect(page.locator('[data-testid="result-bubble"]').first()).toBeVisible({ timeout: 10_000 });

  // The SSE stream endpoint should NOT have been requested (poll path taken)
  expect(streamRequests.length).toBe(0);
  // The result endpoint SHOULD have been polled
  expect(resultRequests.length).toBeGreaterThanOrEqual(1);
});

// ── 4. kubex-active-task is removed after result appears ────────────────────

test('4. kubex-active-task is removed from localStorage after result message appears', async ({ page }) => {
  await setupBaseRoutes(page);

  // Route dispatch success + instant SSE result
  await page.route(`${GATEWAY}/actions`, (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ task_id: RECOVERY_TASK_ID, status: 'dispatched' }),
      });
    } else {
      route.continue();
    }
  });
  await page.route(`${GATEWAY}/tasks/${RECOVERY_TASK_ID}/stream`, (route) => {
    const body = `data: ${JSON.stringify({ type: 'result', result: 'Task done!' })}\n\n`;
    route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await page.route(`${GATEWAY}/tasks/${RECOVERY_TASK_ID}/result`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ task_id: RECOVERY_TASK_ID, status: 'completed', result: 'Task done!' }),
    });
  });

  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');

  // Send a task
  await page.locator('[data-testid="message-input"]').fill('Check system health');
  await page.locator('button', { hasText: 'Send' }).click();

  // Wait for result bubble to appear
  await expect(page.locator('[data-testid="result-bubble"]')).toBeVisible({ timeout: 15_000 });

  // kubex-active-task must be gone
  const stored = await page.evaluate(() => localStorage.getItem('kubex-active-task'));
  expect(stored).toBeNull();
});
