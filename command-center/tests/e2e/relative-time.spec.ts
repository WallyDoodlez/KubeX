/**
 * Iteration 28: Unified relative timestamps
 *
 * Tests that RelativeTime is correctly rendered across:
 *  - TrafficLog rows
 *  - ActivityFeed rows
 *  - OrchestratorChat bubbles
 *  - ApprovalQueue cards (empty queue path)
 *
 * Relative label correctness is tested by seeding entries with known offsets.
 *
 * Pattern: navigate first (to get an origin), seed localStorage, then reload/navigate
 * to the target page — matching the approach used across this test suite.
 */

import { test, expect } from '@playwright/test';

// ── Helpers ────────────────────────────────────────────────────────────────────

function trafficEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: `e-${Math.random()}`,
    timestamp: new Date().toISOString(),
    agent_id: 'agent-alpha-001',
    action: 'summarise_document',
    capability: 'summarise',
    status: 'allowed',
    ...overrides,
  };
}

// ── TrafficLog ─────────────────────────────────────────────────────────────────

test.describe('RelativeTime — TrafficLog rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('timestamp cell is a <time> element with dateTime attribute', async ({ page }) => {
    const entry = trafficEntry({ timestamp: new Date().toISOString() });
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify([data]));
    }, entry);
    await page.goto('/traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');

    const timeEl = page.locator('[data-testid="traffic-row-timestamp"]').first();
    await expect(timeEl).toBeVisible();
    // The dateTime attribute must be a valid ISO string
    const dt = await timeEl.getAttribute('dateTime');
    expect(dt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('very recent entry shows "just now"', async ({ page }) => {
    const entry = trafficEntry({ timestamp: new Date().toISOString() });
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify([data]));
    }, entry);
    await page.goto('/traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');

    const timeEl = page.locator('[data-testid="traffic-row-timestamp"]').first();
    await expect(timeEl).toContainText('just now');
  });

  test('entry from ~2 minutes ago shows "Xm ago"', async ({ page }) => {
    const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const entry = trafficEntry({ timestamp: twoMinsAgo });
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify([data]));
    }, entry);
    await page.goto('/traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');

    const timeEl = page.locator('[data-testid="traffic-row-timestamp"]').first();
    await expect(timeEl).toContainText('m ago');
  });

  test('title tooltip shows full ISO date', async ({ page }) => {
    const iso = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const entry = trafficEntry({ timestamp: iso });
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify([data]));
    }, entry);
    await page.goto('/traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');

    const timeEl = page.locator('[data-testid="traffic-row-timestamp"]').first();
    const title = await timeEl.getAttribute('title');
    // title must contain the ISO prefix
    expect(title).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── ActivityFeed ───────────────────────────────────────────────────────────────

test.describe('RelativeTime — ActivityFeed rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('activity row timestamp is a <time> element', async ({ page }) => {
    const entry = trafficEntry();
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify([data]));
    }, entry);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');

    const timeEl = page.locator('[data-testid="activity-row-timestamp"]').first();
    await expect(timeEl).toBeVisible();
  });

  test('recent activity row shows relative label (just now or Xs ago)', async ({ page }) => {
    const entry = trafficEntry({ timestamp: new Date().toISOString() });
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify([data]));
    }, entry);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');

    const timeEl = page.locator('[data-testid="activity-row-timestamp"]').first();
    const text = await timeEl.innerText();
    expect(text).toMatch(/just now|ago/);
  });

  test('activity row tooltip matches entry ISO timestamp', async ({ page }) => {
    const iso = new Date(Date.now() - 90 * 1000).toISOString();
    const entry = trafficEntry({ timestamp: iso });
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify([data]));
    }, entry);
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');

    const timeEl = page.locator('[data-testid="activity-row-timestamp"]').first();
    const title = await timeEl.getAttribute('title');
    expect(title).not.toBeNull();
    expect(title).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── OrchestratorChat ───────────────────────────────────────────────────────────

test.describe('RelativeTime — OrchestratorChat bubbles', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate first to establish origin, then seed localStorage
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');

    const messages = [
      {
        id: 'msg-1',
        role: 'user',
        content: '[summarise] Hello world',
        timestamp: new Date().toISOString(),
      },
    ];
    await page.evaluate((data) => {
      localStorage.setItem('kubex-chat-messages', JSON.stringify(data));
    }, messages);
    await page.goto('/chat');
    // The chat page heading is "Orchestrator" (nav label)
    await expect(page.locator('header h1')).toHaveText('Orchestrator');
  });

  test('chat bubble has <time> element with dateTime attribute', async ({ page }) => {
    const timeEl = page.locator('[data-testid="chat-bubble-timestamp"]').first();
    await expect(timeEl).toBeVisible();
    const dt = await timeEl.getAttribute('dateTime');
    expect(dt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('chat bubble timestamp shows relative label', async ({ page }) => {
    const timeEl = page.locator('[data-testid="chat-bubble-timestamp"]').first();
    const text = await timeEl.innerText();
    expect(text).toMatch(/just now|ago/);
  });

  test('chat bubble tooltip is the ISO date', async ({ page }) => {
    const timeEl = page.locator('[data-testid="chat-bubble-timestamp"]').first();
    const title = await timeEl.getAttribute('title');
    expect(title).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── Approvals (empty queue — verify structure still renders) ───────────────────

test.describe('RelativeTime — ApprovalQueue page', () => {
  test('approvals page loads without error after removing tick interval', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/approvals');
    await expect(page.locator('header h1')).toHaveText('Approvals');
    await page.waitForTimeout(100);
    expect(errors).toHaveLength(0);
  });

  test('approvals page shows empty state when queue is empty', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.locator('header h1')).toHaveText('Approvals');
    // EmptyState should appear (no pending items in mock data)
    await expect(page.locator('text=No pending approvals')).toBeVisible();
  });
});

// ── Cross-surface: dateTime attribute semantics ─────────────────────────────────

test.describe('RelativeTime — semantic HTML', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('all <time> elements on Traffic page have valid dateTime', async ({ page }) => {
    const entries = Array.from({ length: 3 }, (_, i) =>
      trafficEntry({ id: `e${i}`, timestamp: new Date(Date.now() - i * 60_000).toISOString() }),
    );
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify(data));
    }, entries);
    await page.goto('/traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');
    // Wait for at least one row to render
    await expect(page.locator('[data-testid="traffic-row-timestamp"]').first()).toBeVisible();

    const timeEls = page.locator('[data-testid="traffic-row-timestamp"]');
    const count = await timeEls.count();
    expect(count).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < count; i++) {
      const dt = await timeEls.nth(i).getAttribute('dateTime');
      expect(dt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  test('entry from yesterday shows "1d ago"', async ({ page }) => {
    const oneDayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const entry = trafficEntry({ timestamp: oneDayAgo });
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify([data]));
    }, entry);
    await page.goto('/traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');

    const timeEl = page.locator('[data-testid="traffic-row-timestamp"]').first();
    await expect(timeEl).toContainText('d ago');
  });

  test('entry from 3 hours ago shows "Xh ago"', async ({ page }) => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const entry = trafficEntry({ timestamp: threeHoursAgo });
    await page.evaluate((data) => {
      localStorage.setItem('kubex-traffic-log', JSON.stringify([data]));
    }, entry);
    await page.goto('/traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');

    const timeEl = page.locator('[data-testid="traffic-row-timestamp"]').first();
    await expect(timeEl).toContainText('h ago');
  });
});
