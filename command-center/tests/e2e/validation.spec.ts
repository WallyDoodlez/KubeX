import { test, expect } from '@playwright/test';

test.describe('Input Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/chat');
    await expect(page.locator('header h1')).toHaveText('Orchestrator');
  });

  test('send button is disabled when inputs are empty', async ({ page }) => {
    const sendButton = page.locator('button', { hasText: 'Send' });
    await expect(sendButton).toBeDisabled();
  });

  test('send button is enabled with only message filled (capability defaults to task_orchestration)', async ({ page }) => {
    await page.locator('[data-testid="message-input"]').fill('test message');
    const sendButton = page.locator('button', { hasText: 'Send' });
    await expect(sendButton).toBeEnabled();
  });

  test('shows validation error for invalid capability characters in Advanced panel', async ({ page }) => {
    // Open Advanced panel first
    await page.locator('[data-testid="advanced-toggle"]').click();
    const capInput = page.locator('[data-testid="capability-input"]');
    // Type invalid characters (spaces, special chars)
    await capInput.fill('invalid capability!@#');
    // Should show validation error
    await expect(page.locator('text=Only letters')).toBeVisible();
  });
});
