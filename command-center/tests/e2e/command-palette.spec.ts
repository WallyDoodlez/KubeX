import { test, expect } from '@playwright/test';

test.describe('Command Palette (Iteration 16)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to be ready
    await expect(page.locator('text=KubexClaw')).toBeVisible();
  });

  // ── Trigger tests ──────────────────────────────────────────────────

  test('Ctrl+K opens the command palette', async ({ page }) => {
    await expect(page.getByTestId('command-palette')).not.toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();
  });

  test('clicking the Search trigger button opens the palette', async ({ page }) => {
    await page.getByTestId('command-palette-trigger').click();
    await expect(page.getByTestId('command-palette')).toBeVisible();
  });

  test('Escape closes the command palette', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).not.toBeVisible();
  });

  test('clicking the backdrop closes the palette', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    // Click the backdrop (the outer div, not the inner panel)
    await page.getByTestId('command-palette-backdrop').click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId('command-palette')).not.toBeVisible();
  });

  // ── Content tests ──────────────────────────────────────────────────

  test('palette shows all navigation commands by default', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const list = page.getByTestId('command-palette-list');
    await expect(list).toBeVisible();
    await expect(list).toContainText('Go to Dashboard');
    await expect(list).toContainText('Go to Agents');
    await expect(list).toContainText('Go to Traffic Log');
    await expect(list).toContainText('Go to Orchestrator');
    await expect(list).toContainText('Go to Containers');
    await expect(list).toContainText('Go to Approvals');
  });

  test('input is focused when palette opens', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const input = page.getByTestId('command-palette-input');
    await expect(input).toBeFocused();
  });

  // ── Search / filter tests ──────────────────────────────────────────

  test('typing filters commands by label', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const input = page.getByTestId('command-palette-input');
    await input.fill('agent');
    const list = page.getByTestId('command-palette-list');
    await expect(list).toContainText('Go to Agents');
    // Traffic should be filtered out
    await expect(list).not.toContainText('Go to Traffic Log');
  });

  test('typing a query with no match shows empty state', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const input = page.getByTestId('command-palette-input');
    await input.fill('xyznonexistent');
    await expect(page.getByTestId('command-palette-list')).toContainText('No commands match');
  });

  test('fuzzy search matches keyword synonyms', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const input = page.getByTestId('command-palette-input');
    // "docker" is a keyword for Containers
    await input.fill('docker');
    await expect(page.getByTestId('command-palette-list')).toContainText('Go to Containers');
  });

  // ── Keyboard navigation tests ──────────────────────────────────────

  test('ArrowDown / ArrowUp moves selection', async ({ page }) => {
    await page.keyboard.press('Control+k');
    // First item should be selected by default (Dashboard)
    await expect(page.getByTestId('cmd-item-nav-dashboard')).toHaveAttribute('aria-selected', 'true');
    // Arrow down → Agents
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('cmd-item-nav-agents')).toHaveAttribute('aria-selected', 'true');
    // Arrow up → back to Dashboard
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('cmd-item-nav-dashboard')).toHaveAttribute('aria-selected', 'true');
  });

  test('Enter executes selected command and closes palette', async ({ page }) => {
    await page.keyboard.press('Control+k');
    // Navigate down to Agents (second item)
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    // Palette should close
    await expect(page.getByTestId('command-palette')).not.toBeVisible();
    // Should have navigated to agents
    await expect(page.locator('header h1')).toHaveText('Agents');
  });

  test('clicking an item navigates and closes palette', async ({ page }) => {
    // beforeEach already navigated to '/'
    await page.keyboard.press('Control+k');
    // Wait for palette to be visible before clicking
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();
    // Click traffic item (visible in the list)
    const trafficItem = page.getByTestId('cmd-item-nav-traffic');
    await expect(trafficItem).toBeVisible();
    await trafficItem.click();
    await expect(palette).not.toBeVisible();
    await expect(page.locator('header h1')).toHaveText('Traffic');
  });

  // ── Help overlay tests ─────────────────────────────────────────────

  test('? key opens keyboard shortcuts help overlay', async ({ page }) => {
    await expect(page.getByTestId('shortcuts-help-panel')).not.toBeVisible();
    await page.keyboard.press('?');
    await expect(page.getByTestId('shortcuts-help-panel')).toBeVisible();
  });

  test('clicking shortcuts-help-trigger button opens help overlay', async ({ page }) => {
    await page.getByTestId('shortcuts-help-trigger').click();
    await expect(page.getByTestId('shortcuts-help-panel')).toBeVisible();
  });

  test('Escape closes the help overlay', async ({ page }) => {
    await page.keyboard.press('?');
    await expect(page.getByTestId('shortcuts-help-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcuts-help-panel')).not.toBeVisible();
  });

  test('help overlay lists keyboard shortcuts', async ({ page }) => {
    await page.keyboard.press('?');
    const panel = page.getByTestId('shortcuts-help-panel');
    await expect(panel).toContainText('Ctrl');
    await expect(panel).toContainText('K');
    await expect(panel).toContainText('Open command palette');
    await expect(panel).toContainText('Navigation');
  });

  // ── Two-key navigation tests ───────────────────────────────────────

  test('G then D navigates to Dashboard', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents');
    await page.keyboard.press('g');
    await page.keyboard.press('d');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('G then A navigates to Agents', async ({ page }) => {
    await page.goto('/');
    // Ensure body has focus (not a child element) before sending key sequence
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('g');
    await page.keyboard.press('a');
    await expect(page.locator('header h1')).toHaveText('Agents');
  });

  test('G then P navigates to Approvals', async ({ page }) => {
    await page.goto('/');
    // Ensure body has focus before sending key sequence
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await expect(page.locator('header h1')).toHaveText('Approvals');
  });

  // ── Accessibility tests ────────────────────────────────────────────

  test('command palette has correct ARIA roles', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const palette = page.getByTestId('command-palette');
    await expect(palette).toHaveAttribute('role', 'dialog');
    await expect(palette).toHaveAttribute('aria-modal', 'true');
    const input = page.getByTestId('command-palette-input');
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    const list = page.getByTestId('command-palette-list');
    await expect(list).toHaveAttribute('role', 'listbox');
  });

  test('trigger button has aria-keyshortcuts attribute', async ({ page }) => {
    await expect(page.getByTestId('command-palette-trigger')).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+k'
    );
  });
});
