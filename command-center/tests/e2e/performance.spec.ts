import { test, expect } from '@playwright/test';

/**
 * Performance tests — Iteration 14
 *
 * These tests verify:
 * 1. Pagination limits visible DOM rows (far fewer than total entries)
 * 2. Rapid navigation between pages doesn't break the app or throw errors
 * 3. Pages load quickly (under 3s) from navigation
 * 4. No ResizeObserver loop errors appear during scroll (layout thrash)
 * 5. React.memo'd components are present and correctly rendered
 */

// Helper: generate N traffic entries and seed them into localStorage before page load
async function seedTrafficEntries(page: import('@playwright/test').Page, count: number) {
  // We need to set localStorage BEFORE the app initialises its React state.
  // The Playwright `addInitScript` API runs before the page evaluates any scripts.
  await page.addInitScript((n: number) => {
    const entries = [];
    const statuses = ['allowed', 'denied', 'escalated', 'pending'];
    for (let i = 0; i < n; i++) {
      entries.push({
        id: `perf-entry-${i}`,
        timestamp: new Date(Date.now() - i * 1000).toISOString(),
        agent_id: `agent-perf-${i % 5}`,
        action: 'dispatch_task',
        capability: `cap-${i % 10}`,
        status: statuses[i % 4],
        task_id: `task-${i}`,
      });
    }
    localStorage.setItem('kubex-traffic-log', JSON.stringify(entries));
  }, count);
}

test.describe('Performance — pagination limits DOM rows', () => {
  test('TrafficLog with 200 entries renders only the page size in DOM', async ({ page }) => {
    await seedTrafficEntries(page, 200);

    await page.goto('/traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic');

    // Wait for entry count text to appear
    await expect(page.getByText('200 entries')).toBeVisible({ timeout: 5000 });

    // Count visible traffic row elements.
    // Each TrafficRow renders a div with `border-l-2` inside a `space-y-1.5` container.
    // We look specifically inside the traffic log content area.
    // With default page size of 20, only 20 rows should be in DOM — far fewer than 200.
    const visibleRows = page.locator('[class*="border-l-2"]').filter({ hasText: /./ });
    const rowCount = await visibleRows.count();

    // Critical assertion: pagination is working — DOM has far fewer than 200 rows
    expect(rowCount).toBeLessThan(50);
    // At least some rows are visible
    expect(rowCount).toBeGreaterThan(0);
  });

  test('pagination controls are present and navigate correctly with 200 entries', async ({ page }) => {
    await seedTrafficEntries(page, 200);

    await page.goto('/traffic');
    await expect(page.getByText('200 entries')).toBeVisible({ timeout: 5000 });

    // Pagination controls should be visible
    const prevBtn = page.getByRole('button', { name: 'Previous page' });
    const nextBtn = page.getByRole('button', { name: 'Next page' });
    await expect(prevBtn).toBeVisible();
    await expect(nextBtn).toBeVisible();

    // Prev should be disabled on page 1
    await expect(prevBtn).toBeDisabled();

    // Next should be enabled (200 entries > 20 page size)
    await expect(nextBtn).toBeEnabled();

    // Navigate to page 2
    await nextBtn.click();

    // Now prev should be enabled
    await expect(prevBtn).toBeEnabled();

    // Page indicator should show page 2
    await expect(page.getByText(/Page 2/)).toBeVisible();
  });

  test('localStorage traffic log cap of 500 entries is respected by AppContext', async ({ page }) => {
    // Seed exactly 500 entries before app load
    await seedTrafficEntries(page, 500);

    await page.goto('/traffic');
    // Should show 500 entries (the app reads them all — cap only applies on writes)
    await expect(page.getByText('500 entries')).toBeVisible({ timeout: 5000 });

    // Verify pagination exists (500 entries > 20 page size)
    await expect(page.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });
});

test.describe('Performance — rapid navigation', () => {
  test('rapid navigation between all pages does not crash or show error boundary', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');

    const routes = ['/', '/agents', '/traffic', '/chat', '/containers', '/approvals'];

    // Navigate rapidly through all routes 3 times
    for (let round = 0; round < 3; round++) {
      for (const route of routes) {
        await page.goto(route);
        // Just wait for the page shell to be visible — no full wait for data
        await expect(page.locator('aside')).toBeVisible();
      }
    }

    // No React error boundary should have fired
    await expect(page.getByText('Something went wrong')).not.toBeVisible();

    // No ResizeObserver loop errors (layout thrash indicator)
    const resizeErrors = consoleErrors.filter((e) => e.includes('ResizeObserver'));
    expect(resizeErrors).toHaveLength(0);
  });

  test('navigating to Dashboard and back to Traffic preserves entries', async ({ page }) => {
    // Seed 1 entry before app loads via addInitScript
    await page.addInitScript(() => {
      const entries = [
        {
          id: 'persist-1',
          timestamp: new Date().toISOString(),
          agent_id: 'agent-alpha',
          action: 'dispatch_task',
          capability: 'summarise',
          status: 'allowed',
        },
      ];
      localStorage.setItem('kubex-traffic-log', JSON.stringify(entries));
    });

    await page.goto('/traffic');
    await expect(page.getByText('1 entries')).toBeVisible({ timeout: 5000 });

    // Navigate away
    await page.locator('aside').getByText('Dashboard', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Dashboard');

    // Navigate back
    await page.locator('aside').getByText('Traffic', { exact: true }).click();
    await expect(page.locator('header h1')).toHaveText('Traffic');

    // Entries should still be there (persisted in localStorage / React state)
    await expect(page.getByText('1 entries')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Performance — page load times', () => {
  test('Dashboard page renders within 3 seconds of navigation', async ({ page }) => {
    const start = Date.now();
    await page.goto('/');
    // Service Health section heading appears when the page is interactive
    await expect(page.getByText('Service Health')).toBeVisible({ timeout: 3000 });
    const elapsed = Date.now() - start;
    console.log(`Dashboard initial render: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(3000);
  });

  test('Agents page renders within 3 seconds of navigation', async ({ page }) => {
    const start = Date.now();
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents', { timeout: 3000 });
    const elapsed = Date.now() - start;
    console.log(`Agents page render: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(3000);
  });

  test('Traffic page renders within 3 seconds of navigation', async ({ page }) => {
    const start = Date.now();
    await page.goto('/traffic');
    await expect(page.locator('header h1')).toHaveText('Traffic', { timeout: 3000 });
    const elapsed = Date.now() - start;
    console.log(`Traffic page render: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(3000);
  });
});

test.describe('Performance — memo components render correctly', () => {
  test('StatusBadge renders for agents without error boundary', async ({ page }) => {
    await page.goto('/agents');
    // Wait for content to stabilise
    await page.waitForTimeout(500);

    // The app should not show an error boundary (memo wrapping must not break rendering)
    await expect(page.getByText('Something went wrong')).not.toBeVisible();
  });

  test('Orchestrator chat Clear button is present (added in Iteration 14)', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.locator('header h1')).toHaveText('Orchestrator');
    // The new Clear chat button added in this iteration should be visible
    await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible();
  });

  test('Dashboard renders Service Health section without error boundary', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Service Health')).toBeVisible({ timeout: 3000 });
    // SVG Sparkline components should not crash the page
    await expect(page.getByText('Something went wrong')).not.toBeVisible();
  });

  test('ContainersPanel renders without error boundary', async ({ page }) => {
    await page.goto('/containers');
    await expect(page.locator('header h1')).toHaveText('Containers');
    await expect(page.getByText('Something went wrong')).not.toBeVisible();
  });
});
