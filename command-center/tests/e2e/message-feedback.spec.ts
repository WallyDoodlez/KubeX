/**
 * E2E tests for OrchestratorChat — message feedback (thumbs up / down)
 * (Iteration 53)
 *
 * Covers:
 * 1.  Feedback widget is absent before any result is dispatched
 * 2.  Feedback widget appears on result bubble after dispatch
 * 3.  "Helpful?" label is visible in the feedback widget
 * 4.  Thumbs-up button is present with correct aria-label
 * 5.  Thumbs-down button is present with correct aria-label
 * 6.  Clicking thumbs-up shows "Marked helpful" confirmation label
 * 7.  Clicking thumbs-down shows "Marked not helpful" confirmation label
 * 8.  Clicking thumbs-up a second time removes the vote (toggle off)
 * 9.  Clicking thumbs-down a second time removes the vote (toggle off)
 * 10. Switching from thumbs-up to thumbs-down updates the vote
 * 11. Feedback is persisted to localStorage after thumbs-up
 * 12. Feedback is persisted to localStorage after thumbs-down
 * 13. Feedback label is absent when no vote has been cast
 * 14. aria-pressed reflects the current vote state
 * 15. Feedback widget has correct data-testid attribute
 */

import { test, expect } from '@playwright/test';
import { mockBaseRoutes, mockDispatch, mockSSEStream, MOCK_SSE_RESULT } from './helpers';

const TASK_ID = 'mock-task-feedback-1';
const RESULT_TEXT = 'Feedback test result content';

async function dispatchAndGetResult(page: import('@playwright/test').Page) {
  await mockDispatch(page, TASK_ID);
  await mockSSEStream(page, TASK_ID, MOCK_SSE_RESULT(TASK_ID, RESULT_TEXT));

  await page.locator('[data-testid="message-input"]').fill('test message for feedback');
  await page.locator('button', { hasText: 'Send' }).click();

  // Wait for result bubble
  await expect(page.locator('[data-testid="result-bubble"]')).toBeVisible({ timeout: 10_000 });
}

// DISABLED: MessageFeedback UI removed — awaiting POST /tasks/{id}/feedback backend endpoint
test.describe.skip('OrchestratorChat — message feedback reactions (Iteration 53)', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page, { agents: [], kubexes: [] });
    await page.goto('/chat');
  });

  // ── Presence tests ────────────────────────────────────────────────────────

  test('feedback widget is absent before any result is dispatched', async ({ page }) => {
    await expect(page.locator('[data-testid="message-feedback"]')).not.toBeVisible();
  });

  test('feedback widget appears on result bubble after dispatch', async ({ page }) => {
    await dispatchAndGetResult(page);
    const resultBubble = page.locator('[data-testid="result-bubble"]').first();
    await expect(resultBubble.locator('[data-testid="message-feedback"]')).toBeVisible();
  });

  test('feedback widget has correct data-testid', async ({ page }) => {
    await dispatchAndGetResult(page);
    await expect(page.locator('[data-testid="message-feedback"]')).toBeAttached();
  });

  test('"Helpful?" label is visible in the feedback widget', async ({ page }) => {
    await dispatchAndGetResult(page);
    const widget = page.locator('[data-testid="message-feedback"]').first();
    await expect(widget).toContainText('Helpful?');
  });

  // ── Button presence and accessibility ─────────────────────────────────────

  test('thumbs-up button is present with correct aria-label', async ({ page }) => {
    await dispatchAndGetResult(page);
    const upBtn = page.locator('[data-testid="feedback-up"]').first();
    await expect(upBtn).toBeVisible();
    await expect(upBtn).toHaveAttribute('aria-label', 'Mark as helpful');
  });

  test('thumbs-down button is present with correct aria-label', async ({ page }) => {
    await dispatchAndGetResult(page);
    const downBtn = page.locator('[data-testid="feedback-down"]').first();
    await expect(downBtn).toBeVisible();
    await expect(downBtn).toHaveAttribute('aria-label', 'Mark as not helpful');
  });

  test('feedback confirmation label is absent before any vote is cast', async ({ page }) => {
    await dispatchAndGetResult(page);
    await expect(page.locator('[data-testid="feedback-label"]')).not.toBeVisible();
  });

  // ── Voting behaviour ──────────────────────────────────────────────────────

  test('clicking thumbs-up shows "Marked helpful" confirmation label', async ({ page }) => {
    await dispatchAndGetResult(page);
    await page.locator('[data-testid="feedback-up"]').first().click();
    await expect(page.locator('[data-testid="feedback-label"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="feedback-label"]').first()).toContainText('Marked helpful');
  });

  test('clicking thumbs-down shows "Marked not helpful" confirmation label', async ({ page }) => {
    await dispatchAndGetResult(page);
    await page.locator('[data-testid="feedback-down"]').first().click();
    await expect(page.locator('[data-testid="feedback-label"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="feedback-label"]').first()).toContainText('Marked not helpful');
  });

  test('clicking thumbs-up a second time removes the vote (toggle off)', async ({ page }) => {
    await dispatchAndGetResult(page);
    const upBtn = page.locator('[data-testid="feedback-up"]').first();
    await upBtn.click();
    // Vote is set
    await expect(page.locator('[data-testid="feedback-label"]').first()).toBeVisible();
    // Click again to remove
    await upBtn.click();
    await expect(page.locator('[data-testid="feedback-label"]')).not.toBeVisible();
  });

  test('clicking thumbs-down a second time removes the vote (toggle off)', async ({ page }) => {
    await dispatchAndGetResult(page);
    const downBtn = page.locator('[data-testid="feedback-down"]').first();
    await downBtn.click();
    // Vote is set
    await expect(page.locator('[data-testid="feedback-label"]').first()).toBeVisible();
    // Click again to remove
    await downBtn.click();
    await expect(page.locator('[data-testid="feedback-label"]')).not.toBeVisible();
  });

  test('switching from thumbs-up to thumbs-down updates the vote', async ({ page }) => {
    await dispatchAndGetResult(page);
    await page.locator('[data-testid="feedback-up"]').first().click();
    await expect(page.locator('[data-testid="feedback-label"]').first()).toContainText('Marked helpful');

    // Switch to down
    await page.locator('[data-testid="feedback-down"]').first().click();
    await expect(page.locator('[data-testid="feedback-label"]').first()).toContainText('Marked not helpful');
  });

  // ── aria-pressed state ────────────────────────────────────────────────────

  test('thumbs-up aria-pressed is false before voting', async ({ page }) => {
    await dispatchAndGetResult(page);
    const upBtn = page.locator('[data-testid="feedback-up"]').first();
    await expect(upBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('thumbs-up aria-pressed is true after voting up', async ({ page }) => {
    await dispatchAndGetResult(page);
    await page.locator('[data-testid="feedback-up"]').first().click();
    await expect(page.locator('[data-testid="feedback-up"]').first()).toHaveAttribute('aria-pressed', 'true');
  });

  test('thumbs-down aria-pressed is true after voting down', async ({ page }) => {
    await dispatchAndGetResult(page);
    await page.locator('[data-testid="feedback-down"]').first().click();
    await expect(page.locator('[data-testid="feedback-down"]').first()).toHaveAttribute('aria-pressed', 'true');
  });

  // ── localStorage persistence ──────────────────────────────────────────────

  test('feedback is persisted to localStorage after thumbs-up vote', async ({ page }) => {
    await dispatchAndGetResult(page);
    await page.locator('[data-testid="feedback-up"]').first().click();

    // Check localStorage
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('kubex-chat-feedback');
      return raw ? JSON.parse(raw) : {};
    });
    // At least one entry should be 'up'
    expect(Object.values(stored)).toContain('up');
  });

  test('feedback is persisted to localStorage after thumbs-down vote', async ({ page }) => {
    await dispatchAndGetResult(page);
    await page.locator('[data-testid="feedback-down"]').first().click();

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('kubex-chat-feedback');
      return raw ? JSON.parse(raw) : {};
    });
    expect(Object.values(stored)).toContain('down');
  });

  test('feedback is removed from localStorage after toggling off', async ({ page }) => {
    await dispatchAndGetResult(page);
    const upBtn = page.locator('[data-testid="feedback-up"]').first();
    await upBtn.click();
    await upBtn.click(); // toggle off

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('kubex-chat-feedback');
      return raw ? JSON.parse(raw) : {};
    });
    expect(Object.values(stored)).not.toContain('up');
  });
});
