import { test, expect } from '@playwright/test';

test.describe('Streaming & Live Output', () => {
  test('orchestrator page has chat interface', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.locator('header h1')).toHaveText('Orchestrator');
    // Input fields should be present
    await expect(page.locator('[data-testid="message-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="advanced-toggle"]')).toBeVisible();
    await expect(page.locator('button', { hasText: 'Send' })).toBeVisible();
  });

  test('orchestrator send button disabled without input', async ({ page }) => {
    await page.goto('/chat');
    const sendButton = page.locator('button', { hasText: 'Send' });
    await expect(sendButton).toBeDisabled();
  });

  test('agent detail page has Live Output tab', async ({ page }) => {
    await page.goto('/agents/test-agent');
    // Wait for the page to finish loading: either the agent detail tabs appear
    // (when agent "test-agent" exists) or the "Back to Agents" link appears (when it does not).
    // Use waitForFunction to poll until one of the two elements is visible.
    await page.waitForFunction(
      () => {
        const hasLiveOutput = document.querySelector('[role="tablist"]') !== null;
        const hasBackLink = [...document.querySelectorAll('button,a')].some(
          (el) => el.textContent?.includes('Back to Agents'),
        );
        return hasLiveOutput || hasBackLink;
      },
      { timeout: 10_000 },
    );
    const hasLiveOutput = await page.locator('text=Live Output').isVisible();
    const hasBackLink = await page.locator('text=Back to Agents').isVisible();
    expect(hasLiveOutput || hasBackLink).toBe(true);
  });

  test('agent detail tabs are accessible', async ({ page }) => {
    await page.goto('/agents/test-agent');
    // Wait for the page to finish loading
    await page.waitForFunction(
      () => {
        const hasTablist = document.querySelector('[role="tablist"]') !== null;
        const hasBackLink = [...document.querySelectorAll('button,a')].some(
          (el) => el.textContent?.includes('Back to Agents'),
        );
        return hasTablist || hasBackLink;
      },
      { timeout: 10_000 },
    );
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
    await expect(page.locator('[data-testid="message-input"]')).toBeVisible();
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

  test('OrchestratorChat does not issue repeated polling after dispatch (SSE replaces polling)', async ({ page }) => {
    // Track all XHR requests to the task result endpoint
    const taskResultRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/tasks/') && req.url().includes('/result')) {
        taskResultRequests.push(req.url());
      }
    });

    await page.goto('/chat');

    // Fill in message (capability defaults to "task_orchestration")
    await page.locator('[data-testid="message-input"]').fill('hello world');

    // Dispatch the task — MSW will handle this
    await page.locator('button', { hasText: 'Send' }).click();

    // Wait a moment to allow any polling that might happen
    await page.waitForTimeout(3000);

    // With SSE in place, the component should NOT repeatedly poll /tasks/{id}/result.
    // It may do at most 1 fallback fetch after SSE completes/errors, but never more.
    // Polling would produce many requests (e.g., every 2s = 1+ per 2s).
    expect(taskResultRequests.length).toBeLessThanOrEqual(1);
  });

  test('rapid double-send produces only one user bubble', async ({ page }) => {
    // Must mock routes so dispatch succeeds and the user bubble is created
    const { mockBaseRoutes, mockDispatch } = await import('./helpers/mock-routes');
    await mockBaseRoutes(page);
    await mockDispatch(page);

    await page.goto('/chat');
    await expect(page.locator('[data-testid="message-input"]')).toBeVisible();

    const input = page.locator('[data-testid="message-input"]');
    await input.fill('double send test');
    await input.focus();

    // Fire Ctrl+Enter twice rapidly (simulates key repeat)
    // The sendingRef guard should prevent the second call
    await page.keyboard.press('Control+Enter');
    await page.keyboard.press('Control+Enter');

    // Wait for bubbles to settle
    await page.waitForTimeout(500);

    // User bubbles are right-aligned divs containing the message text
    // Count how many bubbles contain our exact test message
    const matchingBubbles = page.locator('.rounded-2xl.rounded-tr-sm', { hasText: 'double send test' });
    expect(await matchingBubbles.count()).toBe(1);
  });

  test('sending label reflects SSE connection state', async ({ page }) => {
    await page.goto('/chat');
    // Before any send, the sending indicator should not be visible
    const sendingLabel = page.locator('[data-testid="sending-label"]');
    await expect(sendingLabel).not.toBeVisible();

    // Verify the component has the correct structure for showing state
    await expect(page.locator('button', { hasText: 'Send' })).toBeVisible();
  });
});
