/**
 * E2E tests for OrchestratorChat — Task audit trail viewer
 * (Iteration 52)
 *
 * Covers:
 * 1.  Audit trail toggle is visible on result bubbles that have a task_id
 * 2.  Audit trail toggle is NOT visible on result bubbles without a task_id
 * 3.  Audit trail toggle is visible on error bubbles that have a task_id
 * 4.  Clicking the toggle expands the audit-trail-entries panel
 * 5.  After expanding, audit entries render with event_type and timestamp
 * 6.  API failure shows audit-trail-error state
 * 7.  Empty audit response shows audit-trail-empty state
 * 8.  Audit trail is collapsed by default (entries panel not visible)
 * 9.  Audit trail toggle has aria-expanded="false" when collapsed
 * 10. Audit trail toggle has aria-expanded="true" when expanded
 */

import { test, expect } from '@playwright/test';
import { isLiveMode, GATEWAY, mockBaseRoutes, mockTaskAudit } from './helpers';

const CHAT_MESSAGES_KEY = 'kubex-chat-messages';
const TASK_ID = 'audit-task-52';

async function goToChatWithMessages(
  page: import('@playwright/test').Page,
  messages: unknown[],
) {
  await page.addInitScript(
    ({ key, msgs }: { key: string; msgs: unknown[] }) => {
      localStorage.setItem(key, JSON.stringify(msgs));
    },
    { key: CHAT_MESSAGES_KEY, msgs: messages },
  );
  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');
}

function makeResultMessage(id: string, content: string, taskId?: string) {
  return {
    id,
    role: 'result',
    content,
    timestamp: new Date().toISOString(),
    task_id: taskId,
  };
}

function makeErrorMessage(id: string, content: string, taskId?: string) {
  return {
    id,
    role: 'error',
    content,
    timestamp: new Date().toISOString(),
    task_id: taskId,
    retryCapability: undefined,
    retryMessage: undefined,
  };
}

const SAMPLE_ENTRIES = [
  {
    event_type: 'task_started',
    timestamp: '2026-03-23T10:00:00Z',
    details: 'Task dispatched to agent',
  },
  {
    event_type: 'hook_pre_task',
    timestamp: '2026-03-23T10:00:01Z',
    hook_name: 'policy-check',
    status: 0,
  },
  {
    event_type: 'task_completed',
    timestamp: '2026-03-23T10:00:05Z',
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

test('1. audit trail toggle is visible on result bubble with task_id', async ({ page }) => {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await mockTaskAudit(page, TASK_ID, SAMPLE_ENTRIES);
  await goToChatWithMessages(page, [
    makeResultMessage('r1', 'Task result content', TASK_ID),
  ]);
  await expect(page.getByTestId('audit-trail-toggle').first()).toBeVisible();
});

test('2. audit trail toggle is NOT visible on result bubble without task_id', async ({ page }) => {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await goToChatWithMessages(page, [
    makeResultMessage('r1', 'Task result content'),
  ]);
  await expect(page.getByTestId('audit-trail-toggle')).not.toBeVisible();
});

test('3. audit trail toggle is visible on error bubble with task_id', async ({ page }) => {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await mockTaskAudit(page, TASK_ID, SAMPLE_ENTRIES);
  await goToChatWithMessages(page, [
    makeErrorMessage('e1', 'Task failed: some error', TASK_ID),
  ]);
  await expect(page.getByTestId('audit-trail-toggle').first()).toBeVisible();
});

test('4. clicking toggle expands audit-trail-entries panel', async ({ page }) => {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await mockTaskAudit(page, TASK_ID, SAMPLE_ENTRIES);
  await goToChatWithMessages(page, [
    makeResultMessage('r1', 'Task result content', TASK_ID),
  ]);

  // Entries panel not visible initially
  await expect(page.getByTestId('audit-trail-entries').first()).not.toBeVisible();

  // Click toggle
  await page.getByTestId('audit-trail-toggle').first().click();

  // Entries panel is now visible
  await expect(page.getByTestId('audit-trail-entries').first()).toBeVisible();
});

test('5. audit entries render with event_type and timestamp', async ({ page }) => {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await mockTaskAudit(page, TASK_ID, SAMPLE_ENTRIES);
  await goToChatWithMessages(page, [
    makeResultMessage('r1', 'Task result content', TASK_ID),
  ]);

  await page.getByTestId('audit-trail-toggle').first().click();

  // Wait for entries to load
  await expect(page.getByTestId('audit-entry').first()).toBeVisible({ timeout: 5000 });

  // Should have all 3 entries
  const entries = page.getByTestId('audit-entry');
  await expect(entries).toHaveCount(3);

  // First entry should show event_type
  const firstEntryType = page.getByTestId('audit-entry-type').first();
  await expect(firstEntryType).toContainText('task_started');

  // First entry should show timestamp
  const firstEntryTimestamp = page.getByTestId('audit-entry-timestamp').first();
  await expect(firstEntryTimestamp).toContainText('2026-03-23T10:00:00Z');
});

test('6. API failure shows audit-trail-error state', async ({ page }) => {
  test.skip(isLiveMode, '503 error simulation only works in mock mode');

  await mockBaseRoutes(page, { agents: [], kubexes: [] });

  // Custom inline route — 503 can't be generalized via mockTaskAudit
  await page.route(`${GATEWAY}/tasks/${TASK_ID}/audit`, (route) => {
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Redis unavailable' }),
    });
  });

  await goToChatWithMessages(page, [
    makeResultMessage('r1', 'Task result content', TASK_ID),
  ]);

  await page.getByTestId('audit-trail-toggle').first().click();

  // Error message appears
  await expect(page.getByTestId('audit-trail-error').first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('audit-trail-error').first()).toContainText('Failed to load audit trail');
});

test('7. empty audit response shows audit-trail-empty state', async ({ page }) => {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await mockTaskAudit(page, TASK_ID, []); // empty entries
  await goToChatWithMessages(page, [
    makeResultMessage('r1', 'Task result content', TASK_ID),
  ]);

  await page.getByTestId('audit-trail-toggle').first().click();

  // Empty state message appears
  await expect(page.getByTestId('audit-trail-empty').first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('audit-trail-empty').first()).toContainText('No audit events recorded');
});

test('8. audit trail entries panel is not visible by default (collapsed)', async ({ page }) => {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await mockTaskAudit(page, TASK_ID, SAMPLE_ENTRIES);
  await goToChatWithMessages(page, [
    makeResultMessage('r1', 'Task result content', TASK_ID),
  ]);

  // Entries panel should not be visible without clicking the toggle
  await expect(page.getByTestId('audit-trail-entries')).not.toBeVisible();
});

test('9. audit trail toggle has aria-expanded="false" when collapsed', async ({ page }) => {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await mockTaskAudit(page, TASK_ID, SAMPLE_ENTRIES);
  await goToChatWithMessages(page, [
    makeResultMessage('r1', 'Task result content', TASK_ID),
  ]);

  const toggle = page.getByTestId('audit-trail-toggle').first();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('10. audit trail toggle has aria-expanded="true" when expanded', async ({ page }) => {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await mockTaskAudit(page, TASK_ID, SAMPLE_ENTRIES);
  await goToChatWithMessages(page, [
    makeResultMessage('r1', 'Task result content', TASK_ID),
  ]);

  const toggle = page.getByTestId('audit-trail-toggle').first();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});
