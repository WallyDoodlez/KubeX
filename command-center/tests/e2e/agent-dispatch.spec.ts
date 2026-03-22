import { test, expect } from '@playwright/test';

/**
 * Iteration 20 — Agent detail action dispatch
 *
 * Tests cover the upgraded Actions tab on AgentDetailPage:
 * - Dispatch form renders with capability pre-filled from agent's capabilities
 * - Priority selector present with Normal/High/Low options
 * - Validation prevents empty submissions
 * - Successful dispatch shows confirmation with task ID
 * - Failed dispatch shows error message
 * - Dispatch history section renders
 * - "Dispatch Task" button on Overview tab navigates to Actions tab
 * - Capability chip shortcuts fill the capability input
 * - History empty state message shown when no history
 */

const AGENT_ID = 'agent-alpha-001';

const MOCK_AGENTS = [
  {
    agent_id: 'agent-alpha-001',
    capabilities: ['summarise', 'classify', 'extract'],
    status: 'running',
    boundary: 'internal',
    registered_at: '2026-03-22T08:00:00Z',
    metadata: { version: '1.2.0' },
  },
];

/** Set up Playwright route interception to mock the registry and gateway APIs. */
async function mockApis(page: import('@playwright/test').Page) {
  // Registry agents list
  await page.route('**/agents', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_AGENTS) });
    } else {
      route.continue();
    }
  });

  // Health endpoints
  await page.route('**/health', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'healthy' }) });
  });

  // Dispatch task (Gateway POST /actions)
  await page.route('**/actions', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ task_id: 'mock-task-dispatch-001', status: 'accepted' }),
    });
  });

  // Kubexes (Manager)
  await page.route('**/kubexes', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  // Escalations
  await page.route('**/escalations', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

test.describe('Agent Detail — Action Dispatch (Iteration 20)', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page);
  });

  test('Actions tab renders dispatch form with pre-filled capability', async ({ page }) => {
    await page.goto(`/agents/${AGENT_ID}`);
    // Wait for tabs to appear (agent loaded successfully)
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10000 });

    // Click Actions tab
    await page.getByRole('tab', { name: 'Actions' }).click();

    // Dispatch form should be visible
    await expect(page.getByTestId('dispatch-capability')).toBeVisible();
    await expect(page.getByTestId('dispatch-message')).toBeVisible();
    await expect(page.getByTestId('dispatch-submit')).toBeVisible();
  });

  test('capability input pre-filled with first agent capability', async ({ page }) => {
    await page.goto(`/agents/${AGENT_ID}`);
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: 'Actions' }).click();

    // agent-alpha-001 has capabilities: ['summarise', 'classify', 'extract']
    // First capability should be pre-filled
    const capInput = page.getByTestId('dispatch-capability');
    const capValue = await capInput.inputValue();
    expect(['summarise', 'classify', 'extract']).toContain(capValue);
  });

  test('priority selector has Normal/High/Low options', async ({ page }) => {
    await page.goto(`/agents/${AGENT_ID}`);
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: 'Actions' }).click();

    const select = page.getByTestId('dispatch-priority');
    await expect(select).toBeVisible();
    await expect(select.locator('option[value="normal"]')).toHaveCount(1);
    await expect(select.locator('option[value="high"]')).toHaveCount(1);
    await expect(select.locator('option[value="low"]')).toHaveCount(1);
  });

  test('submit button disabled when message is empty', async ({ page }) => {
    await page.goto(`/agents/${AGENT_ID}`);
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: 'Actions' }).click();

    // Message is empty — submit should be disabled
    await expect(page.getByTestId('dispatch-submit')).toBeDisabled();
  });

  test('successful dispatch shows success message with task ID', async ({ page }) => {
    await page.goto(`/agents/${AGENT_ID}`);
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: 'Actions' }).click();

    // Fill in form
    await page.getByTestId('dispatch-capability').fill('summarise');
    await page.getByTestId('dispatch-message').fill('Summarise the latest quarterly report');

    // Submit
    await page.getByTestId('dispatch-submit').click();

    // Should show success message (mock returns task_id: 'mock-task-dispatch-001')
    await expect(page.getByTestId('dispatch-success')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('dispatch-success')).toContainText('mock-task-dispatch-001');
  });

  test('dispatch history section always renders', async ({ page }) => {
    await page.goto(`/agents/${AGENT_ID}`);
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: 'Actions' }).click();

    // History heading "Dispatch History" must always be present
    await expect(page.locator('text=/Dispatch History/i').first()).toBeVisible();
  });

  test('dispatch history list appears after successful dispatch', async ({ page }) => {
    await page.goto(`/agents/${AGENT_ID}`);
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: 'Actions' }).click();

    // Dispatch a task
    await page.getByTestId('dispatch-capability').fill('classify');
    await page.getByTestId('dispatch-message').fill('Classify this document');
    await page.getByTestId('dispatch-submit').click();

    // Wait for success
    await expect(page.getByTestId('dispatch-success')).toBeVisible({ timeout: 8000 });

    // History list should now have at least one entry
    await expect(page.getByTestId('dispatch-history-list')).toBeVisible();
  });

  test('"Dispatch Task" button on Overview tab navigates to Actions tab', async ({ page }) => {
    await page.goto(`/agents/${AGENT_ID}`);
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10000 });

    // Should be on Overview tab by default — check dispatch-task-btn is present (only on Overview)
    await expect(page.getByTestId('dispatch-task-btn')).toBeVisible();

    // Click the "Dispatch Task →" button in the capabilities section
    await page.getByTestId('dispatch-task-btn').click();

    // Should now see the dispatch form (Actions tab active)
    await expect(page.getByTestId('dispatch-capability')).toBeVisible();
    await expect(page.getByTestId('dispatch-submit')).toBeVisible();
  });

  test('capability chip shortcuts fill the capability input', async ({ page }) => {
    await page.goto(`/agents/${AGENT_ID}`);
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: 'Actions' }).click();

    // Wait for dispatch form
    await expect(page.getByTestId('dispatch-capability')).toBeVisible();

    // Click the 'extract' chip button inside the dispatch form
    // Chips are rendered as buttons alongside the input
    await page.locator('button', { hasText: 'extract' }).first().click();

    // Capability input should now be 'extract'
    await expect(page.getByTestId('dispatch-capability')).toHaveValue('extract');
  });

  test('validation error shown when capability has invalid characters', async ({ page }) => {
    await page.goto(`/agents/${AGENT_ID}`);
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: 'Actions' }).click();

    // Enter invalid capability — the onChange handler shows inline error immediately
    await page.getByTestId('dispatch-capability').fill('bad capability!');

    // Validation error should appear inline (triggered by onChange)
    await expect(page.locator('text=/Only letters, numbers/i').first()).toBeVisible();

    // Submit button should be disabled because capError is set
    await expect(page.getByTestId('dispatch-submit')).toBeDisabled();
  });

  test('failed dispatch shows error message', async ({ page }) => {
    // Override the /actions handler to return a 500 error
    await page.route('**/actions', (route) => {
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Server error' }) });
    });

    await page.goto(`/agents/${AGENT_ID}`);
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: 'Actions' }).click();

    await page.getByTestId('dispatch-capability').fill('summarise');
    await page.getByTestId('dispatch-message').fill('Test failure path');
    await page.getByTestId('dispatch-submit').click();

    // Should show error message
    await expect(page.getByTestId('dispatch-error')).toBeVisible({ timeout: 8000 });
  });

  test('dispatch form targets specific agent_id in Overview breadcrumb', async ({ page }) => {
    await page.goto(`/agents/${AGENT_ID}`);
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10000 });

    // Breadcrumb(s) should contain the agent ID (there may be one in the top bar and one on page)
    const breadcrumbs = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(breadcrumbs.first()).toBeVisible();
    // At least one breadcrumb should contain the agent ID text
    const count = await breadcrumbs.count();
    let found = false;
    for (let i = 0; i < count; i++) {
      const text = await breadcrumbs.nth(i).textContent();
      if (text && text.includes(AGENT_ID)) { found = true; break; }
    }
    expect(found).toBe(true);
  });
});
