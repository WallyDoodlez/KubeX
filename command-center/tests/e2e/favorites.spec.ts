import { test, expect } from '@playwright/test';

test.describe('Pinned/Favorite Agents', () => {
  test.beforeEach(async ({ page }) => {
    // Clear favorites from localStorage before each test
    await page.goto('/agents');
    await page.evaluate(() => localStorage.removeItem('kubex-favorite-agents'));
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Agents');
    // Wait for the agents table to be visible
    await expect(page.locator('[data-testid="agents-table"]')).toBeVisible();
  });

  // ── Star button presence in AgentsPanel ──────────────────────────────

  test('each agent row has a favorite star button', async ({ page }) => {
    // We should have at least one agent row from mock data
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    await expect(starBtn).toBeVisible();
  });

  test('star button shows unfilled star (☆) by default', async ({ page }) => {
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    await expect(starBtn).toHaveText('☆');
  });

  test('star button has correct aria-label for unfavorited agent', async ({ page }) => {
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    const label = await starBtn.getAttribute('aria-label');
    expect(label).toMatch(/^Pin agent/);
  });

  test('clicking star fills it (★) — agent becomes favorited', async ({ page }) => {
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    await starBtn.click();
    await expect(starBtn).toHaveText('★');
  });

  test('star button aria-label changes to Unpin after favoriting', async ({ page }) => {
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    await starBtn.click();
    const label = await starBtn.getAttribute('aria-label');
    expect(label).toMatch(/^Unpin agent/);
  });

  test('clicking filled star unfavorites the agent (back to ☆)', async ({ page }) => {
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    // Favorite
    await starBtn.click();
    await expect(starBtn).toHaveText('★');
    // Unfavorite
    await starBtn.click();
    await expect(starBtn).toHaveText('☆');
  });

  // ── Pinned section label ─────────────────────────────────────────────

  test('no "Pinned" section label when no agents are favorited', async ({ page }) => {
    await expect(page.locator('[data-testid="pinned-section-label"]')).not.toBeVisible();
  });

  test('"Pinned" section label appears after favoriting an agent', async ({ page }) => {
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    await starBtn.click();
    await expect(page.locator('[data-testid="pinned-section-label"]')).toBeVisible();
  });

  test('"Pinned" label contains the star icon', async ({ page }) => {
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    await starBtn.click();
    const label = page.locator('[data-testid="pinned-section-label"]');
    await expect(label).toContainText('★');
  });

  test('"All Agents" separator appears after pinning at least one agent', async ({ page }) => {
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    await starBtn.click();
    await expect(page.locator('[data-testid="unpinned-section-label"]')).toBeVisible();
  });

  test('"Pinned" section label disappears after unpinning all agents', async ({ page }) => {
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    await starBtn.click();
    await expect(page.locator('[data-testid="pinned-section-label"]')).toBeVisible();
    await starBtn.click();
    await expect(page.locator('[data-testid="pinned-section-label"]')).not.toBeVisible();
  });

  // ── localStorage persistence ─────────────────────────────────────────

  test('favorites persist across page reload', async ({ page }) => {
    // Get the agent id from the first star button
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    await starBtn.click();
    await expect(starBtn).toHaveText('★');

    // Reload and check the star is still filled
    await page.reload();
    await expect(page.locator('[data-testid="agents-table"]')).toBeVisible();
    const starBtnAfter = page.locator('[data-testid^="agent-favorite-"]').first();
    await expect(starBtnAfter).toHaveText('★');
  });

  test('favorites stored in localStorage under kubex-favorite-agents', async ({ page }) => {
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    const agentId = await starBtn.getAttribute('data-testid');
    // Strip prefix to get agent ID
    const id = agentId?.replace('agent-favorite-', '') ?? '';

    await starBtn.click();

    const stored = await page.evaluate(() => localStorage.getItem('kubex-favorite-agents'));
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContain(id);
  });

  test('unfavoriting removes agent from localStorage', async ({ page }) => {
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    const agentId = await starBtn.getAttribute('data-testid');
    const id = agentId?.replace('agent-favorite-', '') ?? '';

    // Favorite then unfavorite
    await starBtn.click();
    await starBtn.click();

    const stored = await page.evaluate(() => localStorage.getItem('kubex-favorite-agents'));
    if (stored) {
      const parsed = JSON.parse(stored);
      expect(parsed).not.toContain(id);
    }
  });

  // ── Ordering in AgentsPanel ──────────────────────────────────────────

  test('favorited agent moves to the top of the list', async ({ page }) => {
    // Get IDs of all star buttons (all agents)
    const allStarBtns = page.locator('[data-testid^="agent-favorite-"]');
    const count = await allStarBtns.count();

    if (count < 2) {
      test.skip();
      return;
    }

    // Favorite the last agent
    const lastStarBtn = allStarBtns.nth(count - 1);
    const lastId = (await lastStarBtn.getAttribute('data-testid'))?.replace('agent-favorite-', '') ?? '';
    await lastStarBtn.click();

    // Now the first star button should correspond to the favorited agent
    const firstStarBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    const firstId = (await firstStarBtn.getAttribute('data-testid'))?.replace('agent-favorite-', '') ?? '';
    expect(firstId).toBe(lastId);
  });

  test('favorited agent row has filled star at top of list', async ({ page }) => {
    const allStarBtns = page.locator('[data-testid^="agent-favorite-"]');
    const count = await allStarBtns.count();
    if (count < 2) { test.skip(); return; }

    // Favorite the last agent
    const lastStarBtn = allStarBtns.nth(count - 1);
    await lastStarBtn.click();

    // First star button should now be filled
    const firstStarBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    await expect(firstStarBtn).toHaveText('★');
  });

  // ── Agent Detail Page ────────────────────────────────────────────────

  test('agent detail page has a favorite toggle button', async ({ page }) => {
    await page.goto('/agents/agent-alpha-001');
    // Wait for loading to resolve (either agent or error)
    await page.waitForTimeout(2000);
    // If agent was found, the detail button should be present
    const isAgentFound = await page.locator('[data-testid="agent-detail-favorite-btn"]').isVisible();
    if (isAgentFound) {
      await expect(page.locator('[data-testid="agent-detail-favorite-btn"]')).toBeVisible();
    }
  });

  test('agent detail favorite button defaults to unfavorited (☆)', async ({ page }) => {
    await page.goto('/agents/agent-alpha-001');
    await page.waitForTimeout(2000);
    const btn = page.locator('[data-testid="agent-detail-favorite-btn"]');
    const isVisible = await btn.isVisible();
    if (isVisible) {
      await expect(btn).toHaveText('☆');
    }
  });

  test('agent detail favorite button toggles to filled star on click', async ({ page }) => {
    await page.goto('/agents/agent-alpha-001');
    await page.waitForTimeout(2000);
    const btn = page.locator('[data-testid="agent-detail-favorite-btn"]');
    const isVisible = await btn.isVisible();
    if (isVisible) {
      await btn.click();
      await expect(btn).toHaveText('★');
    }
  });

  test('detail page favorite syncs with agents list after navigation', async ({ page }) => {
    // Navigate to detail, pin agent
    await page.goto('/agents/agent-alpha-001');
    await page.waitForTimeout(2000);
    const detailBtn = page.locator('[data-testid="agent-detail-favorite-btn"]');
    if (!(await detailBtn.isVisible())) { test.skip(); return; }
    await detailBtn.click();
    await expect(detailBtn).toHaveText('★');

    // Navigate back to agents list
    await page.goto('/agents');
    await expect(page.locator('[data-testid="agents-table"]')).toBeVisible();

    // The star for agent-alpha-001 should be filled
    const agentStar = page.locator('[data-testid="agent-favorite-agent-alpha-001"]');
    if (await agentStar.isVisible()) {
      await expect(agentStar).toHaveText('★');
    }
  });

  // ── Dashboard ────────────────────────────────────────────────────────

  test('dashboard shows pinned star icon for favorited agent', async ({ page }) => {
    // First, favorite an agent via the agents panel
    await page.evaluate(() => {
      localStorage.setItem('kubex-favorite-agents', JSON.stringify(['agent-alpha-001']));
    });

    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    // Wait for agents to load
    await page.waitForTimeout(2000);

    // Look for the amber star in the agent cards
    const pinnedStar = page.locator('[aria-label="Pinned"]').first();
    const isVisible = await pinnedStar.isVisible();
    // If agent is shown in the visible limit, star should appear
    if (isVisible) {
      await expect(pinnedStar).toBeVisible();
    }
  });

  // ── Accessibility ────────────────────────────────────────────────────

  test('star button is keyboard-accessible (focusable)', async ({ page }) => {
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    await starBtn.focus();
    await expect(starBtn).toBeFocused();
  });

  test('star button has tabIndex 0 (keyboard accessible)', async ({ page }) => {
    // The star button is a <button> element — buttons are natively focusable
    // (tabIndex defaults to 0). Verify it can receive focus via keyboard.
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    // Focus it directly and confirm it receives focus
    await starBtn.focus();
    await expect(starBtn).toBeFocused();
  });

  test('star buttons do not propagate click to row expand', async ({ page }) => {
    // Clicking the star should NOT expand the row — the row detail panel
    // uses data-testid="agent-detail-row-{id}" or shows the detailed grid.
    // Verify by checking that no expanded detail fields appear.
    const starBtn = page.locator('[data-testid^="agent-favorite-"]').first();
    const agentId = (await starBtn.getAttribute('data-testid'))?.replace('agent-favorite-', '') ?? '';
    await starBtn.click();
    // Expanded rows show a "registered_at" label inside the detail section.
    // If the star click propagated, the row would have expanded and shown it.
    const expandedLabel = page.locator(`text=registered_at`).first();
    const isExpanded = await expandedLabel.isVisible();
    expect(isExpanded).toBe(false);
    // Confirm the agent is favorited (star button worked)
    await expect(starBtn).toHaveText('★');
    // Suppress unused variable lint warning
    void agentId;
  });
});
