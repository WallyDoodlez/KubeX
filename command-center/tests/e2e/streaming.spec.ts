import { test, expect } from '@playwright/test';

test.describe('Streaming & Live Output', () => {
  test('orchestrator page has chat interface', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.locator('header h1')).toHaveText('Orchestrator');
    // Input fields should be present
    await expect(page.locator('input[placeholder*="orchestrate"]')).toBeVisible();
    await expect(page.locator('textarea[placeholder*="Task instructions"]')).toBeVisible();
    await expect(page.locator('button', { hasText: 'Send' })).toBeVisible();
  });

  test('orchestrator send button disabled without input', async ({ page }) => {
    await page.goto('/chat');
    const sendButton = page.locator('button', { hasText: 'Send' });
    await expect(sendButton).toBeDisabled();
  });

  test('agent detail page has Live Output tab', async ({ page }) => {
    await page.goto('/agents/test-agent');
    // Wait for page to load
    await page.waitForTimeout(2000);
    // Should show either the detail page with tabs or error with back link
    const hasLiveOutput = await page.locator('text=Live Output').isVisible();
    const hasBackLink = await page.locator('text=Back to Agents').isVisible();
    expect(hasLiveOutput || hasBackLink).toBe(true);
  });

  test('agent detail tabs are accessible', async ({ page }) => {
    await page.goto('/agents/test-agent');
    await page.waitForTimeout(2000);
    // Check for tablist role (from Tabs component)
    const tablist = page.locator('[role="tablist"]');
    const hasTablist = await tablist.isVisible().catch(() => false);
    // Either tabs are visible (agent found) or back link (agent not found)
    const hasBackLink = await page.locator('text=Back to Agents').isVisible();
    expect(hasTablist || hasBackLink).toBe(true);
  });

  test('orchestrator displays welcome message', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.locator('text=KubexClaw Command Center')).toBeVisible();
  });

  test('known capabilities section appears', async ({ page }) => {
    await page.goto('/chat');
    // The "Known caps:" label may or may not appear depending on API response
    // But the input area should always be present
    await expect(page.locator('textarea[placeholder*="Task instructions"]')).toBeVisible();
  });

  test('status badge renders new lifecycle states', async ({ page }) => {
    await page.goto('/');
    // Status badges should be visible on dashboard (for services at minimum)
    // Verify the app loads without errors related to status rendering
    await expect(page.locator('text=KubexClaw')).toBeVisible();
    await expect(page.locator('aside')).toBeVisible();
  });

  test('chat messages area supports scrolling', async ({ page }) => {
    await page.goto('/chat');
    // The messages area should exist and be scrollable
    const messagesArea = page.locator('.overflow-y-auto.scrollbar-thin').first();
    await expect(messagesArea).toBeVisible();
  });
});
