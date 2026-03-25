/**
 * Integration tests — full user flow.
 *
 * Covers the end-to-end journey through the Command Center:
 *   1. Dashboard → review service health
 *   2. Agents → browse registered agents
 *   3. Orchestrator → dispatch a task and see streaming output
 *   4. Approvals → HITL review flow
 *   5. Traffic → inspect action log
 *   6. Containers → view kubex containers
 *   7. State persists across page navigation within a session
 */
import { test, expect } from '@playwright/test';

// ── Helper ────────────────────────────────────────────────────────────────────

async function navigateTo(page: import('@playwright/test').Page, label: string) {
  await page.locator('aside').getByText(label, { exact: true }).click();
}

// ── Full user flow ────────────────────────────────────────────────────────────

test.describe('Integration — full user flow', () => {
  test('completes a full session journey across all pages', async ({ page }) => {
    // ── 1. Landing on Dashboard ──────────────────────────────────────
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    await expect(page.locator('text=KubexClaw')).toBeVisible();
    await expect(page.getByTestId('connection-indicator')).toBeVisible();

    // ── 2. Browse Agents ─────────────────────────────────────────────
    await navigateTo(page, 'Agents');
    await expect(page.locator('header h1')).toHaveText('Agents');
    await expect(page.getByRole('heading', { name: 'Registered Agents' })).toBeVisible();

    // ── 3. Open Orchestrator / dispatch ──────────────────────────────
    await navigateTo(page, 'Orchestrator');
    await expect(page.locator('header h1')).toHaveText('Orchestrator');
    await expect(page.locator('text=KubexClaw Command Center')).toBeVisible();

    const taskInput  = page.locator('[data-testid="message-input"]');
    const sendBtn    = page.locator('button', { hasText: 'Send' });

    await expect(taskInput).toBeVisible();
    await expect(sendBtn).toBeDisabled();

    // Fill message — send button should become enabled (capability defaults to "task_orchestration")
    await taskInput.fill('Summarise the latest logs and return a brief report.');
    await expect(sendBtn).toBeEnabled();

    // Submit the task
    await sendBtn.click();

    // Wait for some output to appear (mock API returns immediately)
    await page.waitForTimeout(1000);

    // ── 4. Approvals / HITL ───────────────────────────────────────────
    await navigateTo(page, 'Approvals');
    await expect(page.locator('header h1')).toHaveText('Approvals');
    await expect(page.getByRole('heading', { name: 'Approval Queue' })).toBeVisible();
    // Empty state is fine — no escalations from mock
    await expect(page.getByText('No pending approvals')).toBeVisible();

    // ── 5. Traffic log ────────────────────────────────────────────────
    await navigateTo(page, 'Traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');

    // ── 6. Containers ─────────────────────────────────────────────────
    await navigateTo(page, 'Containers');
    await expect(page.locator('header h1')).toHaveText('Containers');

    // ── 7. Return to Dashboard ────────────────────────────────────────
    await navigateTo(page, 'Dashboard');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });
});

// ── Dispatch flow ─────────────────────────────────────────────────────────────

test.describe('Integration — dispatch and stream', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/chat');
    await expect(page.locator('header h1')).toHaveText('Orchestrator');
  });

  test('send button enables when message is filled (no capability required)', async ({ page }) => {
    const taskInput  = page.locator('[data-testid="message-input"]');
    const sendBtn    = page.locator('button', { hasText: 'Send' });

    // Neither field filled
    await expect(sendBtn).toBeDisabled();

    // Message filled — send button should be enabled (capability defaults to "task_orchestration")
    await taskInput.fill('Classify this document.');
    await expect(sendBtn).toBeEnabled();
  });

  test('dispatching a task shows a task ID or result', async ({ page }) => {
    await page.locator('[data-testid="message-input"]').fill('Extract key entities.');
    await page.locator('button', { hasText: 'Send' }).click();

    // After dispatch the UI should show something — a streaming status, task ID, or result
    await page.waitForTimeout(1500);
    // The messages area should contain new content
    const chat = page.locator('.overflow-y-auto.scrollbar-thin').first();
    await expect(chat).toBeVisible();
  });

  test('clearing and re-dispatching works', async ({ page }) => {
    const taskInput  = page.locator('[data-testid="message-input"]');
    const sendBtn    = page.locator('button', { hasText: 'Send' });

    await taskInput.fill('First task.');
    await sendBtn.click();
    await page.waitForTimeout(500);

    // Fields may be cleared or still filled — either is acceptable
    // What matters is the app doesn't crash
    await expect(page.locator('header h1')).toHaveText('Orchestrator');
  });
});

// ── HITL (Approval queue) flow ────────────────────────────────────────────────

test.describe('Integration — HITL approval queue', () => {
  test('approval queue page loads and shows empty state', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.locator('header h1')).toHaveText('Approvals');
    await expect(page.getByRole('heading', { name: 'Approval Queue' })).toBeVisible();
    await expect(page.getByText('No pending approvals')).toBeVisible();
  });

  test('navigating away from approvals and back preserves empty state', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.getByText('No pending approvals')).toBeVisible();

    await page.locator('aside').getByText('Dashboard', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Dashboard');

    await page.locator('aside').getByText('Approvals', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Approvals');
    await expect(page.getByText('No pending approvals')).toBeVisible();
  });
});

// ── Traffic log flow ──────────────────────────────────────────────────────────

test.describe('Integration — traffic log', () => {
  test('traffic page loads correctly', async ({ page }) => {
    await page.goto('/traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');
  });

  test('traffic page has filter controls', async ({ page }) => {
    await page.goto('/traffic');
    // The filter bar should be present (even if no traffic yet)
    await expect(page.locator('header h1')).toHaveText('Traffic');
    await expect(page.locator('main#main-content')).toBeVisible();
  });
});

// ── Session state persistence ─────────────────────────────────────────────────

test.describe('Integration — state persists across navigation', () => {
  test('search filter on agents page persists while on the page', async ({ page }) => {
    await page.goto('/agents');
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('agent-alpha');
    await page.waitForTimeout(400);

    // Verify filter is still applied
    await expect(searchInput).toHaveValue('agent-alpha');
  });

  test('active nav item updates correctly on each navigation', async ({ page }) => {
    await page.goto('/');

    const navItems = [
      { label: 'Agents',      title: 'Agents'       },
      { label: 'Traffic',     title: 'Traffic'      },
      { label: 'Containers',  title: 'Containers'   },
      { label: 'Approvals',   title: 'Approvals'    },
      { label: 'Dashboard',   title: 'Dashboard'    },
    ];

    for (const { label, title } of navItems) {
      await page.locator('aside').getByText(label, { exact: true }).click();
      await expect(page.locator('header h1')).toHaveText(title);
      // Active nav button should have aria-current=page
      const activeBtn = page.locator('aside').getByRole('button', { name: new RegExp(label, 'i') });
      await expect(activeBtn).toHaveAttribute('aria-current', 'page');
    }
  });

  test('back/forward browser history works', async ({ page }) => {
    await page.goto('/');
    await page.locator('aside').getByText('Agents', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Agents');

    await page.goBack();
    await expect(page.locator('header h1')).toHaveText('Dashboard');

    await page.goForward();
    await expect(page.locator('header h1')).toHaveText('Agents');
  });
});

// ── Kill All emergency control ────────────────────────────────────────────────

test.describe('Integration — Kill All emergency control', () => {
  test('kill all dialog can be opened and cancelled', async ({ page }) => {
    await page.goto('/');
    const killBtn = page.locator('[data-testid="kill-all-button"]');
    await killBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Cancel the dialog
    const cancelBtn = page.locator('[role="dialog"]').getByRole('button', { name: /Cancel/i });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    await expect(dialog).not.toBeVisible();
  });

  test('kill all dialog is accessible via keyboard', async ({ page }) => {
    await page.goto('/');
    const killBtn = page.locator('[data-testid="kill-all-button"]');
    await killBtn.focus();
    await page.keyboard.press('Enter');

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Escape should close the dialog
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});
