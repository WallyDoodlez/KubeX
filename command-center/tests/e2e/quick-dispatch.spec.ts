import { test, expect } from '@playwright/test';

// ── Quick Dispatch Modal (Ctrl+D) ─────────────────────────────────────

test.describe('Quick dispatch modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header h1')).toBeVisible();
  });

  // ── Trigger via toolbar button ────────────────────────────────────

  test('toolbar has a Quick Dispatch trigger button', async ({ page }) => {
    await expect(page.locator('[data-testid="quick-dispatch-trigger"]')).toBeVisible();
  });

  test('Quick Dispatch trigger button has correct aria-label', async ({ page }) => {
    const btn = page.locator('[data-testid="quick-dispatch-trigger"]');
    await expect(btn).toHaveAttribute('aria-label', 'Open quick dispatch (Ctrl+D)');
  });

  test('clicking Quick Dispatch trigger opens the modal', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).toBeVisible();
  });

  // ── Trigger via Ctrl+D shortcut ───────────────────────────────────

  test('Ctrl+D from Dashboard opens quick dispatch modal', async ({ page }) => {
    await page.keyboard.press('Control+d');
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).toBeVisible();
  });

  test('Ctrl+D from Agents page opens quick dispatch modal', async ({ page }) => {
    await page.goto('/agents');
    // Wait for the page heading to confirm page is loaded (agents may or may not have data)
    await expect(page.locator('header h1')).toHaveText('Agents');
    await page.keyboard.press('Control+d');
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).toBeVisible();
  });

  test('Ctrl+D from Traffic page opens quick dispatch modal', async ({ page }) => {
    await page.goto('/traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');
    await page.keyboard.press('Control+d');
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).toBeVisible();
  });

  test('second Ctrl+D closes the modal (toggle)', async ({ page }) => {
    await page.keyboard.press('Control+d');
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).toBeVisible();
    await page.keyboard.press('Control+d');
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).not.toBeVisible();
  });

  // ── Modal structure ───────────────────────────────────────────────

  test('modal has role=dialog and aria-modal=true', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    const modal = page.locator('[data-testid="quick-dispatch-modal"]');
    await expect(modal).toHaveAttribute('role', 'dialog');
    await expect(modal).toHaveAttribute('aria-modal', 'true');
  });

  test('modal heading says "Quick Dispatch"', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-modal"] h2')).toHaveText('Quick Dispatch');
  });

  test('modal shows Ctrl+D keyboard hint in header', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    const modal = page.locator('[data-testid="quick-dispatch-modal"]');
    await expect(modal.locator('kbd').first()).toContainText('Ctrl+D');
  });

  test('modal has agent selector dropdown', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-agent-select"]')).toBeVisible();
  });

  test('agent selector default option is "Any agent"', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    const select = page.locator('[data-testid="quick-dispatch-agent-select"]');
    await expect(select).toHaveValue('');
  });

  test('modal has capability input', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-capability"]')).toBeVisible();
  });

  test('modal has message textarea', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-message"]')).toBeVisible();
  });

  test('modal has three priority buttons', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-priority-low"]')).toBeVisible();
    await expect(page.locator('[data-testid="quick-dispatch-priority-normal"]')).toBeVisible();
    await expect(page.locator('[data-testid="quick-dispatch-priority-high"]')).toBeVisible();
  });

  test('Normal priority is selected by default', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-priority-normal"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-testid="quick-dispatch-priority-low"]')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('[data-testid="quick-dispatch-priority-high"]')).toHaveAttribute('aria-checked', 'false');
  });

  test('clicking priority button changes selection', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await page.locator('[data-testid="quick-dispatch-priority-high"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-priority-high"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-testid="quick-dispatch-priority-normal"]')).toHaveAttribute('aria-checked', 'false');
  });

  test('modal has a Dispatch submit button', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-submit"]')).toBeVisible();
  });

  // ── Close behaviour ───────────────────────────────────────────────

  test('close button (X) dismisses the modal', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).toBeVisible();
    await page.locator('[data-testid="quick-dispatch-close"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).not.toBeVisible();
  });

  test('Escape key closes the modal', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).not.toBeVisible();
  });

  test('clicking the backdrop closes the modal', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).toBeVisible();
    // Click the backdrop (outside the panel)
    await page.locator('[data-testid="quick-dispatch-backdrop"]').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).not.toBeVisible();
  });

  test('Cancel button closes the modal', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).toBeVisible();
    await page.locator('[data-testid="quick-dispatch-modal"]').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).not.toBeVisible();
  });

  // ── Validation ────────────────────────────────────────────────────

  test('submitting with empty fields shows validation errors', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await page.locator('[data-testid="quick-dispatch-submit"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-cap-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="quick-dispatch-msg-error"]')).toBeVisible();
  });

  test('capability error says "Capability is required"', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await page.locator('[data-testid="quick-dispatch-submit"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-cap-error"]')).toHaveText('Capability is required');
  });

  test('message error says "Message is required"', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await page.locator('[data-testid="quick-dispatch-submit"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-msg-error"]')).toHaveText('Message is required');
  });

  test('capability error clears when user starts typing', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await page.locator('[data-testid="quick-dispatch-submit"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-cap-error"]')).toBeVisible();
    await page.locator('[data-testid="quick-dispatch-capability"]').fill('test_cap');
    await expect(page.locator('[data-testid="quick-dispatch-cap-error"]')).not.toBeVisible();
  });

  test('invalid capability characters show validation error on blur', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await page.locator('[data-testid="quick-dispatch-capability"]').fill('bad cap!');
    await page.locator('[data-testid="quick-dispatch-capability"]').blur();
    await expect(page.locator('[data-testid="quick-dispatch-cap-error"]')).toBeVisible();
  });

  // ── Autocomplete ──────────────────────────────────────────────────

  test('capability input has aria-autocomplete=list', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-capability"]')).toHaveAttribute('aria-autocomplete', 'list');
  });

  // ── Command palette integration ───────────────────────────────────

  test('command palette contains "Quick Dispatch" command', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('[data-testid="command-palette"]')).toBeVisible();
    const item = page.locator('[data-testid="cmd-item-action-quick-dispatch"]');
    await expect(item).toBeVisible();
  });

  test('command palette Quick Dispatch item opens the modal', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('[data-testid="command-palette"]')).toBeVisible();
    await page.locator('[data-testid="cmd-item-action-quick-dispatch"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).toBeVisible();
  });

  test('command palette Quick Dispatch item is in Actions category', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.locator('[data-testid="command-palette-input"]').fill('quick dispatch');
    const item = page.locator('[data-testid="cmd-item-action-quick-dispatch"]');
    await expect(item).toBeVisible();
    await expect(item).toContainText('Quick Dispatch');
  });

  // ── Keyboard shortcuts help ───────────────────────────────────────

  test('shortcuts help panel includes Ctrl+D entry', async ({ page }) => {
    await page.locator('[data-testid="shortcuts-help-trigger"]').click();
    await expect(page.locator('[data-testid="shortcuts-help-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="shortcuts-help-panel"]')).toContainText('quick dispatch');
  });

  // ── Reset on reopen ───────────────────────────────────────────────

  test('modal fields are empty when re-opened after close', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await page.locator('[data-testid="quick-dispatch-capability"]').fill('some_cap');
    await page.locator('[data-testid="quick-dispatch-message"]').fill('some message');
    await page.locator('[data-testid="quick-dispatch-close"]').click();
    // Reopen
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-capability"]')).toHaveValue('');
    await expect(page.locator('[data-testid="quick-dispatch-message"]')).toHaveValue('');
  });

  test('priority resets to Normal when modal is re-opened', async ({ page }) => {
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await page.locator('[data-testid="quick-dispatch-priority-high"]').click();
    await page.locator('[data-testid="quick-dispatch-close"]').click();
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-priority-normal"]')).toHaveAttribute('aria-checked', 'true');
  });
});
