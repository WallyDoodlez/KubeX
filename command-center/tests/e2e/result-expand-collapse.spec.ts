/**
 * E2E tests for OrchestratorChat — result bubble expand/collapse
 * (Iteration 47)
 *
 * Covers:
 * 1.  Short result bubble (< 8 lines) shows no "Show more" button
 * 2.  Short result bubble content is fully visible (no collapse wrapper height clipping)
 * 3.  Long result bubble (> 8 lines) starts collapsed — "Show more" button is visible
 * 4.  Long result bubble starts with data-expanded="false" on content wrapper
 * 5.  Long result bubble shows a "X lines hidden" indicator when collapsed
 * 6.  Clicking "Show more" expands the bubble — data-expanded becomes "true"
 * 7.  After expanding, a "Show less" button replaces "Show more"
 * 8.  After expanding, the "X lines hidden" indicator disappears
 * 9.  Clicking "Show less" re-collapses the bubble — data-expanded becomes "false"
 * 10. After re-collapsing, "Show more" button is visible again
 * 11. Gradient fade overlay is visible when collapsed
 * 12. Gradient fade overlay is NOT visible when expanded
 * 13. result-bubble has data-testid="result-bubble"
 * 14. Multiple long result bubbles each maintain independent expand/collapse state
 * 15. Short and long result bubbles can coexist — short has no toggle, long has toggle
 */

import { test, expect } from '@playwright/test';
import { mockBaseRoutes } from './helpers';

const CHAT_MESSAGES_KEY = 'kubex-chat-messages';

// 8 lines = COLLAPSE_LINE_THRESHOLD. Use 3 lines for "short" and 15 for "long".
const SHORT_CONTENT = 'Line 1\nLine 2\nLine 3';
const LONG_CONTENT = Array.from({ length: 15 }, (_, i) => `Line ${i + 1}: This is a longer line of content to ensure proper rendering in the bubble.`).join('\n');

async function goToChatWithMessages(
  page: import('@playwright/test').Page,
  messages: Array<{ id: string; role: string; content: string; timestamp: string }>,
) {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await page.addInitScript(
    ({ key, msgs }: { key: string; msgs: unknown[] }) => {
      localStorage.setItem(key, JSON.stringify(msgs));
    },
    { key: CHAT_MESSAGES_KEY, msgs: messages },
  );
  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');
}

function makeMessage(id: string, role: string, content: string) {
  return { id, role, content, timestamp: new Date().toISOString() };
}

// ── Test: Short result bubble ─────────────────────────────────────────────

test('1. short result bubble shows no "Show more" button', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('r1', 'result', SHORT_CONTENT)]);
  await expect(page.getByTestId('result-show-more')).not.toBeVisible();
});

test('2. short result bubble content wrapper has data-expanded="true"', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('r1', 'result', SHORT_CONTENT)]);
  const wrapper = page.getByTestId('result-content-wrapper');
  await expect(wrapper).toHaveAttribute('data-expanded', 'true');
});

// ── Test: Long result bubble (collapsed by default) ───────────────────────

test('3. long result bubble has "Show more" button visible by default', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('r1', 'result', LONG_CONTENT)]);
  await expect(page.getByTestId('result-show-more')).toBeVisible();
});

test('4. long result bubble content wrapper starts with data-expanded="false"', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('r1', 'result', LONG_CONTENT)]);
  const wrapper = page.getByTestId('result-content-wrapper');
  await expect(wrapper).toHaveAttribute('data-expanded', 'false');
});

test('5. collapsed long result bubble shows "lines hidden" indicator', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('r1', 'result', LONG_CONTENT)]);
  const indicator = page.getByTestId('result-hidden-lines');
  await expect(indicator).toBeVisible();
  // Should contain a number
  const text = await indicator.textContent();
  expect(text).toMatch(/\d+\s*lines hidden/);
});

// ── Test: Expanding ───────────────────────────────────────────────────────

test('6. clicking "Show more" sets data-expanded to "true"', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('r1', 'result', LONG_CONTENT)]);
  await page.getByTestId('result-show-more').click();
  await expect(page.getByTestId('result-content-wrapper')).toHaveAttribute('data-expanded', 'true');
});

test('7. after expanding, "Show less" button is visible and "Show more" is gone', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('r1', 'result', LONG_CONTENT)]);
  await page.getByTestId('result-show-more').click();
  await expect(page.getByTestId('result-show-less')).toBeVisible();
  await expect(page.getByTestId('result-show-more')).not.toBeVisible();
});

test('8. "lines hidden" indicator disappears after expanding', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('r1', 'result', LONG_CONTENT)]);
  await page.getByTestId('result-show-more').click();
  await expect(page.getByTestId('result-hidden-lines')).not.toBeVisible();
});

// ── Test: Collapsing ──────────────────────────────────────────────────────

test('9. clicking "Show less" re-collapses — data-expanded becomes "false"', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('r1', 'result', LONG_CONTENT)]);
  await page.getByTestId('result-show-more').click();
  await page.getByTestId('result-show-less').click();
  await expect(page.getByTestId('result-content-wrapper')).toHaveAttribute('data-expanded', 'false');
});

test('10. after re-collapsing, "Show more" button is visible again', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('r1', 'result', LONG_CONTENT)]);
  await page.getByTestId('result-show-more').click();
  await page.getByTestId('result-show-less').click();
  await expect(page.getByTestId('result-show-more')).toBeVisible();
});

// ── Test: Gradient fade overlay ───────────────────────────────────────────

test('11. gradient fade overlay is visible when long result is collapsed', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('r1', 'result', LONG_CONTENT)]);
  await expect(page.getByTestId('result-collapse-fade')).toBeAttached();
});

test('12. gradient fade overlay is not present when long result is expanded', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('r1', 'result', LONG_CONTENT)]);
  await page.getByTestId('result-show-more').click();
  await expect(page.getByTestId('result-collapse-fade')).not.toBeAttached();
});

// ── Test: data-testid on result bubble ────────────────────────────────────

test('13. result bubble has data-testid="result-bubble"', async ({ page }) => {
  await goToChatWithMessages(page, [makeMessage('r1', 'result', SHORT_CONTENT)]);
  await expect(page.getByTestId('result-bubble')).toBeVisible();
});

// ── Test: Multiple independent bubbles ────────────────────────────────────

test('14. two long result bubbles maintain independent expand/collapse state', async ({ page }) => {
  await goToChatWithMessages(page, [
    makeMessage('r1', 'result', LONG_CONTENT),
    makeMessage('r2', 'result', LONG_CONTENT),
  ]);

  // Both start collapsed
  const wrappers = page.getByTestId('result-content-wrapper');
  await expect(wrappers.nth(0)).toHaveAttribute('data-expanded', 'false');
  await expect(wrappers.nth(1)).toHaveAttribute('data-expanded', 'false');

  // Expand only the first
  const showMoreButtons = page.getByTestId('result-show-more');
  await showMoreButtons.first().click();

  // First is expanded, second is still collapsed
  await expect(wrappers.nth(0)).toHaveAttribute('data-expanded', 'true');
  await expect(wrappers.nth(1)).toHaveAttribute('data-expanded', 'false');
});

test('15. short and long result bubbles coexist — short has no toggle, long has toggle', async ({ page }) => {
  await goToChatWithMessages(page, [
    makeMessage('r1', 'result', SHORT_CONTENT),
    makeMessage('r2', 'result', LONG_CONTENT),
  ]);

  // Short bubble: no show-more visible for the first wrapper
  const wrappers = page.getByTestId('result-content-wrapper');
  await expect(wrappers.nth(0)).toHaveAttribute('data-expanded', 'true'); // short → always expanded
  await expect(wrappers.nth(1)).toHaveAttribute('data-expanded', 'false'); // long → starts collapsed

  // Only one show-more button visible (for the long bubble)
  const showMoreButtons = page.getByTestId('result-show-more');
  await expect(showMoreButtons).toHaveCount(1);
});
