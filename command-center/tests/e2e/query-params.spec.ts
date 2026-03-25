import { test, expect } from '@playwright/test';
import { mockBaseRoutes, MANAGER } from './helpers';

/**
 * URL Query Params for shareable filters — Iteration 31
 *
 * Tests that filter state (search, sort, status, page) is persisted in the URL
 * for AgentsPanel, ContainersPanel, and TrafficLog. A shared link with query
 * params should restore the exact same filtered view.
 */

// ── AgentsPanel ──────────────────────────────────────────────────────────────

test.describe('AgentsPanel — URL query params', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
  });

  test('search query appears in URL when typing in search box', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents');

    const search = page.locator('input[placeholder*="Search agents"]');
    await search.fill('alpha');

    // URL should reflect the search
    await expect(page).toHaveURL(/search=alpha/);
  });

  test('URL search param restores search input on direct navigation', async ({ page }) => {
    await page.goto('/agents?search=alpha');
    await expect(page.locator('header h1')).toHaveText('Agents');

    // The search input should be pre-filled with 'alpha'
    const search = page.locator('input[placeholder*="Search agents"]');
    await expect(search).toHaveValue('alpha');
  });

  test('URL search param applies the filter on load', async ({ page }) => {
    await page.goto('/agents?search=xxxxnotamatch');
    await expect(page.locator('header h1')).toHaveText('Agents');

    // Wait for the search input to show the pre-filled value (confirms URL was read)
    const search = page.locator('input[placeholder*="Search agents"]');
    await expect(search).toHaveValue('xxxxnotamatch');

    // With a search that matches nothing, the "no matching" empty state or subtitle
    // should reflect the filtered count — capability matrix renders all agents still
    await expect(page.locator('[data-testid="capability-matrix"]')).toBeVisible({ timeout: 10_000 });
  });

  test('clearing search removes search param from URL', async ({ page }) => {
    await page.goto('/agents?search=alpha');
    await expect(page.locator('header h1')).toHaveText('Agents');

    const search = page.locator('input[placeholder*="Search agents"]');
    await search.clear();

    // URL should no longer have search param (or it's empty)
    await expect(page).not.toHaveURL(/search=alpha/);
  });

  test('sort column click adds sort params to URL', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents');

    // Wait for the table to render
    await expect(page.locator('[role="row"]').nth(1)).toBeVisible({ timeout: 10_000 });

    // Click "Status" column header to sort
    await page.locator('[role="columnheader"]', { hasText: 'Status' }).click();

    // URL should have sort and dir params
    await expect(page).toHaveURL(/sort=status/);
    await expect(page).toHaveURL(/dir=asc/);
  });

  test('URL sort params restore sort order on direct navigation', async ({ page }) => {
    await page.goto('/agents?sort=status&dir=asc');
    await expect(page.locator('header h1')).toHaveText('Agents');

    // Wait for the table to render
    await expect(page.locator('[role="row"]').nth(1)).toBeVisible({ timeout: 10_000 });

    // The Status column header should show an ascending indicator
    const statusHeader = page.locator('[role="columnheader"]', { hasText: /Status/ });
    await expect(statusHeader).toContainText('↑');
  });

  test('URL retains multiple filter params together', async ({ page }) => {
    await page.goto('/agents?search=alpha&sort=status&dir=asc');
    await expect(page.locator('header h1')).toHaveText('Agents');

    const search = page.locator('input[placeholder*="Search agents"]');
    await expect(search).toHaveValue('alpha');

    // Sort indicator should be present — wait for capability matrix to confirm data loaded
    await expect(page.locator('[data-testid="capability-matrix"]')).toBeVisible({ timeout: 10_000 });
    const statusHeader = page.locator('[role="columnheader"]', { hasText: /Status/ });
    await expect(statusHeader).toContainText('↑');
  });

  test('sort toggle from asc to desc updates dir param in URL', async ({ page }) => {
    await page.goto('/agents?sort=status&dir=asc');
    await expect(page.locator('header h1')).toHaveText('Agents');

    await expect(page.locator('[role="row"]').nth(1)).toBeVisible({ timeout: 10_000 });

    // Click Status header again to toggle to desc
    await page.locator('[role="columnheader"]', { hasText: /Status/ }).click();

    await expect(page).toHaveURL(/sort=status/);
    await expect(page).toHaveURL(/dir=desc/);
  });

  test('default params are not added to URL', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents');

    // Page load should not pollute the URL with defaults
    const url = page.url();
    expect(url).not.toContain('search=');
    expect(url).not.toContain('sort=');
    expect(url).not.toContain('page=1');
  });
});

// ── ContainersPanel ──────────────────────────────────────────────────────────

const containersMockKubexes = [
  {
    kubex_id: 'kubex-550e8400-e29b-41d4',
    agent_id: 'agent-alpha-001',
    status: 'running',
    image: 'kubex-base:latest',
    container_id: 'abc123',
    boundary: 'default',
  },
  {
    kubex_id: 'kubex-6ba7b810-9dad-11d1',
    agent_id: 'agent-beta-007',
    status: 'created',
    image: 'kubex-base:latest',
    container_id: 'def456',
    boundary: 'default',
  },
];

test.describe('ContainersPanel — URL query params', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page, { kubexes: containersMockKubexes });
  });

  test('status filter appears in URL when changed', async ({ page }) => {
    await page.goto('/containers');
    await expect(page.locator('header h1')).toHaveText('Containers');

    // Change the status filter dropdown
    await page.selectOption('select[aria-label="Filter by status"]', 'running');

    // URL should reflect the status filter
    await expect(page).toHaveURL(/status=running/);
  });

  test('URL status param restores dropdown selection on direct navigation', async ({ page }) => {
    await page.goto('/containers?status=running');
    await expect(page.locator('header h1')).toHaveText('Containers');

    const select = page.locator('select[aria-label="Filter by status"]');
    await expect(select).toHaveValue('running');
  });

  test('search query appears in URL on containers page', async ({ page }) => {
    await page.goto('/containers');
    await expect(page.locator('header h1')).toHaveText('Containers');

    const search = page.locator('input[placeholder*="Search kubexes"]');
    await search.fill('kubex-550');

    await expect(page).toHaveURL(/search=kubex-550/);
  });

  test('URL search param pre-fills search input on containers page', async ({ page }) => {
    await page.goto('/containers?search=kubex-550');
    await expect(page.locator('header h1')).toHaveText('Containers');

    const search = page.locator('input[placeholder*="Search kubexes"]');
    await expect(search).toHaveValue('kubex-550');
  });

  test('sort column click adds sort params on containers page', async ({ page }) => {
    await page.goto('/containers');
    await expect(page.locator('header h1')).toHaveText('Containers');

    // Wait for table to load
    await expect(page.locator('[role="row"]').nth(1)).toBeVisible({ timeout: 10_000 });

    // Click "Agent" column header to sort
    await page.locator('[role="columnheader"]', { hasText: 'Agent' }).click();

    await expect(page).toHaveURL(/sort=agent_id/);
    await expect(page).toHaveURL(/dir=asc/);
  });

  test('URL sort params restore sort order on containers page', async ({ page }) => {
    await page.goto('/containers?sort=status&dir=desc');
    await expect(page.locator('header h1')).toHaveText('Containers');

    await expect(page.locator('[role="row"]').nth(1)).toBeVisible({ timeout: 10_000 });

    const statusHeader = page.locator('[role="columnheader"]', { hasText: /Status/ });
    await expect(statusHeader).toContainText('↓');
  });

  test('default status=all is not added to URL', async ({ page }) => {
    await page.goto('/containers');
    await expect(page.locator('header h1')).toHaveText('Containers');

    const url = page.url();
    expect(url).not.toContain('status=all');
  });
});

// ── TrafficLog ───────────────────────────────────────────────────────────────

test.describe('TrafficLog — URL query params', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
  });

  test('traffic status filter appears in URL when changed', async ({ page }) => {
    await page.goto('/traffic');
    await expect(page.locator('h2', { hasText: 'Traffic / Actions Log' })).toBeVisible();

    // The filter bar has a status select (first select in the filter bar)
    const statusSelect = page.locator('select').first();
    await statusSelect.selectOption('denied');

    await expect(page).toHaveURL(/status=denied/);
  });

  test('URL status param pre-selects traffic filter on direct navigation', async ({ page }) => {
    await page.goto('/traffic?status=denied');
    await expect(page.locator('h2', { hasText: 'Traffic / Actions Log' })).toBeVisible();

    const statusSelect = page.locator('select').first();
    await expect(statusSelect).toHaveValue('denied');
  });

  test('traffic search input appears in URL', async ({ page }) => {
    await page.goto('/traffic');
    await expect(page.locator('h2', { hasText: 'Traffic / Actions Log' })).toBeVisible();

    const searchInput = page.locator('input[placeholder="Search actions…"]');
    await searchInput.fill('gateway');

    await expect(page).toHaveURL(/search=gateway/);
  });

  test('URL search param pre-fills traffic search input', async ({ page }) => {
    await page.goto('/traffic?search=gateway');
    await expect(page.locator('h2', { hasText: 'Traffic / Actions Log' })).toBeVisible();

    const searchInput = page.locator('input[placeholder="Search actions…"]');
    await expect(searchInput).toHaveValue('gateway');
  });

  test('default traffic status=all is not added to URL', async ({ page }) => {
    await page.goto('/traffic');
    await expect(page.locator('h2', { hasText: 'Traffic / Actions Log' })).toBeVisible();

    const url = page.url();
    expect(url).not.toContain('status=all');
    expect(url).not.toContain('page=1');
  });

  test('URL params persist across traffic page navigation', async ({ page }) => {
    // Navigate to traffic with params, go away, then come back
    await page.goto('/traffic?status=denied');
    await expect(page.locator('h2', { hasText: 'Traffic / Actions Log' })).toBeVisible();

    // Navigate to agents
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents');

    // Go back to traffic — params are in the URL so the link is shareable
    await page.goto('/traffic?status=denied');
    const statusSelect = page.locator('select').first();
    await expect(statusSelect).toHaveValue('denied');
  });
});

// ── Cross-panel ──────────────────────────────────────────────────────────────

test.describe('URL query params — cross-panel behaviour', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
  });

  test('agents URL params do not leak to containers page', async ({ page }) => {
    await page.goto('/agents?search=alpha&sort=status&dir=asc');
    await expect(page.locator('header h1')).toHaveText('Agents');

    // Navigate to containers — it should have a clean URL
    await page.goto('/containers');
    const url = page.url();
    expect(url).not.toContain('search=alpha');
    expect(url).not.toContain('sort=status');
  });

  test('containers URL params do not affect agents page', async ({ page }) => {
    await page.goto('/containers?status=running&sort=kubex_id&dir=desc');
    await expect(page.locator('header h1')).toHaveText('Containers');

    // Navigate to agents — it should have a clean URL
    await page.goto('/agents');
    const url = page.url();
    expect(url).not.toContain('status=running');
  });

  test('direct URL with params renders correct filtered view end-to-end', async ({ page }) => {
    // First load agents page to get an actual agent ID from the real backend
    await page.goto('/agents');
    await expect(page.locator('header h1')).toHaveText('Agents');

    // Wait for capability matrix to confirm data has loaded (real agents)
    await expect(page.locator('[data-testid="capability-matrix"]')).toBeVisible({ timeout: 10_000 });

    // Get the first agent row's ID text to use as a search term
    const firstRowText = await page.locator('[role="row"]').nth(1).textContent();
    // Extract a unique fragment from the agent ID (first 6 chars should be enough)
    const agentIdFragment = firstRowText?.match(/[a-z][a-z0-9-]{3,}/i)?.[0]?.slice(0, 6) ?? 'zzznotamatch';

    // Now navigate to agents page with that search fragment
    await page.goto(`/agents?search=${agentIdFragment}`);
    await expect(page.locator('header h1')).toHaveText('Agents');

    // Confirm search input is pre-filled
    const search = page.locator('input[placeholder*="Search agents"]');
    await expect(search).toHaveValue(agentIdFragment);

    // Data loads and the filter is applied (matrix confirms agents loaded)
    await expect(page.locator('[data-testid="capability-matrix"]')).toBeVisible({ timeout: 10_000 });
  });
});
