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

  test('send button is disabled with only capability filled', async ({ page }) => {
    const capInput = page.locator('input[placeholder*="orchestrate"]');
    await capInput.fill('test-capability');
    const sendButton = page.locator('button', { hasText: 'Send' });
    await expect(sendButton).toBeDisabled();
  });

  test('shows validation error for invalid capability characters', async ({ page }) => {
    const capInput = page.locator('input[placeholder*="orchestrate"]');
    // Type invalid characters (spaces, special chars)
    await capInput.fill('invalid capability!@#');
    // Should show validation error
    await expect(page.locator('text=Only letters')).toBeVisible();
  });
});
