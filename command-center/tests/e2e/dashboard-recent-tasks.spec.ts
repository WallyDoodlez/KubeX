import { test, expect } from '@playwright/test';
import { mockBaseRoutes } from './helpers';

test.describe('Dashboard — Recent Tasks widget', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    // Navigate first so localStorage is accessible
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('shows empty state when no traffic entries exist', async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem('kubex-traffic-log'));
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');

    const card = page.getByTestId('recent-tasks-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('recent-tasks-empty')).toBeVisible();
    await expect(page.getByTestId('recent-tasks-empty')).toContainText('No tasks dispatched yet.');
  });

  test('renders task rows when traffic entries exist', async ({ page }) => {
    const entries = [
      {
        id: 'task-001',
        timestamp: new Date().toISOString(),
        agent_id: 'agent-alpha',
        action: 'summarise',
        capability: 'summarise',
        status: 'allowed',
      },
      {
        id: 'task-002',
        timestamp: new Date(Date.now() - 5000).toISOString(),
        agent_id: 'agent-beta',
        action: 'classify',
        capability: 'classify',
        status: 'denied',
      },
      {
        id: 'task-003',
        timestamp: new Date(Date.now() - 10000).toISOString(),
        agent_id: 'agent-gamma',
        action: 'escalate',
        capability: 'escalate',
        status: 'escalated',
      },
    ];
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');

    const rows = page.getByTestId('recent-task-row');
    await expect(rows).toHaveCount(3);
  });

  test('shows at most 5 rows even when more entries exist', async ({ page }) => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      id: `task-${String(i).padStart(3, '0')}`,
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      agent_id: `agent-${i}`,
      action: 'do-something',
      capability: 'cap',
      status: 'allowed',
    }));
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');

    const rows = page.getByTestId('recent-task-row');
    await expect(rows).toHaveCount(5);
  });

  test('each row shows a status badge', async ({ page }) => {
    const entries = [
      {
        id: 'task-x1',
        timestamp: new Date().toISOString(),
        agent_id: 'agent-a',
        action: 'run',
        capability: 'run',
        status: 'allowed',
      },
    ];
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');

    const row = page.getByTestId('recent-task-row').first();
    await expect(row).toContainText('allowed');
  });

  test('"View all →" link is present and navigates to /tasks', async ({ page }) => {
    const viewAll = page.getByTestId('recent-tasks-view-all');
    await expect(viewAll).toBeVisible();
    await viewAll.click();
    await expect(page).toHaveURL(/\/tasks/);
  });

  test('card heading is visible', async ({ page }) => {
    await expect(page.getByTestId('recent-tasks-card').locator('h2')).toContainText('Recent Tasks');
  });
});
