/**
 * E2E tests for focus trap hook (Iteration 85)
 *
 * Verifies that Tab key cycles within modal boundaries and does not escape.
 * Covers: QuickDispatchModal, KeyboardShortcutsHelp, CommandPalette, NotificationCenter.
 */

import { test, expect } from '@playwright/test';
import { mockBaseRoutes } from './helpers';

test.describe('Focus Trap - modal accessibility (Iteration 85)', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();
  });

  test.describe('QuickDispatchModal focus trap', () => {
    test('Tab cycles within quick dispatch modal and does not escape', async ({ page }) => {
      await page.keyboard.press('Control+d');
      await expect(page.getByTestId('quick-dispatch-modal')).toBeVisible();

      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Tab');
      }

      const focusedInsideModal = await page.evaluate(() => {
        const modal = document.querySelector('[data-testid="quick-dispatch-modal"]');
        return modal?.contains(document.activeElement) ?? false;
      });
      expect(focusedInsideModal).toBe(true);
    });

    test('Shift+Tab cycles backward within quick dispatch modal', async ({ page }) => {
      await page.keyboard.press('Control+d');
      await expect(page.getByTestId('quick-dispatch-modal')).toBeVisible();

      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Shift+Tab');
      }

      const focusedInsideModal = await page.evaluate(() => {
        const modal = document.querySelector('[data-testid="quick-dispatch-modal"]');
        return modal?.contains(document.activeElement) ?? false;
      });
      expect(focusedInsideModal).toBe(true);
    });

    test('focus returns to trigger after closing quick dispatch modal', async ({ page }) => {
      const trigger = page.getByTestId('quick-dispatch-trigger');
      await trigger.focus();

      await page.keyboard.press('Control+d');
      await expect(page.getByTestId('quick-dispatch-modal')).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(page.getByTestId('quick-dispatch-modal')).not.toBeVisible();

      const isTriggerFocused = await page.evaluate(() => {
        const trigger = document.querySelector('[data-testid="quick-dispatch-trigger"]');
        return document.activeElement === trigger;
      });
      expect(isTriggerFocused).toBe(true);
    });
  });

  test.describe('KeyboardShortcutsHelp focus trap', () => {
    test('Tab stays within shortcuts help overlay', async ({ page }) => {
      await page.keyboard.press('?');
      await expect(page.getByTestId('shortcuts-help-panel')).toBeVisible();

      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
      }

      const focusedInsidePanel = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="shortcuts-help-panel"]');
        return panel?.contains(document.activeElement) ?? false;
      });
      expect(focusedInsidePanel).toBe(true);
    });
  });

  test.describe('CommandPalette focus trap', () => {
    test('Tab cycles within command palette and does not escape', async ({ page }) => {
      await page.keyboard.press('Control+k');
      await expect(page.getByTestId('command-palette')).toBeVisible();

      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
      }

      const focusedInsidePalette = await page.evaluate(() => {
        const palette = document.querySelector('[data-testid="command-palette"]');
        return palette?.contains(document.activeElement) ?? false;
      });
      expect(focusedInsidePalette).toBe(true);
    });

    test('Shift+Tab stays within command palette', async ({ page }) => {
      await page.keyboard.press('Control+k');
      await expect(page.getByTestId('command-palette')).toBeVisible();

      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Shift+Tab');
      }

      const focusedInsidePalette = await page.evaluate(() => {
        const palette = document.querySelector('[data-testid="command-palette"]');
        return palette?.contains(document.activeElement) ?? false;
      });
      expect(focusedInsidePalette).toBe(true);
    });
  });

  test.describe('NotificationCenter focus trap', () => {
    test('Tab stays within notification dropdown when open with notifications', async ({ page }) => {
      // Fire a kill-all action to produce a notification (so the dropdown has focusable buttons)
      await page.route('**/kubexes/kill-all', async (route) => {
        await route.fulfill({ status: 200, body: JSON.stringify({ status: 'ok', message: 'All kubexes killed' }) });
      });
      await page.goto('/containers');
      await page.getByTestId('kill-all-button').click();
      const dialog = page.getByRole('dialog', { name: /kill all kubexes/i });
      await dialog.getByRole('textbox').fill('KILL ALL');
      await dialog.getByRole('button', { name: /kill all kubexes/i }).click();
      await expect(page.getByTestId('toast')).toBeVisible({ timeout: 3000 });

      // Open notification dropdown — should now have Mark all read + Clear all buttons
      const bell = page.getByTestId('notification-bell');
      await bell.click();
      await expect(page.getByTestId('notification-dropdown')).toBeVisible();
      await expect(page.getByTestId('notification-mark-all-read')).toBeVisible();

      // Tab through elements — should stay within the dropdown
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
      }

      const focusedInsideDropdown = await page.evaluate(() => {
        const dropdown = document.querySelector('[data-testid="notification-dropdown"]');
        return dropdown?.contains(document.activeElement) ?? false;
      });
      expect(focusedInsideDropdown).toBe(true);
    });

    test('notification dropdown opens and renders correctly when empty', async ({ page }) => {
      // When empty (no focusable elements), the hook gracefully does nothing — verify dropdown opens
      const bell = page.getByTestId('notification-bell');
      await bell.click();
      await expect(page.getByTestId('notification-dropdown')).toBeVisible();
      await expect(page.locator('[data-testid="notification-dropdown"]')).toContainText('No notifications yet');
    });
  });
});
