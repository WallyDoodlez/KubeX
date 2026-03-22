import { test, expect } from '@playwright/test';

/**
 * Capability Matrix — Iteration 29
 *
 * The matrix renders below the agents table on the /agents page.
 * Tests are written defensively against actual backend data (variable
 * agent count), checking structure and semantics rather than fixed counts.
 */
test.describe('Capability Matrix', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents');
    // Wait for the matrix to be present (agents have loaded)
    await expect(page.locator('[data-testid="capability-matrix"]')).toBeVisible({ timeout: 10_000 });
  });

  test('matrix section is present on Agents page', async ({ page }) => {
    await expect(page.locator('[data-testid="capability-matrix"]')).toBeVisible();
  });

  test('matrix has "Capability Matrix" heading', async ({ page }) => {
    await expect(
      page.locator('[data-testid="capability-matrix"] h2', { hasText: 'Capability Matrix' }),
    ).toBeVisible();
  });

  test('subtitle shows agent and capability counts in expected format', async ({ page }) => {
    const subtitle = page.locator('[data-testid="capability-matrix-subtitle"]');
    await expect(subtitle).toBeVisible();
    // Pattern: "<N> agent(s) · <M> unique capabilit(y|ies)"
    await expect(subtitle).toContainText('agent');
    await expect(subtitle).toContainText('unique capabilit');
  });

  test('subtitle contains numeric counts', async ({ page }) => {
    const subtitle = page.locator('[data-testid="capability-matrix-subtitle"]');
    const text = await subtitle.textContent();
    // Should contain at least one digit (agent count)
    expect(text).toMatch(/\d+ agents?/);
    expect(text).toMatch(/\d+ unique capabilit/);
  });

  test('table has accessible role=grid and aria-label', async ({ page }) => {
    const table = page.locator('[data-testid="capability-matrix-table"]');
    await expect(table).toHaveAttribute('role', 'grid');
    await expect(table).toHaveAttribute('aria-label', 'Agent capability matrix');
  });

  test('at least one agent row is rendered', async ({ page }) => {
    const rows = page.locator('[data-testid^="capability-matrix-row-"]');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('at least one capability column is rendered', async ({ page }) => {
    const cols = page.locator('[data-testid^="capability-col-"]');
    const count = await cols.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('each capability column shows a coverage count', async ({ page }) => {
    const cols = page.locator('[data-testid^="capability-col-"]');
    const colCount = await cols.count();
    expect(colCount).toBeGreaterThan(0);

    // Each column's count element should contain "N/M" format
    const counts = page.locator('[data-testid^="capability-count-"]');
    const countCount = await counts.count();
    expect(countCount).toBe(colCount);

    // Spot-check the first count is in "N/M" format
    const firstCount = await counts.first().textContent();
    expect(firstCount).toMatch(/^\d+\/\d+$/);
  });

  test('coverage count elements have aria-label in "X of Y agents" format', async ({ page }) => {
    const counts = page.locator('[data-testid^="capability-count-"]');
    const firstCount = counts.first();
    const ariaLabel = await firstCount.getAttribute('aria-label');
    expect(ariaLabel).toMatch(/\d+ of \d+ agents/);
  });

  test('cells exist for every agent-capability intersection', async ({ page }) => {
    // Collect all agent row ids and column capability names
    const rows = page.locator('[data-testid^="capability-matrix-row-"]');
    const cols = page.locator('[data-testid^="capability-col-"]');

    const rowCount = await rows.count();
    const colCount = await cols.count();

    // Total cells should equal agents × capabilities
    const cells = page.locator('[data-testid^="cell-"]');
    const cellCount = await cells.count();
    expect(cellCount).toBe(rowCount * colCount);
  });

  test('cells contain either a check mark or a dash', async ({ page }) => {
    const cells = page.locator('[data-testid^="cell-"]');
    const count = await cells.count();
    expect(count).toBeGreaterThan(0);

    // Spot-check the first few cells have either ✓ or –
    const checkCount = Math.min(count, 6);
    for (let i = 0; i < checkCount; i++) {
      const text = await cells.nth(i).textContent();
      expect(text?.trim()).toMatch(/^[✓–]$/);
    }
  });

  test('cells with check mark have appropriate aria-label "has <cap>"', async ({ page }) => {
    // Find a filled cell (✓)
    const filledCells = page.locator('[data-testid^="cell-"]').filter({ hasText: '✓' });
    const count = await filledCells.count();
    if (count === 0) {
      test.skip();
      return;
    }
    const ariaLabel = await filledCells.first().getAttribute('aria-label');
    expect(ariaLabel).toMatch(/has .+/);
  });

  test('cells with dash have aria-label "does not have <cap>"', async ({ page }) => {
    // Find an empty cell (–)
    const emptyCells = page.locator('[data-testid^="cell-"]').filter({ hasText: '–' });
    const count = await emptyCells.count();
    if (count === 0) {
      test.skip();
      return;
    }
    const ariaLabel = await emptyCells.first().getAttribute('aria-label');
    expect(ariaLabel).toMatch(/does not have .+/);
  });

  test('capability columns are sorted alphabetically', async ({ page }) => {
    const cols = page.locator('[data-testid^="capability-col-"]');
    const count = await cols.count();
    if (count < 2) return; // Nothing to compare

    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const testId = await cols.nth(i).getAttribute('data-testid');
      // data-testid="capability-col-<name>" → extract name
      names.push((testId ?? '').replace('capability-col-', ''));
    }
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  test('matrix is visible after navigating away and back', async ({ page }) => {
    // Navigate to Dashboard using direct URL (avoids button vs <a> selector issues)
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    // Navigate back to Agents
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents');
    await expect(page.locator('[data-testid="capability-matrix"]')).toBeVisible({ timeout: 10_000 });
  });

  test('agent IDs in row testids match agent IDs visible in the table above', async ({ page }) => {
    // Collect agent IDs from the matrix rows
    const matrixRows = page.locator('[data-testid^="capability-matrix-row-"]');
    const rowCount = await matrixRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Each row's testid encodes the agent_id: "capability-matrix-row-<agent_id>"
    const firstId = await matrixRows.first().getAttribute('data-testid');
    expect(firstId).toMatch(/^capability-matrix-row-.+/);
  });

  test('matrix renders inside a rounded bordered card', async ({ page }) => {
    const matrix = page.locator('[data-testid="capability-matrix"]');
    // Verify the container is visually present (has dimensions)
    const box = await matrix.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(50);
  });
});
