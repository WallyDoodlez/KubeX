import { test, expect } from '@playwright/test';

test.describe('Dashboard activity feed', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('activity feed section is rendered on Dashboard', async ({ page }) => {
    await expect(page.locator('[data-testid="activity-feed"]')).toBeVisible();
  });

  test('activity feed has "Recent Activity" heading', async ({ page }) => {
    await expect(
      page.locator('[data-testid="activity-feed"] h2', { hasText: 'Recent Activity' }),
    ).toBeVisible();
  });

  test('empty state shown when no traffic events exist', async ({ page }) => {
    // Fresh page with no pre-seeded localStorage traffic entries
    await page.evaluate(() => localStorage.removeItem('kubex-traffic-log'));
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    await expect(page.locator('[data-testid="activity-feed-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="activity-feed-empty"]')).toContainText(
      'No traffic events yet',
    );
  });

  test('rows render when traffic entries are present in localStorage', async ({ page }) => {
    // Seed two traffic entries directly into localStorage
    const entries = [
      {
        id: 'e1',
        timestamp: new Date().toISOString(),
        agent_id: 'agent-alpha-001',
        action: 'summarise_document',
        capability: 'summarise',
        status: 'allowed',
      },
      {
        id: 'e2',
        timestamp: new Date(Date.now() - 5000).toISOString(),
        agent_id: 'agent-beta-007',
        action: 'classify_content',
        capability: 'classify',
        status: 'denied',
      },
    ];
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    const rows = page.locator('[data-testid="activity-feed-row"]');
    await expect(rows).toHaveCount(2);
  });

  test('each row shows agent_id, action, and status badge', async ({ page }) => {
    const entries = [
      {
        id: 'e1',
        timestamp: new Date().toISOString(),
        agent_id: 'agent-alpha-001',
        action: 'summarise_document',
        capability: 'summarise',
        status: 'allowed',
      },
    ];
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    const row = page.locator('[data-testid="activity-feed-row"]').first();
    await expect(row).toContainText('agent-alpha-001');
    await expect(row).toContainText('summarise_document');
    await expect(row).toContainText('allowed');
  });

  test('row count is capped at 10 even when more entries exist', async ({ page }) => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      id: `e${i}`,
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      agent_id: `agent-${i}`,
      action: `action_${i}`,
      status: 'allowed',
    }));
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    const rows = page.locator('[data-testid="activity-feed-row"]');
    await expect(rows).toHaveCount(10);
  });

  test('subtitle shows correct total count', async ({ page }) => {
    const entries = Array.from({ length: 3 }, (_, i) => ({
      id: `e${i}`,
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      agent_id: `agent-${i}`,
      action: `action_${i}`,
      status: 'pending',
    }));
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    const subtitle = page.locator('[data-testid="activity-feed"] p').first();
    await expect(subtitle).toContainText('3');
  });

  test('denied entry row has red left border accent class', async ({ page }) => {
    const entries = [
      {
        id: 'e1',
        timestamp: new Date().toISOString(),
        agent_id: 'agent-alpha-001',
        action: 'blocked_action',
        status: 'denied',
      },
    ];
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    const row = page.locator('[data-testid="activity-feed-row"]').first();
    await expect(row).toHaveClass(/border-l-red/);
  });

  test('escalated entry row has amber left border accent class', async ({ page }) => {
    const entries = [
      {
        id: 'e1',
        timestamp: new Date().toISOString(),
        agent_id: 'agent-alpha-001',
        action: 'risky_action',
        status: 'escalated',
      },
    ];
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    const row = page.locator('[data-testid="activity-feed-row"]').first();
    await expect(row).toHaveClass(/border-l-amber/);
  });

  test('"View all →" button is present', async ({ page }) => {
    await expect(page.locator('[data-testid="activity-feed-view-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="activity-feed-view-all"]')).toHaveText('View all →');
  });

  test('"View all →" navigates to Traffic page', async ({ page }) => {
    await page.locator('[data-testid="activity-feed-view-all"]').click();
    await expect(page.locator('header h1')).toHaveText('Traffic');
  });

  test('activity feed list has accessible aria-label', async ({ page }) => {
    const entries = [
      {
        id: 'e1',
        timestamp: new Date().toISOString(),
        agent_id: 'agent-alpha-001',
        action: 'some_action',
        status: 'allowed',
      },
    ];
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    await expect(
      page.locator('[data-testid="activity-feed"] ul[aria-label="Recent traffic events"]'),
    ).toBeVisible();
  });
});
