/**
 * Iteration 86 — Toast feedback for async operations
 *
 * Tests that toast notifications appear after:
 * - QuickDispatchModal: successful dispatch and dispatch failure
 * - SpawnWizard: successful kubex spawn and spawn failure
 * - AgentRegisterModal: successful registration and registration failure
 * - AgentsPanel: single deregister success, bulk deregister success, deregister failure
 * - OrchestratorChat: task cancel success and cancel failure
 */

import { test, expect } from '@playwright/test';
import {
  mockBaseRoutes,
  isLiveMode,
  isMockMode,
  GATEWAY,
  REGISTRY,
  MANAGER,
  MOCK_AGENTS,
  mockDispatch,
  mockSSEStream,
  mockTaskResult,
  mockTaskCancel,
} from './helpers';

// ── Helpers ──────────────────────────────────────────────────────────

const TOAST = '[data-testid="toast"]';

async function waitForToast(page: import('@playwright/test').Page) {
  const toast = page.locator(TOAST).first();
  await expect(toast).toBeVisible({ timeout: 6000 });
  return toast;
}

// ── QuickDispatchModal ────────────────────────────────────────────────

test.describe('Iteration 86 — QuickDispatch toast', () => {
  test('successful dispatch shows success toast with task ID', async ({ page }) => {
    test.skip(isLiveMode, 'Mock only');
    await mockBaseRoutes(page, { agents: MOCK_AGENTS });
    await mockDispatch(page, 'task-toast-001');

    await page.goto('/');
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).toBeVisible();

    await page.locator('[data-testid="quick-dispatch-capability"]').fill('summarise');
    await page.locator('[data-testid="quick-dispatch-message"]').fill('Please summarise this text.');
    await page.locator('[data-testid="quick-dispatch-submit"]').click();

    const toast = await waitForToast(page);
    await expect(toast).toContainText('task-toast-001');
  });

  test('failed dispatch shows error toast', async ({ page }) => {
    test.skip(isLiveMode, 'Mock only');
    await mockBaseRoutes(page, { agents: MOCK_AGENTS });
    await page.route(`${GATEWAY}/actions`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Service unavailable' }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/');
    await page.locator('[data-testid="quick-dispatch-trigger"]').click();
    await expect(page.locator('[data-testid="quick-dispatch-modal"]')).toBeVisible();

    await page.locator('[data-testid="quick-dispatch-capability"]').fill('summarise');
    await page.locator('[data-testid="quick-dispatch-message"]').fill('Please summarise this text.');
    await page.locator('[data-testid="quick-dispatch-submit"]').click();

    const toast = await waitForToast(page);
    await expect(toast).toContainText('failed');
  });
});

// ── SpawnWizard ───────────────────────────────────────────────────────

const spawnMockAgents = [
  {
    agent_id: 'agent-spawn-alpha',
    capabilities: ['orchestrate', 'summarise'],
    status: 'running',
    boundary: 'default',
  },
];

async function navigateToSpawnReview(page: import('@playwright/test').Page) {
  await page.goto('/spawn');
  await expect(page.locator('[data-testid="spawn-stepper"]')).toBeVisible({ timeout: 8000 });

  // Step 1: fill agent ID
  await page.locator('[data-testid="agent-id-input"]').fill('test-agent-toast');
  await page.locator('[data-testid="wizard-next-btn"]').click();

  // Step 2: select a capability chip
  await expect(page.locator('[data-testid="step-capabilities"]')).toBeVisible({ timeout: 5000 });
  await page.locator('[data-testid="cap-chip-orchestrate"]').click();
  await page.locator('[data-testid="wizard-next-btn"]').click();

  // Step 3: resources — proceed
  await expect(page.locator('[data-testid="step-resources"]')).toBeVisible({ timeout: 5000 });
  await page.locator('[data-testid="wizard-next-btn"]').click();

  // Step 4: review
  await expect(page.locator('[data-testid="spawn-button"]')).toBeVisible({ timeout: 5000 });
}

test.describe('Iteration 86 — SpawnWizard toast', () => {
  test('successful spawn shows success toast with kubex ID', async ({ page }) => {
    test.skip(isLiveMode, 'Mock only');
    await mockBaseRoutes(page, { agents: spawnMockAgents });
    await page.route(`${MANAGER}/kubexes`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ kubex_id: 'kubex-toast-spawn-001', status: 'created' }),
        });
      } else {
        route.continue();
      }
    });

    await navigateToSpawnReview(page);
    await page.locator('[data-testid="spawn-button"]').click();

    const toast = await waitForToast(page);
    await expect(toast).toContainText('kubex-toast-spawn-001');
  });

  test('failed spawn shows error toast', async ({ page }) => {
    test.skip(isLiveMode, 'Mock only');
    await mockBaseRoutes(page, { agents: spawnMockAgents });
    await page.route(`${MANAGER}/kubexes`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Manager offline' }),
        });
      } else {
        route.continue();
      }
    });

    await navigateToSpawnReview(page);
    await page.locator('[data-testid="spawn-button"]').click();

    const toast = await waitForToast(page);
    await expect(toast).toContainText('failed');
  });
});

// ── AgentRegisterModal ────────────────────────────────────────────────

test.describe('Iteration 86 — AgentRegisterModal toast', () => {
  test('successful registration shows success toast with agent ID', async ({ page }) => {
    test.skip(isLiveMode, 'Mock only');
    await mockBaseRoutes(page, { agents: MOCK_AGENTS });
    await page.route(`${REGISTRY}/agents`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ agent_id: 'toast-agent-001', status: 'registered' }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/agents');
    await expect(page.locator('[data-testid="agents-table"]')).toBeVisible({ timeout: 8000 });
    await page.locator('[data-testid="open-register-agent-btn"]').click();
    await expect(page.locator('[data-testid="agent-register-modal"]')).toBeVisible();

    await page.locator('[data-testid="reg-agent-id"]').fill('toast-agent-001');
    await page.locator('[data-testid="reg-capabilities"]').fill('summarise');
    await page.locator('[data-testid="reg-submit-btn"]').click();

    const toast = await waitForToast(page);
    await expect(toast).toContainText('toast-agent-001');
  });

  test('failed registration shows error toast', async ({ page }) => {
    test.skip(isLiveMode, 'Mock only');
    await mockBaseRoutes(page, { agents: MOCK_AGENTS });
    await page.route(`${REGISTRY}/agents`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Agent ID already exists' }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/agents');
    await expect(page.locator('[data-testid="agents-table"]')).toBeVisible({ timeout: 8000 });
    await page.locator('[data-testid="open-register-agent-btn"]').click();
    await expect(page.locator('[data-testid="agent-register-modal"]')).toBeVisible();

    await page.locator('[data-testid="reg-agent-id"]').fill('existing-agent');
    await page.locator('[data-testid="reg-capabilities"]').fill('summarise');
    await page.locator('[data-testid="reg-submit-btn"]').click();

    const toast = await waitForToast(page);
    await expect(toast).toContainText('failed');
  });
});

// ── AgentsPanel deregister ────────────────────────────────────────────

test.describe('Iteration 86 — AgentsPanel deregister toast', () => {
  const AGENT_ID = MOCK_AGENTS[0].agent_id;

  test('single deregister shows success toast', async ({ page }) => {
    test.skip(isLiveMode, 'Mock only');
    await mockBaseRoutes(page, { agents: MOCK_AGENTS });
    await page.route(`${REGISTRY}/agents/${AGENT_ID}`, (route) => {
      if (route.request().method() === 'DELETE') {
        route.fulfill({ status: 204, body: '' });
      } else {
        route.continue();
      }
    });

    await page.goto('/agents');
    await expect(page.locator('[data-testid="agents-table"]')).toBeVisible({ timeout: 8000 });

    // Click the Deregister button in the first agent's row
    await page.locator('button', { hasText: 'Deregister' }).first().click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.locator('dialog[open] button', { hasText: 'Deregister' }).click();

    const toast = await waitForToast(page);
    await expect(toast).toContainText('deregistered');
  });

  test('failed deregister shows error toast', async ({ page }) => {
    test.skip(isLiveMode, 'Mock only');
    await mockBaseRoutes(page, { agents: MOCK_AGENTS });
    await page.route(`${REGISTRY}/agents/${AGENT_ID}`, (route) => {
      if (route.request().method() === 'DELETE') {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Deregister failed' }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/agents');
    await expect(page.locator('[data-testid="agents-table"]')).toBeVisible({ timeout: 8000 });

    await page.locator('button', { hasText: 'Deregister' }).first().click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.locator('dialog[open] button', { hasText: 'Deregister' }).click();

    const toast = await waitForToast(page);
    await expect(toast).toContainText('failed');
  });

  test('bulk deregister shows count in success toast', async ({ page }) => {
    test.skip(isLiveMode, 'Mock only');
    await mockBaseRoutes(page, { agents: MOCK_AGENTS });
    for (const agent of MOCK_AGENTS) {
      await page.route(`${REGISTRY}/agents/${agent.agent_id}`, (route) => {
        if (route.request().method() === 'DELETE') {
          route.fulfill({ status: 204, body: '' });
        } else {
          route.continue();
        }
      });
    }

    await page.goto('/agents');
    await expect(page.locator('[data-testid="agents-table"]')).toBeVisible({ timeout: 8000 });

    // Select all agents via header checkbox
    await page.locator('[data-testid="agents-select-all"]').click();
    await page.locator('[data-testid="agents-bulk-deregister"]').click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.locator('dialog[open] button', { hasText: 'Deregister' }).click();

    const toast = await waitForToast(page);
    await expect(toast).toContainText('deregistered');
  });
});

// ── OrchestratorChat cancel ───────────────────────────────────────────

const CANCEL_TASK_ID = 'chat-cancel-toast-001';

async function setupCancelToastRoutes(page: import('@playwright/test').Page) {
  await mockBaseRoutes(page, { agents: [], kubexes: [] });
  await mockDispatch(page, CANCEL_TASK_ID, { task_id: CANCEL_TASK_ID, status: 'accepted' });
  // Non-terminating stream — keeps task in-flight so cancel button appears
  await mockSSEStream(page, CANCEL_TASK_ID, '');
  await mockTaskResult(page, CANCEL_TASK_ID, { task_id: CANCEL_TASK_ID, status: 'cancelled', result: 'Cancelled' });
}

test.describe('Iteration 86 — OrchestratorChat cancel toast', () => {
  test('successful task cancel shows success toast', async ({ page }) => {
    test.skip(isLiveMode, 'Mock only');
    await setupCancelToastRoutes(page);
    await mockTaskCancel(page, CANCEL_TASK_ID);

    await page.goto('/chat');
    await page.locator('[data-testid="message-input"]').fill('Run a long background job');
    await page.locator('button', { hasText: 'Send' }).click();

    // Wait for cancel button to appear (task in-flight)
    const btnTimeout = isMockMode ? 5000 : 15000;
    await expect(page.locator('[data-testid="cancel-task-button"]')).toBeVisible({ timeout: btnTimeout });
    await page.locator('[data-testid="cancel-task-button"]').click();

    const toast = await waitForToast(page);
    await expect(toast).toContainText('cancelled');
  });

  test('failed task cancel shows error toast', async ({ page }) => {
    test.skip(isLiveMode, 'Mock only');
    await setupCancelToastRoutes(page);
    await page.route(`${GATEWAY}/tasks/${CANCEL_TASK_ID}/cancel`, (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Cancel failed' }),
      });
    });

    await page.goto('/chat');
    await page.locator('[data-testid="message-input"]').fill('Run a long background job');
    await page.locator('button', { hasText: 'Send' }).click();

    const btnTimeout = isMockMode ? 5000 : 15000;
    await expect(page.locator('[data-testid="cancel-task-button"]')).toBeVisible({ timeout: btnTimeout });
    await page.locator('[data-testid="cancel-task-button"]').click();

    const toast = await waitForToast(page);
    await expect(toast).toContainText('failed');
  });
});
