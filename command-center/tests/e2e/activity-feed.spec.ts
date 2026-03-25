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
    // Heading now lives in the CollapsibleSection wrapper, not inside the activity-feed element
    await expect(
      page.locator('[data-testid="collapsible-section-activity-feed"] h2', { hasText: 'Recent Activity' }),
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
    // Subtitle ("3 events") is now in the CollapsibleSection header, shown when section is expanded
    const subtitle = page.locator('[data-testid="collapsible-section-activity-feed"] [data-testid="collapsible-toggle-activity-feed"] p');
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
    // "View all →" is now the CollapsibleSection action button for the activity-feed section
    const viewAll = page.locator('[data-testid="collapsible-section-activity-feed"] button', { hasText: 'View all →' });
    await expect(viewAll).toBeVisible();
    await expect(viewAll).toHaveText('View all →');
  });

  test('"View all →" navigates to Traffic page', async ({ page }) => {
    const viewAll = page.locator('[data-testid="collapsible-section-activity-feed"] button', { hasText: 'View all →' });
    await viewAll.click();
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

// ── Iteration 78: Activity Feed Improvements ─────────────────────────────────

test.describe('Activity Feed — status filter tabs', () => {
  const mixedEntries = [
    { id: 'e1', timestamp: new Date().toISOString(), agent_id: 'agent-alpha', action: 'act1', status: 'allowed' },
    { id: 'e2', timestamp: new Date().toISOString(), agent_id: 'agent-beta',  action: 'act2', status: 'denied'    },
    { id: 'e3', timestamp: new Date().toISOString(), agent_id: 'agent-gamma', action: 'act3', status: 'escalated' },
    { id: 'e4', timestamp: new Date().toISOString(), agent_id: 'agent-delta', action: 'act4', status: 'allowed'   },
    { id: 'e5', timestamp: new Date().toISOString(), agent_id: 'agent-eps',   action: 'act5', status: 'pending'   },
  ];

  test.beforeEach(async ({ page }) => {
    // Use addInitScript so localStorage is set before the page JS runs
    await page.addInitScript((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, mixedEntries);
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('filter tabs are rendered', async ({ page }) => {
    await expect(page.getByTestId('activity-filter-tabs')).toBeVisible();
    await expect(page.getByTestId('activity-filter-all')).toBeVisible();
    await expect(page.getByTestId('activity-filter-allowed')).toBeVisible();
    await expect(page.getByTestId('activity-filter-denied')).toBeVisible();
    await expect(page.getByTestId('activity-filter-escalated')).toBeVisible();
    await expect(page.getByTestId('activity-filter-pending')).toBeVisible();
  });

  test('"All" tab is active by default', async ({ page }) => {
    const allTab = page.getByTestId('activity-filter-all');
    await expect(allTab).toHaveAttribute('aria-selected', 'true');
  });

  test('all 5 rows show with "All" filter', async ({ page }) => {
    const rows = page.locator('[data-testid="activity-feed-row"]');
    await expect(rows).toHaveCount(5);
  });

  test('"Allowed" filter shows only allowed rows', async ({ page }) => {
    await page.getByTestId('activity-filter-allowed').click();
    const rows = page.locator('[data-testid="activity-feed-row"]');
    await expect(rows).toHaveCount(2); // e1 and e4
    for (let i = 0; i < 2; i++) {
      await expect(rows.nth(i)).toContainText('allowed');
    }
  });

  test('"Denied" filter shows only denied rows', async ({ page }) => {
    await page.getByTestId('activity-filter-denied').click();
    const rows = page.locator('[data-testid="activity-feed-row"]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('agent-beta');
  });

  test('"Escalated" filter shows only escalated rows', async ({ page }) => {
    await page.getByTestId('activity-filter-escalated').click();
    const rows = page.locator('[data-testid="activity-feed-row"]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('agent-gamma');
  });

  test('"Pending" filter shows only pending rows', async ({ page }) => {
    await page.getByTestId('activity-filter-pending').click();
    const rows = page.locator('[data-testid="activity-feed-row"]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('agent-eps');
  });

  test('switching from filtered tab back to "All" restores all rows', async ({ page }) => {
    await page.getByTestId('activity-filter-denied').click();
    await expect(page.locator('[data-testid="activity-feed-row"]')).toHaveCount(1);

    await page.getByTestId('activity-filter-all').click();
    await expect(page.locator('[data-testid="activity-feed-row"]')).toHaveCount(5);
  });

  // Filtered empty state test lives as standalone below — see "filtered empty state shown
  // when filter has no matching entries". Cannot be inside this describe because addInitScript
  // from beforeEach would re-apply on reload, preventing an override seed.

  test('active filter tab has aria-selected=true, others false', async ({ page }) => {
    await page.getByTestId('activity-filter-denied').click();
    await expect(page.getByTestId('activity-filter-denied')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('activity-filter-allowed')).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByTestId('activity-filter-all')).toHaveAttribute('aria-selected', 'false');
  });
});

// Standalone: empty state on filtered view (no beforeEach initScript interference)
test('filtered empty state shown when filter has no matching entries', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kubex-traffic-log', JSON.stringify([
      { id: 'x1', timestamp: new Date().toISOString(), agent_id: 'agent-x', action: 'act_x', status: 'allowed' },
    ]));
  });
  await page.goto('/');
  await expect(page.locator('header h1')).toHaveText('Dashboard');
  await page.getByTestId('activity-filter-denied').click();
  await expect(page.getByTestId('activity-feed-empty')).toBeVisible();
  await expect(page.getByTestId('activity-feed-empty')).toContainText('denied');
});

test.describe('Activity Feed — show more / show less', () => {
  test.beforeEach(async ({ page }) => {
    // Seed 15 entries (more than default limit of 10)
    const entries = Array.from({ length: 15 }, (_, i) => ({
      id: `e${i}`,
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      agent_id: `agent-${i}`,
      action: `action_${i}`,
      status: 'allowed',
    }));
    await page.addInitScript((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('"show more" button appears when entries exceed default limit', async ({ page }) => {
    await expect(page.getByTestId('activity-feed-show-more')).toBeVisible();
  });

  test('clicking "show more" expands to show all entries', async ({ page }) => {
    await expect(page.locator('[data-testid="activity-feed-row"]')).toHaveCount(10);
    await page.getByTestId('activity-feed-show-more').click();
    await expect(page.locator('[data-testid="activity-feed-row"]')).toHaveCount(15);
  });

  test('"show less" button appears after expanding', async ({ page }) => {
    await page.getByTestId('activity-feed-show-more').click();
    await expect(page.getByTestId('activity-feed-show-less')).toBeVisible();
  });

  test('clicking "show less" collapses back to default limit', async ({ page }) => {
    await page.getByTestId('activity-feed-show-more').click();
    await expect(page.locator('[data-testid="activity-feed-row"]')).toHaveCount(15);
    await page.getByTestId('activity-feed-show-less').click();
    await expect(page.locator('[data-testid="activity-feed-row"]')).toHaveCount(10);
  });

  test('"show more" does not appear when entries are within default limit', async ({ page }) => {
    // Override localStorage on the already-loaded page and reload so the app reads fewer entries
    await page.evaluate(() => {
      const data = Array.from({ length: 5 }, (_, i) => ({
        id: `sm${i}`,
        timestamp: new Date().toISOString(),
        agent_id: `agent-${i}`,
        action: `action_${i}`,
        status: 'allowed',
      }));
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    });
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    await expect(page.getByTestId('activity-feed-show-more')).not.toBeVisible();
  });

  test('switching filter tab resets expanded state', async ({ page }) => {
    await page.getByTestId('activity-feed-show-more').click();
    await expect(page.locator('[data-testid="activity-feed-row"]')).toHaveCount(15);

    // Switch to denied filter (no denied entries), then back to all
    await page.getByTestId('activity-filter-allowed').click();
    // All 15 are allowed, but now expanded is reset — should show 10 again
    await expect(page.locator('[data-testid="activity-feed-row"]')).toHaveCount(10);
  });
});

test.describe('Activity Feed — agent click-through', () => {
  test.beforeEach(async ({ page }) => {
    const entries = [
      {
        id: 'nav1',
        timestamp: new Date().toISOString(),
        agent_id: 'agent-nav-test',
        action: 'test_action',
        status: 'allowed',
      },
    ];
    await page.addInitScript((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('agent_id in row is rendered as a button', async ({ page }) => {
    await expect(page.getByTestId('activity-row-agent-link').first()).toBeVisible();
  });

  test('agent_id button has aria-label describing navigation', async ({ page }) => {
    const agentLink = page.getByTestId('activity-row-agent-link').first();
    const label = await agentLink.getAttribute('aria-label');
    expect(label).toContain('agent-nav-test');
  });

  test('clicking agent_id navigates to agent detail page', async ({ page }) => {
    await page.getByTestId('activity-row-agent-link').first().click();
    // Should navigate to /agents/agent-nav-test
    await expect(page).toHaveURL(/\/agents\/agent-nav-test/);
  });
});

test.describe('Activity Feed — task ID display', () => {
  test('task_id is shown in row when present', async ({ page }) => {
    const entries = [
      {
        id: 'tid1',
        timestamp: new Date().toISOString(),
        agent_id: 'agent-alpha-001',
        action: 'some_action',
        status: 'allowed',
        task_id: 'task-abc-123',
      },
    ];
    await page.addInitScript((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');

    const taskIdEl = page.getByTestId('activity-row-task-id').first();
    await expect(taskIdEl).toBeVisible();
    await expect(taskIdEl).toContainText('task-abc-123');
  });

  test('task_id element is absent when task_id is not present', async ({ page }) => {
    const entries = [
      {
        id: 'notid1',
        timestamp: new Date().toISOString(),
        agent_id: 'agent-alpha-001',
        action: 'some_action',
        status: 'allowed',
      },
    ];
    await page.addInitScript((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    await expect(page.getByTestId('activity-row-task-id')).not.toBeVisible();
  });
});
