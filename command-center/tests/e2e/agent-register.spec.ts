import { test, expect } from '@playwright/test';
import {
  mockBaseRoutes,
  mockAgentRegister,
  isLiveMode,
  REGISTRY,
  MOCK_AGENTS,
} from './helpers';

/**
 * Iteration 73 — Agent Registration Form
 *
 * Tests cover the "Register Agent" modal in AgentsPanel:
 * - "Register Agent" button renders in the Agents page header
 * - Modal opens when button is clicked
 * - Modal has all expected form fields (agent ID, capabilities, boundary, status, metadata)
 * - Close button dismisses the modal
 * - Cancel button dismisses the modal
 * - Escape key dismisses the modal
 * - Submit with empty agent ID shows validation error
 * - Submit with empty capabilities shows validation error
 * - Submit with invalid capability name shows validation error
 * - Submit with invalid JSON metadata shows validation error
 * - Successful registration shows success banner
 * - Successful registration closes modal and refreshes agent list
 * - Failed registration (API error) shows error banner and stays open
 * - Boundary defaults to "default"
 * - Status selector defaults to "Unknown"
 * - All valid status options are present
 * - Agent ID field accepts valid identifiers
 * - Metadata field is optional — no error when left blank
 */

const REGISTERED_AGENT = {
  agent_id: 'new-test-agent',
  capabilities: ['translate'],
  status: 'unknown',
  boundary: 'default',
  metadata: {},
  registered_at: '2026-03-24T10:00:00Z',
};

async function mockApis(
  page: import('@playwright/test').Page,
  opts: { registerStatus?: number; registerBody?: unknown } = {},
) {
  const { registerStatus = 200, registerBody = REGISTERED_AGENT } = opts;

  // Registry GET/POST /agents — base routes handle GET; override POST for registration
  await mockBaseRoutes(page, { agents: MOCK_AGENTS, kubexes: [] });

  // Override the agents route to also handle POST (registration)
  await page.route(`${REGISTRY}/agents`, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: registerStatus,
        contentType: 'application/json',
        body: JSON.stringify(registerStatus === 200 ? registerBody : { detail: 'Agent ID already exists' }),
      });
    } else {
      await route.continue();
    }
  });
}

test.describe('Agent Registration Form', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page);
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents', { timeout: 10000 });
    await expect(page.getByTestId('open-register-agent-btn')).toBeVisible({ timeout: 10000 });
  });

  test('Register Agent button is visible in header', async ({ page }) => {
    await expect(page.getByTestId('open-register-agent-btn')).toBeVisible();
    await expect(page.getByTestId('open-register-agent-btn')).toHaveText('+ Register Agent');
  });

  test('clicking Register Agent opens the modal', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await expect(page.getByTestId('agent-register-modal')).toBeVisible();
  });

  test('modal has Agent ID field', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await expect(page.getByTestId('reg-agent-id')).toBeVisible();
  });

  test('modal has Capabilities field', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await expect(page.getByTestId('reg-capabilities')).toBeVisible();
  });

  test('modal has Boundary field defaulted to "default"', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await expect(page.getByTestId('reg-boundary')).toHaveValue('default');
  });

  test('modal has Status selector defaulted to Unknown', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await expect(page.getByTestId('reg-status')).toHaveValue('unknown');
  });

  test('status selector has all expected options', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    const select = page.getByTestId('reg-status');
    await expect(select.locator('option[value="unknown"]')).toHaveCount(1);
    await expect(select.locator('option[value="running"]')).toHaveCount(1);
    await expect(select.locator('option[value="busy"]')).toHaveCount(1);
    await expect(select.locator('option[value="stopped"]')).toHaveCount(1);
  });

  test('modal has Metadata textarea', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await expect(page.getByTestId('reg-metadata')).toBeVisible();
  });

  test('close button dismisses the modal', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await expect(page.getByTestId('agent-register-modal')).toBeVisible();
    await page.getByTestId('agent-register-close-btn').click();
    await expect(page.getByTestId('agent-register-modal')).not.toBeVisible();
  });

  test('Cancel button dismisses the modal', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await page.getByTestId('reg-cancel-btn').click();
    await expect(page.getByTestId('agent-register-modal')).not.toBeVisible();
  });

  test('Escape key dismisses the modal', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await expect(page.getByTestId('agent-register-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('agent-register-modal')).not.toBeVisible();
  });

  test('submit with empty agent ID shows validation error', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await page.getByTestId('reg-capabilities').fill('translate');
    await page.getByTestId('reg-submit-btn').click();
    await expect(page.getByTestId('reg-agent-id-error')).toBeVisible();
    await expect(page.getByTestId('reg-agent-id-error')).toContainText('required');
  });

  test('submit with empty capabilities shows validation error', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await page.getByTestId('reg-agent-id').fill('my-new-agent');
    await page.getByTestId('reg-submit-btn').click();
    await expect(page.getByTestId('reg-capabilities-error')).toBeVisible();
    await expect(page.getByTestId('reg-capabilities-error')).toContainText('At least one capability');
  });

  test('submit with invalid capability name shows validation error', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await page.getByTestId('reg-agent-id').fill('my-new-agent');
    await page.getByTestId('reg-capabilities').fill('valid, inv@lid!');
    await page.getByTestId('reg-submit-btn').click();
    await expect(page.getByTestId('reg-capabilities-error')).toBeVisible();
    await expect(page.getByTestId('reg-capabilities-error')).toContainText('Invalid capability');
  });

  test('submit with invalid JSON metadata shows validation error', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await page.getByTestId('reg-agent-id').fill('my-new-agent');
    await page.getByTestId('reg-capabilities').fill('translate');
    await page.getByTestId('reg-metadata').fill('not valid json {{{');
    await page.getByTestId('reg-submit-btn').click();
    await expect(page.getByTestId('reg-metadata-error')).toBeVisible();
    await expect(page.getByTestId('reg-metadata-error')).toContainText('Invalid JSON');
  });

  test('metadata field is optional — no error when blank', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await page.getByTestId('reg-agent-id').fill('new-test-agent');
    await page.getByTestId('reg-capabilities').fill('translate');
    // Leave metadata blank
    await page.getByTestId('reg-submit-btn').click();
    // Should not show metadata error
    await expect(page.getByTestId('reg-metadata-error')).not.toBeVisible();
  });

  test('successful registration shows success banner', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await page.getByTestId('reg-agent-id').fill('new-test-agent');
    await page.getByTestId('reg-capabilities').fill('translate');
    await page.getByTestId('reg-submit-btn').click();
    await expect(page.getByTestId('reg-success-banner')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('reg-success-banner')).toContainText('new-test-agent');
  });

  test('successful registration shows Done button instead of Submit/Cancel', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await page.getByTestId('reg-agent-id').fill('new-test-agent');
    await page.getByTestId('reg-capabilities').fill('translate');
    await page.getByTestId('reg-submit-btn').click();
    await expect(page.getByTestId('reg-done-btn')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('reg-submit-btn')).not.toBeVisible();
    await expect(page.getByTestId('reg-cancel-btn')).not.toBeVisible();
  });

  test('Done button closes modal after successful registration', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await page.getByTestId('reg-agent-id').fill('new-test-agent');
    await page.getByTestId('reg-capabilities').fill('translate');
    await page.getByTestId('reg-submit-btn').click();
    await expect(page.getByTestId('reg-done-btn')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('reg-done-btn').click();
    await expect(page.getByTestId('agent-register-modal')).not.toBeVisible();
  });

  test('agent ID with hyphens and underscores is valid', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await page.getByTestId('reg-agent-id').fill('my-agent_01');
    // No error on blur
    await page.getByTestId('reg-capabilities').focus();
    await expect(page.getByTestId('reg-agent-id-error')).not.toBeVisible();
  });

  test('modal title says Register Agent', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await expect(page.getByRole('dialog', { name: 'Register Agent' })).toBeVisible();
  });

  test('clicking backdrop closes modal', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await expect(page.getByTestId('agent-register-modal')).toBeVisible();
    // Click the backdrop (the modal overlay itself, not the inner panel)
    await page.mouse.click(10, 10);
    await expect(page.getByTestId('agent-register-modal')).not.toBeVisible();
  });

  test('form resets between open/close cycles', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await page.getByTestId('reg-agent-id').fill('temporary-value');
    await page.getByTestId('reg-cancel-btn').click();
    // Reopen
    await page.getByTestId('open-register-agent-btn').click();
    await expect(page.getByTestId('reg-agent-id')).toHaveValue('');
  });

  test('valid metadata JSON object is accepted without error', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await page.getByTestId('reg-agent-id').fill('new-test-agent');
    await page.getByTestId('reg-capabilities').fill('translate');
    await page.getByTestId('reg-metadata').fill('{"version": "1.0", "team": "infra"}');
    await page.getByTestId('reg-submit-btn').click();
    await expect(page.getByTestId('reg-metadata-error')).not.toBeVisible();
    await expect(page.getByTestId('reg-success-banner')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Agent Registration — API failure', () => {
  test.skip(isLiveMode, 'Error-simulation tests only run in mock mode');

  test.beforeEach(async ({ page }) => {
    await mockApis(page, { registerStatus: 409, registerBody: { detail: 'Agent ID already exists' } });
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents', { timeout: 10000 });
    await expect(page.getByTestId('open-register-agent-btn')).toBeVisible({ timeout: 10000 });
  });

  test('API error shows error banner and keeps modal open', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await page.getByTestId('reg-agent-id').fill('agent-alpha-001');
    await page.getByTestId('reg-capabilities').fill('summarise');
    await page.getByTestId('reg-submit-btn').click();
    await expect(page.getByTestId('reg-error-banner')).toBeVisible({ timeout: 5000 });
    // Modal should remain open
    await expect(page.getByTestId('agent-register-modal')).toBeVisible();
  });

  test('can retry after API error', async ({ page }) => {
    await page.getByTestId('open-register-agent-btn').click();
    await page.getByTestId('reg-agent-id').fill('agent-alpha-001');
    await page.getByTestId('reg-capabilities').fill('summarise');
    await page.getByTestId('reg-submit-btn').click();
    await expect(page.getByTestId('reg-error-banner')).toBeVisible({ timeout: 5000 });
    // Submit button should still be visible for retry
    await expect(page.getByTestId('reg-submit-btn')).toBeVisible();
  });
});
