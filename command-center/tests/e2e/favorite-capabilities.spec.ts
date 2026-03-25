/**
 * E2E tests for OrchestratorChat — Favorite capabilities
 * (Iteration 89)
 *
 * Covers:
 * 1.  Star button renders next to each known cap in the Advanced panel
 * 2.  Clicking star on an unstarred cap stars it (★) and persists to localStorage
 * 3.  Starred caps appear in the Favorites section at the top of the Advanced panel
 * 4.  Clicking star again on a starred cap removes it from favorites
 * 5.  Favorites section has data-testid="favorite-caps-section"
 * 6.  Quick-access bar (data-testid="quick-caps-bar") is hidden when no favorites exist
 * 7.  Quick-access bar appears below input when Advanced panel is COLLAPSED and favorites exist
 * 8.  Quick-access bar disappears when Advanced panel is OPEN
 * 9.  Clicking a quick-cap pill sets the capability for the next send
 * 10. Quick-cap pills have correct data-testid
 * 11. Favorites persist across page reload (localStorage)
 * 12. Star buttons have correct data-testid="cap-star-{capName}"
 */

import { test, expect } from '@playwright/test';
import { mockBaseRoutes, isLiveMode, GATEWAY } from './helpers';

// Agents with known capabilities to test with
const AGENTS_WITH_CAPS = [
  {
    agent_id: 'agent-alpha-001',
    capabilities: ['task_orchestration', 'knowledge_management', 'code_review'],
    status: 'running',
    boundary: 'internal',
    registered_at: '2026-03-22T08:00:00Z',
    metadata: { version: '1.0.0' },
  },
];

async function goToChat(page: import('@playwright/test').Page) {
  await mockBaseRoutes(page, { agents: AGENTS_WITH_CAPS, kubexes: [] });
  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');
  // Clear favorites so each test starts with a clean slate
  await page.evaluate(() => localStorage.removeItem('kubex-favorite-caps'));
}

async function openAdvanced(page: import('@playwright/test').Page) {
  const toggle = page.locator('[data-testid="advanced-toggle"]');
  const panel = page.locator('[data-testid="advanced-panel"]');
  const isOpen = await panel.isVisible().catch(() => false);
  if (!isOpen) await toggle.click();
  await expect(panel).toBeVisible();
}

// goToChat clears kubex-favorite-caps after navigation so tests start clean

// ── 1. Star buttons render next to each known cap ─────────────────────────────

test('1. star button renders next to each known cap in the Advanced panel', async ({ page }) => {
  await goToChat(page);
  await openAdvanced(page);

  // Each cap should have a star button
  await expect(page.locator('[data-testid="cap-star-task_orchestration"]')).toBeVisible();
  await expect(page.locator('[data-testid="cap-star-knowledge_management"]')).toBeVisible();
  await expect(page.locator('[data-testid="cap-star-code_review"]')).toBeVisible();
});

// ── 2. Clicking star toggles cap to starred ───────────────────────────────────

test('2. clicking star on an unstarred cap stars it and persists to localStorage', async ({ page }) => {
  await goToChat(page);
  await openAdvanced(page);

  const starBtn = page.locator('[data-testid="cap-star-knowledge_management"]');
  // Initially unstarred (☆)
  await expect(starBtn).toHaveText('☆');

  await starBtn.click();

  // Now shows filled star (★)
  await expect(starBtn).toHaveText('★');

  // Verify localStorage
  const stored = await page.evaluate(() => localStorage.getItem('kubex-favorite-caps'));
  expect(stored).not.toBeNull();
  const parsed = JSON.parse(stored!);
  expect(parsed).toContain('knowledge_management');
});

// ── 3. Starred caps appear in the Favorites section ──────────────────────────

test('3. starred caps appear in the Favorites section at the top of the Advanced panel', async ({ page }) => {
  await goToChat(page);
  await openAdvanced(page);

  // Star a capability
  await page.locator('[data-testid="cap-star-task_orchestration"]').click();

  // Favorites section should now be visible
  const favSection = page.locator('[data-testid="favorite-caps-section"]');
  await expect(favSection).toBeVisible();

  // The starred cap should appear inside the favorites section
  await expect(favSection).toContainText('task_orchestration');
});

// ── 4. Clicking star again removes cap from favorites ─────────────────────────

test('4. clicking star again on a starred cap removes it from favorites', async ({ page }) => {
  await goToChat(page);
  await openAdvanced(page);

  const starBtn = page.locator('[data-testid="cap-star-code_review"]');

  // Star it
  await starBtn.click();
  await expect(starBtn).toHaveText('★');
  await expect(page.locator('[data-testid="favorite-caps-section"]')).toBeVisible();

  // Unstar it — click the star in the "Known caps" row
  await starBtn.click();
  await expect(starBtn).toHaveText('☆');

  // Favorites section should no longer show code_review
  // (may still be visible if other caps were starred, but code_review should be gone)
  const favSection = page.locator('[data-testid="favorite-caps-section"]');
  const isFavVisible = await favSection.isVisible().catch(() => false);
  if (isFavVisible) {
    await expect(favSection).not.toContainText('code_review');
  }
});

// ── 5. Favorites section has correct data-testid ──────────────────────────────

test('5. favorites section has data-testid="favorite-caps-section"', async ({ page }) => {
  await goToChat(page);
  await openAdvanced(page);

  // Before starring: section not present
  await expect(page.locator('[data-testid="favorite-caps-section"]')).toHaveCount(0);

  // After starring one cap: section appears
  await page.locator('[data-testid="cap-star-knowledge_management"]').click();
  await expect(page.locator('[data-testid="favorite-caps-section"]')).toBeVisible();
});

// ── 6. Quick-access bar hidden when no favorites ──────────────────────────────

test('6. quick-access bar is hidden when no favorites exist', async ({ page }) => {
  await goToChat(page);
  // Advanced panel is closed by default; no favorites
  await expect(page.locator('[data-testid="quick-caps-bar"]')).toHaveCount(0);
});

// ── 7. Quick-access bar appears when panel is collapsed + favorites exist ─────

test('7. quick-access bar appears below input when Advanced panel is collapsed and favorites exist', async ({ page }) => {
  await goToChat(page);
  await openAdvanced(page);

  // Star a cap
  await page.locator('[data-testid="cap-star-task_orchestration"]').click();

  // Close Advanced panel
  await page.locator('[data-testid="advanced-toggle"]').click();
  await expect(page.locator('[data-testid="advanced-panel"]')).not.toBeVisible();

  // Quick-access bar should now be visible
  await expect(page.locator('[data-testid="quick-caps-bar"]')).toBeVisible();
});

// ── 8. Quick-access bar hidden when Advanced panel is open ────────────────────

test('8. quick-access bar is hidden when Advanced panel is open', async ({ page }) => {
  await goToChat(page);
  await openAdvanced(page);

  // Star a cap
  await page.locator('[data-testid="cap-star-knowledge_management"]').click();

  // Panel is open — quick-caps-bar should NOT be rendered
  await expect(page.locator('[data-testid="quick-caps-bar"]')).toHaveCount(0);
});

// ── 9. Clicking a quick-cap pill sets the capability ─────────────────────────

test('9. clicking a quick-cap pill sets the capability input', async ({ page }) => {
  await goToChat(page);
  await openAdvanced(page);

  // Star knowledge_management
  await page.locator('[data-testid="cap-star-knowledge_management"]').click();

  // Close Advanced panel
  await page.locator('[data-testid="advanced-toggle"]').click();
  await expect(page.locator('[data-testid="advanced-panel"]')).not.toBeVisible();

  // Click the quick-cap pill
  const pill = page.locator('[data-testid="quick-cap-pill-knowledge_management"]');
  await expect(pill).toBeVisible();
  await pill.click();

  // Now open the Advanced panel to verify capability was set
  await openAdvanced(page);
  await expect(page.locator('[data-testid="capability-input"]')).toHaveValue('knowledge_management');
});

// ── 10. Quick-cap pills have correct data-testid ──────────────────────────────

test('10. quick-cap pills have correct data-testid="quick-cap-pill-{capName}"', async ({ page }) => {
  await goToChat(page);
  await openAdvanced(page);

  // Star two caps
  await page.locator('[data-testid="cap-star-task_orchestration"]').click();
  await page.locator('[data-testid="cap-star-code_review"]').click();

  // Close Advanced panel
  await page.locator('[data-testid="advanced-toggle"]').click();

  // Both pills should have the correct testids
  await expect(page.locator('[data-testid="quick-cap-pill-task_orchestration"]')).toBeVisible();
  await expect(page.locator('[data-testid="quick-cap-pill-code_review"]')).toBeVisible();
});

// ── 11. Favorites persist across page reload ──────────────────────────────────

test('11. favorites persist across page reload via localStorage', async ({ page }) => {
  test.skip(isLiveMode, 'localStorage persistence test not applicable in live mode');

  await goToChat(page);
  await openAdvanced(page);

  // Star task_orchestration
  await page.locator('[data-testid="cap-star-task_orchestration"]').click();
  await expect(page.locator('[data-testid="cap-star-task_orchestration"]')).toHaveText('★');

  // Reload the page — routes persist across navigation in Playwright
  await page.reload();
  await page.waitForSelector('[data-testid="message-input"]');

  // After reload, quick-caps-bar should show (advanced panel starts closed)
  await expect(page.locator('[data-testid="quick-caps-bar"]')).toBeVisible();
  await expect(page.locator('[data-testid="quick-cap-pill-task_orchestration"]')).toBeVisible();

  // Opening Advanced panel should show star as filled
  await openAdvanced(page);
  await expect(page.locator('[data-testid="cap-star-task_orchestration"]')).toHaveText('★');
});

// ── 12. Star buttons have correct data-testid ─────────────────────────────────

test('12. star buttons have correct data-testid="cap-star-{capName}"', async ({ page }) => {
  await goToChat(page);
  await openAdvanced(page);

  // All three caps should have properly named star buttons
  await expect(page.locator('[data-testid="cap-star-task_orchestration"]')).toBeVisible();
  await expect(page.locator('[data-testid="cap-star-knowledge_management"]')).toBeVisible();
  await expect(page.locator('[data-testid="cap-star-code_review"]')).toBeVisible();

  // Each should show an empty star initially
  await expect(page.locator('[data-testid="cap-star-task_orchestration"]')).toHaveText('☆');
  await expect(page.locator('[data-testid="cap-star-knowledge_management"]')).toHaveText('☆');
  await expect(page.locator('[data-testid="cap-star-code_review"]')).toHaveText('☆');
});
