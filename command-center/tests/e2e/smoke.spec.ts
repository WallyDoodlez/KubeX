import { test, expect } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────

/** Click a sidebar nav item by its label text. */
async function clickNav(page: import('@playwright/test').Page, label: string) {
  await page.locator('aside').getByText(label, { exact: true }).click();
}

// ── Smoke Tests ──────────────────────────────────────────────────────

test.describe('Smoke Tests', () => {
  test('loads the app', async ({ page }) => {
    await page.goto('/');

    // Brand name in sidebar should be visible
    await expect(page.locator('text=KubexClaw')).toBeVisible();

    // Sidebar navigation labels should be present
    await expect(page.locator('aside').getByText('Dashboard', { exact: true })).toBeVisible();
    await expect(page.locator('aside').getByText('Agents', { exact: true })).toBeVisible();
    await expect(page.locator('aside').getByText('Traffic', { exact: true })).toBeVisible();
    await expect(page.locator('aside').getByText('Orchestrator', { exact: true })).toBeVisible();
    await expect(page.locator('aside').getByText('Containers', { exact: true })).toBeVisible();
  });

  test('navigates between pages via sidebar', async ({ page }) => {
    await page.goto('/');

    // Default landing: Dashboard
    await expect(page.locator('header h1')).toHaveText('Dashboard');

    // Navigate to Agents
    await clickNav(page, 'Agents');
    await expect(page.locator('header h1')).toHaveText('Agents');

    // Navigate to Traffic
    await clickNav(page, 'Traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');

    // Navigate to Orchestrator
    await clickNav(page, 'Orchestrator');
    await expect(page.locator('header h1')).toHaveText('Orchestrator');

    // Navigate to Containers
    await clickNav(page, 'Containers');
    await expect(page.locator('header h1')).toHaveText('Containers');

    // Navigate back to Dashboard
    await clickNav(page, 'Dashboard');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('routes render correct content for each section', async ({ page }) => {
    await page.goto('/');

    // ── Dashboard ────────────────────────────────────────────────────
    await clickNav(page, 'Dashboard');
    // Dashboard shows service cards or a system overview heading area
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    // The "live" indicator is always present
    await expect(page.locator('text=live')).toBeVisible();

    // ── Agents ───────────────────────────────────────────────────────
    await clickNav(page, 'Agents');
    await expect(page.locator('header h1')).toHaveText('Agents');
    // Header description for Agents section
    await expect(page.locator('header')).toContainText('Registered agents');

    // ── Traffic ──────────────────────────────────────────────────────
    await clickNav(page, 'Traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');
    await expect(page.locator('header')).toContainText('Actions log');

    // ── Orchestrator (Chat) ───────────────────────────────────────────
    await clickNav(page, 'Orchestrator');
    await expect(page.locator('header h1')).toHaveText('Orchestrator');
    await expect(page.locator('header')).toContainText('Dispatch tasks');

    // ── Containers ───────────────────────────────────────────────────
    await clickNav(page, 'Containers');
    await expect(page.locator('header h1')).toHaveText('Containers');
    await expect(page.locator('header')).toContainText('Docker kubexes');
  });

  test('direct URL navigation works', async ({ page }) => {
    // Navigate directly to /agents via URL
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents');
    await expect(page.locator('aside')).toBeVisible();

    // Navigate directly to /chat via URL
    await page.goto('/chat');
    await expect(page.locator('header h1')).toHaveText('Orchestrator');

    // Navigate directly to /containers via URL
    await page.goto('/containers');
    await expect(page.locator('header h1')).toHaveText('Containers');

    // Navigate directly to /traffic via URL
    await page.goto('/traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');
  });
});
