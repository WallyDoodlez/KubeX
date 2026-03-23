/**
 * E2E tests for OrchestratorChat — system messages visibility toggle
 * (Iteration 48)
 *
 * Covers:
 * 1.  System messages toggle button renders in the toolbar
 * 2.  By default, system messages are hidden (toggle starts as aria-pressed="false")
 * 3.  By default, system message bubbles are not visible in the chat
 * 4.  When system messages are hidden and there are some, the count badge shows correct number
 * 5.  Clicking the toggle shows system messages (aria-pressed becomes "true")
 * 6.  After toggling on, system message bubbles are visible
 * 7.  Count badge disappears when system messages are shown
 * 8.  Clicking the toggle again hides system messages
 * 9.  Non-system messages (user, result, error) are always visible regardless of toggle
 * 10. When role filter is set to "system", system messages are shown even if toggle is off
 * 11. Toggling system messages off while "All types" filter is active hides system messages
 * 12. The toggle button has correct aria-label when messages are hidden
 * 13. The toggle button has correct aria-label when messages are shown
 * 14. If there are no system messages, count badge is not rendered
 * 15. System messages created during a session cycle are toggled correctly
 */

import { test, expect } from '@playwright/test';

const CHAT_MESSAGES_KEY = 'kubex-chat-messages';

async function setupRoutes(page: import('@playwright/test').Page) {
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

async function goToChatWithMessages(
  page: import('@playwright/test').Page,
  messages: Array<{ id: string; role: string; content: string; timestamp: string; task_id?: string }>,
) {
  await setupRoutes(page);
  await page.addInitScript(
    ({ key, msgs }: { key: string; msgs: unknown[] }) => {
      localStorage.setItem(key, JSON.stringify(msgs));
    },
    { key: CHAT_MESSAGES_KEY, msgs: messages },
  );
  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');
}

function makeMessage(id: string, role: string, content: string, task_id?: string) {
  return { id, role, content, timestamp: new Date().toISOString(), ...(task_id ? { task_id } : {}) };
}

// ── Test: Toggle renders ──────────────────────────────────────────────────

test('1. system messages toggle button renders in the toolbar', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('s1', 'system', 'Task dispatched — ID: abc-123', 'abc-123')]);
  await expect(page.getByTestId('system-messages-toggle')).toBeVisible();
});

// ── Test: Default hidden state ────────────────────────────────────────────

test('2. toggle starts as aria-pressed="false" (system messages hidden by default)', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('s1', 'system', 'Task dispatched — ID: abc-123')]);
  const toggle = page.getByTestId('system-messages-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('3. system message bubbles are not visible by default', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('s1', 'system', 'Task dispatched — ID: abc-123')]);
  await expect(page.getByTestId('system-message')).not.toBeVisible();
});

test('4. hidden system messages count badge shows correct number', async ({ page }) => {
  await goToChatWithMessages(page, [
    makeMessage('s1', 'system', 'Task dispatched — ID: abc-123'),
    makeMessage('s2', 'system', 'Task dispatched — ID: def-456'),
    makeMessage('s3', 'system', 'Task dispatched — ID: ghi-789'),
  ]);
  const badge = page.getByTestId('system-messages-hidden-count');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('3');
});

// ── Test: Toggling on ────────────────────────────────────────────────────

test('5. clicking toggle shows system messages (aria-pressed becomes "true")', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('s1', 'system', 'Task dispatched — ID: abc-123')]);
  await page.getByTestId('system-messages-toggle').click();
  await expect(page.getByTestId('system-messages-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('6. after toggling on, system message bubbles are visible', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('s1', 'system', 'Task dispatched — ID: abc-123')]);
  await page.getByTestId('system-messages-toggle').click();
  await expect(page.getByTestId('system-message').first()).toBeVisible();
});

test('7. count badge disappears when system messages are shown', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('s1', 'system', 'Task dispatched — ID: abc-123')]);
  await page.getByTestId('system-messages-toggle').click();
  await expect(page.getByTestId('system-messages-hidden-count')).not.toBeVisible();
});

// ── Test: Toggling off again ──────────────────────────────────────────────

test('8. clicking toggle again hides system messages', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('s1', 'system', 'Task dispatched — ID: abc-123')]);
  // Toggle on
  await page.getByTestId('system-messages-toggle').click();
  await expect(page.getByTestId('system-message').first()).toBeVisible();
  // Toggle off
  await page.getByTestId('system-messages-toggle').click();
  await expect(page.getByTestId('system-message')).not.toBeVisible();
});

// ── Test: Non-system messages unaffected ─────────────────────────────────

test('9. non-system messages are always visible regardless of toggle state', async ({ page }) => {
  await goToChatWithMessages(page, [
    makeMessage('u1', 'user', 'Hello there'),
    makeMessage('s1', 'system', 'Task dispatched — ID: abc-123'),
    makeMessage('r1', 'result', 'The result is: 42'),
  ]);
  // System hidden by default
  await expect(page.getByTestId('system-message')).not.toBeVisible();
  // User and result should still be visible
  await expect(page.locator('text=Hello there')).toBeVisible();
  await expect(page.locator('text=The result is: 42')).toBeVisible();
});

// ── Test: Role filter "system" overrides toggle ───────────────────────────

test('10. when role filter is set to "system", system messages show even if toggle is off', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('s1', 'system', 'Task dispatched — ID: abc-123')]);
  // Toggle is off by default
  await expect(page.getByTestId('system-messages-toggle')).toHaveAttribute('aria-pressed', 'false');
  // Set role filter to "system"
  await page.getByTestId('chat-role-filter').selectOption('system');
  // System messages should now be visible because filter is explicitly "system"
  await expect(page.getByTestId('system-message').first()).toBeVisible();
});

// ── Test: Toggle with "All types" filter active ──────────────────────────

test('11. toggling system messages off with "All types" filter hides system bubbles', async ({ page }) => {
  await goToChatWithMessages(page, [
    makeMessage('u1', 'user', 'Hello'),
    makeMessage('s1', 'system', 'Task dispatched — ID: abc-123'),
  ]);
  // Enable system messages first
  await page.getByTestId('system-messages-toggle').click();
  await expect(page.getByTestId('system-message').first()).toBeVisible();
  // Toggle off — ensure role filter is "all"
  await expect(page.getByTestId('chat-role-filter')).toHaveValue('all');
  await page.getByTestId('system-messages-toggle').click();
  await expect(page.getByTestId('system-message')).not.toBeVisible();
  // User message still visible
  await expect(page.locator('text=Hello')).toBeVisible();
});

// ── Test: Aria-label text ────────────────────────────────────────────────

test('12. toggle aria-label says "Show system messages" when messages are hidden', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('s1', 'system', 'Task dispatched')]);
  const toggle = page.getByTestId('system-messages-toggle');
  await expect(toggle).toHaveAttribute('aria-label', 'Show system messages');
});

test('13. toggle aria-label says "Hide system messages" when messages are shown', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('s1', 'system', 'Task dispatched')]);
  await page.getByTestId('system-messages-toggle').click();
  await expect(page.getByTestId('system-messages-toggle')).toHaveAttribute('aria-label', 'Hide system messages');
});

// ── Test: No system messages ──────────────────────────────────────────────

test('14. count badge is not rendered when there are no system messages', async ({ page }) => {
  await goToChatWithMessages(page, [
    makeMessage('u1', 'user', 'Hello'),
    makeMessage('r1', 'result', 'Result text'),
  ]);
  await expect(page.getByTestId('system-messages-hidden-count')).not.toBeVisible();
});

// ── Test: Multiple system messages show correctly ─────────────────────────

test('15. multiple system messages all appear when toggle is enabled', async ({ page }) => {
  await goToChatWithMessages(page, [
    makeMessage('s1', 'system', 'Task dispatched — ID: task-001'),
    makeMessage('s2', 'system', 'Task dispatched — ID: task-002'),
    makeMessage('s3', 'system', 'Task dispatched — ID: task-003'),
  ]);
  await page.getByTestId('system-messages-toggle').click();
  const systemBubbles = page.getByTestId('system-message');
  await expect(systemBubbles).toHaveCount(3);
});
