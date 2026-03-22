import { test, expect } from '@playwright/test';

// ── Agents Table Keyboard Navigation ────────────────────────────────

test.describe('Agents table keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/agents');
    // Wait for the table to be present and data rows to load
    await expect(page.locator('[data-testid="agents-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="agents-table"] [data-nav-index="0"]')).toBeVisible();
  });

  test('agents table has role=grid', async ({ page }) => {
    const table = page.locator('[data-testid="agents-table"]');
    await expect(table).toHaveAttribute('role', 'grid');
  });

  test('agents table has aria-label', async ({ page }) => {
    const table = page.locator('[data-testid="agents-table"]');
    await expect(table).toHaveAttribute('aria-label', 'Registered agents');
  });

  test('agents table is keyboard-focusable (tabIndex=0)', async ({ page }) => {
    const table = page.locator('[data-testid="agents-table"]');
    await expect(table).toHaveAttribute('tabindex', '0');
  });

  test('agents table rows have data-nav-index attributes', async ({ page }) => {
    const firstRow = page.locator('[data-testid="agents-table"] [data-nav-index="0"]');
    await expect(firstRow).toBeVisible();
  });

  test('agents table rows have aria-rowindex attributes', async ({ page }) => {
    const firstRow = page.locator('[data-testid="agents-table"] [aria-rowindex="1"]');
    await expect(firstRow).toBeVisible();
  });

  test('agents table rows have stable id attributes', async ({ page }) => {
    const firstRow = page.locator('[data-testid="agents-table"] [data-nav-index="0"]');
    await expect(firstRow).toHaveAttribute('id', 'agents-table-row-0');
  });

  test('ArrowDown moves focus to first row in agents table', async ({ page }) => {
    const table = page.locator('[data-testid="agents-table"]');
    // Focus the table via JS to ensure keyboard events are routed to it
    await table.focus();
    await page.keyboard.press('ArrowDown');
    // First row should now have tabIndex=0 (focused row)
    const firstRow = page.locator('[data-testid="agents-table"] [data-nav-index="0"]');
    await expect(firstRow).toHaveAttribute('tabindex', '0');
  });

  test('ArrowDown then ArrowDown moves focus to second row', async ({ page }) => {
    const table = page.locator('[data-testid="agents-table"]');
    await table.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const secondRow = page.locator('[data-testid="agents-table"] [data-nav-index="1"]');
    await expect(secondRow).toHaveAttribute('tabindex', '0');
  });

  test('ArrowUp from second row returns focus to first row', async ({ page }) => {
    const table = page.locator('[data-testid="agents-table"]');
    await table.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    const firstRow = page.locator('[data-testid="agents-table"] [data-nav-index="0"]');
    await expect(firstRow).toHaveAttribute('tabindex', '0');
  });

  test('Home key moves focus to first row', async ({ page }) => {
    const table = page.locator('[data-testid="agents-table"]');
    await table.focus();
    // Navigate to second row, then Home
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    const firstRow = page.locator('[data-testid="agents-table"] [data-nav-index="0"]');
    await expect(firstRow).toHaveAttribute('tabindex', '0');
  });

  test('ArrowDown three times reaches the third row', async ({ page }) => {
    const table = page.locator('[data-testid="agents-table"]');
    await table.focus();
    // With 3 mock agents, three ArrowDown presses should reach index 2
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const lastRow = page.locator('[data-testid="agents-table"] [data-nav-index="2"]');
    await expect(lastRow).toHaveAttribute('tabindex', '0');
  });

  test('focused row has visible focus ring (ring-2 class)', async ({ page }) => {
    const table = page.locator('[data-testid="agents-table"]');
    await table.focus();
    await page.keyboard.press('ArrowDown');
    const firstRow = page.locator('[data-testid="agents-table"] [data-nav-index="0"]');
    await expect(firstRow).toHaveClass(/ring-2/);
  });

  test('non-focused rows do not have ring-2 class', async ({ page }) => {
    const table = page.locator('[data-testid="agents-table"]');
    await table.focus();
    await page.keyboard.press('ArrowDown');
    // Second row should not be focused
    const secondRow = page.locator('[data-testid="agents-table"] [data-nav-index="1"]');
    const className = await secondRow.getAttribute('class');
    expect(className).not.toMatch(/ring-2/);
  });

  test('aria-activedescendant updates when row is focused via keyboard', async ({ page }) => {
    const table = page.locator('[data-testid="agents-table"]');
    await table.focus();
    await page.keyboard.press('ArrowDown');
    // After ArrowDown from initial state, focusedIndex becomes 0
    await expect(table).toHaveAttribute('aria-activedescendant', 'agents-table-row-0');
  });

  test('Enter key expands the focused agents row', async ({ page }) => {
    const table = page.locator('[data-testid="agents-table"]');
    await table.focus();
    await page.keyboard.press('ArrowDown');
    // Press Enter to toggle expand
    await page.keyboard.press('Enter');
    // After Enter, expanded section should appear — look for detail labels
    await expect(page.locator('[data-testid="agents-table"]').locator('text=agent_id').first()).toBeVisible();
  });

  test('Space key selects the focused agents row', async ({ page }) => {
    const table = page.locator('[data-testid="agents-table"]');
    await table.focus();
    await page.keyboard.press('ArrowDown');
    // Press Space to select the focused row (index 0)
    await page.keyboard.press(' ');
    // The first row checkbox should now be checked
    const firstRowCheckbox = page.locator('[data-testid^="agent-checkbox-"]').first();
    await expect(firstRowCheckbox).toBeChecked();
  });

  test('clicking a row updates the focused index', async ({ page }) => {
    // Click directly on a row — the onFocus handler sets focusedIndex
    const secondRow = page.locator('[data-testid="agents-table"] [data-nav-index="1"]');
    await secondRow.click();
    // After the click, that row should be tracked as focused
    await expect(secondRow).toHaveAttribute('tabindex', '0');
  });
});

// ── Containers Table Keyboard Navigation ────────────────────────────

test.describe('Containers table keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="containers-table"] [data-nav-index="0"]')).toBeVisible();
  });

  test('containers table has role=grid', async ({ page }) => {
    const table = page.locator('[data-testid="containers-table"]');
    await expect(table).toHaveAttribute('role', 'grid');
  });

  test('containers table has aria-label', async ({ page }) => {
    const table = page.locator('[data-testid="containers-table"]');
    await expect(table).toHaveAttribute('aria-label', 'Docker containers');
  });

  test('containers table is keyboard-focusable (tabIndex=0)', async ({ page }) => {
    const table = page.locator('[data-testid="containers-table"]');
    await expect(table).toHaveAttribute('tabindex', '0');
  });

  test('containers table rows have data-nav-index attributes', async ({ page }) => {
    const firstRow = page.locator('[data-testid="containers-table"] [data-nav-index="0"]');
    await expect(firstRow).toBeVisible();
  });

  test('containers table rows have aria-rowindex attributes', async ({ page }) => {
    const firstRow = page.locator('[data-testid="containers-table"] [aria-rowindex="1"]');
    await expect(firstRow).toBeVisible();
  });

  test('containers table rows have stable id attributes', async ({ page }) => {
    const firstRow = page.locator('[data-testid="containers-table"] [data-nav-index="0"]');
    await expect(firstRow).toHaveAttribute('id', 'containers-table-row-0');
  });

  test('ArrowDown moves focus to first containers row', async ({ page }) => {
    const table = page.locator('[data-testid="containers-table"]');
    await table.focus();
    await page.keyboard.press('ArrowDown');
    const firstRow = page.locator('[data-testid="containers-table"] [data-nav-index="0"]');
    await expect(firstRow).toHaveAttribute('tabindex', '0');
  });

  test('ArrowUp from second containers row returns to first', async ({ page }) => {
    const table = page.locator('[data-testid="containers-table"]');
    await table.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    const firstRow = page.locator('[data-testid="containers-table"] [data-nav-index="0"]');
    await expect(firstRow).toHaveAttribute('tabindex', '0');
  });

  test('Home key jumps to first containers row', async ({ page }) => {
    const table = page.locator('[data-testid="containers-table"]');
    await table.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    const firstRow = page.locator('[data-testid="containers-table"] [data-nav-index="0"]');
    await expect(firstRow).toHaveAttribute('tabindex', '0');
  });

  test('focused containers row has visible focus ring', async ({ page }) => {
    const table = page.locator('[data-testid="containers-table"]');
    await table.focus();
    await page.keyboard.press('ArrowDown');
    const firstRow = page.locator('[data-testid="containers-table"] [data-nav-index="0"]');
    await expect(firstRow).toHaveClass(/ring-2/);
  });

  test('aria-activedescendant set on containers table when row focused', async ({ page }) => {
    const table = page.locator('[data-testid="containers-table"]');
    await table.focus();
    await page.keyboard.press('ArrowDown');
    await expect(table).toHaveAttribute('aria-activedescendant', 'containers-table-row-0');
  });

  test('Space key selects the focused containers row', async ({ page }) => {
    const table = page.locator('[data-testid="containers-table"]');
    await table.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(' ');
    const firstRowCheckbox = page.locator('[data-testid^="kubex-checkbox-"]').first();
    await expect(firstRowCheckbox).toBeChecked();
  });

  test('clicking a containers row updates the focused index', async ({ page }) => {
    const firstRow = page.locator('[data-testid="containers-table"] [data-nav-index="0"]');
    await firstRow.click();
    await expect(firstRow).toHaveAttribute('tabindex', '0');
  });
});
