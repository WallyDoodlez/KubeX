/**
 * Dual-mode assertion helpers for E2E tests.
 *
 * These functions work correctly in BOTH mock mode and live mode:
 *   - Mock mode: asserts exact content (text, IDs, etc.)
 *   - Live mode: asserts structure only (element exists, is visible)
 *
 * Import from './helpers' (barrel re-export).
 */

import { expect, type Page } from '@playwright/test';
import { isMockMode } from './config';

// ── Result / Error bubbles ──────────────────────────────────────────────────

/**
 * Wait for any result bubble to appear (any text content).
 * Use this when you only need to verify a result was received, not its content.
 */
export async function expectAnyResultBubble(page: Page, timeout = 20_000): Promise<void> {
  await expect(page.locator('[data-testid="result-bubble"]').first()).toBeVisible({ timeout });
}

/**
 * Wait for any error bubble to appear.
 * Use this when you only need to verify a failure was surfaced, not its content.
 */
export async function expectAnyErrorBubble(page: Page, timeout = 15_000): Promise<void> {
  await expect(page.locator('p.text-red-400', { hasText: 'Error' }).first()).toBeVisible({ timeout });
}

/**
 * Assert a result text — exact in mock mode, structural (bubble visible) in live mode.
 *
 * @param exactMockText - The exact text to assert in mock mode.
 * @param timeout - Timeout in ms. Use generous values for live mode (tasks take real time).
 */
export async function expectResultText(
  page: Page,
  exactMockText: string,
  timeout = 20_000,
): Promise<void> {
  if (isMockMode) {
    await expect(page.locator(`text=${exactMockText}`).first()).toBeVisible({ timeout });
  } else {
    await expectAnyResultBubble(page, timeout);
  }
}

/**
 * Assert an error text — exact in mock mode, structural (error bubble visible) in live mode.
 *
 * @param exactMockText - The exact text to assert in mock mode.
 * @param timeout - Timeout in ms.
 */
export async function expectErrorText(
  page: Page,
  exactMockText: string,
  timeout = 15_000,
): Promise<void> {
  if (isMockMode) {
    await expect(page.locator(`text=${exactMockText}`).first()).toBeVisible({ timeout });
  } else {
    await expectAnyErrorBubble(page, timeout);
  }
}

// ── Task dispatch / streaming states ───────────────────────────────────────

/**
 * Verify the typing indicator appears after a task is dispatched.
 * Works in both modes — in live mode tasks take real time, use generous timeout.
 */
export async function expectTaskDispatched(page: Page, timeout = 15_000): Promise<void> {
  await expect(page.locator('[data-testid="typing-indicator"]')).toBeVisible({ timeout });
}

/**
 * Wait for the sending state to complete (typing indicator gone).
 * In live mode real tasks may take longer — use a generous timeout.
 */
export async function expectSendingComplete(page: Page, timeout = 60_000): Promise<void> {
  await expect(page.locator('[data-testid="typing-indicator"]')).not.toBeVisible({ timeout });
}

// ── Result bubble structure ─────────────────────────────────────────────────

/**
 * Assert that a result bubble has a task ID displayed.
 * In mock mode, assert the exact task ID. In live mode, just verify the element is present.
 */
export async function expectResultTaskId(
  page: Page,
  mockTaskId: string,
  timeout = 20_000,
): Promise<void> {
  await expectAnyResultBubble(page, timeout);
  const taskIdEl = page.locator('[data-testid="result-task-id"]').first();
  await expect(taskIdEl).toBeVisible({ timeout: 5_000 });
  if (isMockMode) {
    await expect(taskIdEl).toHaveText(mockTaskId);
  }
  // In live mode: just verify any task ID is shown (non-empty)
  const text = await taskIdEl.textContent();
  expect(text?.trim().length).toBeGreaterThan(0);
}

// ── Timeline assertions ─────────────────────────────────────────────────────

/**
 * Assert that the result bubble timeline is visible with the expected number of phases.
 * In live mode, only verifies the timeline container is present (phase count may vary).
 */
export async function expectResultBubbleTimeline(
  page: Page,
  expectedPhaseCount = 4,
  timeout = 20_000,
): Promise<void> {
  await expectAnyResultBubble(page, timeout);
  const timeline = page.getByTestId('result-bubble-timeline');
  await expect(timeline).toBeVisible({ timeout: 5_000 });
  if (isMockMode) {
    const phases = timeline.getByRole('listitem');
    await expect(phases).toHaveCount(expectedPhaseCount);
  }
}

/**
 * Assert that a specific timeline phase has the expected status.
 * In live mode, only verifies the phase element is present (status may vary).
 */
export async function expectTimelinePhase(
  page: Page,
  phaseTestId: string,
  mockExpectedStatus: string,
): Promise<void> {
  const phase = page.getByTestId(phaseTestId);
  await expect(phase).toBeVisible({ timeout: 5_000 });
  if (isMockMode) {
    await expect(phase).toHaveAttribute('data-phase-status', mockExpectedStatus);
  }
}

// ── SSE result label assertion ──────────────────────────────────────────────

/**
 * Verify the "Result" label (emerald badge) is visible on a result bubble.
 * Works in both modes since this is a structural check, not content-specific.
 */
export async function expectResultLabel(page: Page, timeout = 20_000): Promise<void> {
  await expect(
    page.locator('span.text-emerald-400', { hasText: 'Result' }).first(),
  ).toBeVisible({ timeout });
}
