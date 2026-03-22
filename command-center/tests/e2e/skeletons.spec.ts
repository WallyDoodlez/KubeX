import { test, expect } from '@playwright/test';

/**
 * Skeleton + EmptyState Integration Tests
 *
 * These tests verify that:
 * 1. Shared SkeletonLoader components (aria-busy="true") appear during API loading delays
 * 2. Skeletons disappear and real content renders after responses arrive
 * 3. Shared EmptyState renders correctly when APIs return empty arrays
 */

const REGISTRY = 'http://localhost:8070';
const MANAGER = 'http://localhost:8090';

// Helper: delay a route response by `ms` milliseconds
async function delayRoute(
  page: import('@playwright/test').Page,
  url: string,
  body: unknown,
  ms = 400,
) {
  await page.route(url, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

// ── AgentsPanel ──────────────────────────────────────────────────────────────

test.describe('AgentsPanel — skeleton + empty state', () => {
  test('shows SkeletonTable (aria-busy) while agents load', async ({ page }) => {
    // Delay the agents response so we can observe the skeleton
    await delayRoute(page, `${REGISTRY}/agents`, [], 500);

    await page.goto('/agents');

    // During loading, skeleton with aria-busy="true" should be present
    const skeleton = page.locator('[aria-busy="true"]').first();
    await expect(skeleton).toBeVisible();
  });

  test('skeleton disappears after agents response arrives', async ({ page }) => {
    const mockAgents = [
      {
        agent_id: 'agent-skel-001',
        capabilities: ['test'],
        status: 'running',
        boundary: 'internal',
        registered_at: new Date().toISOString(),
        metadata: {},
      },
    ];

    await page.route(`${REGISTRY}/agents`, async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockAgents),
      });
    });

    await page.goto('/agents');

    // Wait for skeleton to go away and real content to appear.
    // Use .first() to avoid strict-mode violation: the CapabilityMatrix also
    // renders the agent_id, so the text appears in 2 elements on this page.
    await expect(page.locator('text=agent-skel-001').first()).toBeVisible({ timeout: 5000 });
    // The skeleton loading table label should not be visible after data loads
    await expect(page.locator('[aria-label="Loading table…"]')).not.toBeVisible();
  });

  test('shows EmptyState when agents array is empty', async ({ page }) => {
    await page.route(`${REGISTRY}/agents`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto('/agents');

    await expect(page.getByText('No agents registered')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Run docker compose up to start agents.')).toBeVisible();
  });
});

// ── ContainersPanel ──────────────────────────────────────────────────────────

test.describe('ContainersPanel — skeleton + empty state', () => {
  test('shows SkeletonTable (aria-busy) while kubexes load', async ({ page }) => {
    await delayRoute(page, `${MANAGER}/kubexes`, [], 500);

    await page.goto('/containers');

    const skeleton = page.locator('[aria-busy="true"]').first();
    await expect(skeleton).toBeVisible();
  });

  test('skeleton disappears after kubexes response arrives', async ({ page }) => {
    const mockKubexes = [
      {
        kubex_id: 'kubex-skel-test',
        agent_id: 'agent-alpha-001',
        status: 'running',
        image: 'kubex-base:latest',
        container_name: 'kubex_skel',
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        config: {},
      },
    ];

    await page.route(`${MANAGER}/kubexes`, async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockKubexes),
      });
    });

    await page.goto('/containers');

    await expect(page.locator('text=kubex-skel-test')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[aria-label="Loading table…"]')).not.toBeVisible();
  });

  test('shows EmptyState when kubexes array is empty', async ({ page }) => {
    await page.route(`${MANAGER}/kubexes`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto('/containers');

    await expect(page.getByText('No kubexes found')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Kubexes appear here when spawned via Manager.')).toBeVisible();
  });
});

// ── AgentDetailPage ──────────────────────────────────────────────────────────

test.describe('AgentDetailPage — skeleton + empty state', () => {
  test('shows SkeletonCard + SkeletonText (aria-busy) while agent loads', async ({ page }) => {
    await delayRoute(page, `${REGISTRY}/agents`, [], 500);

    await page.goto('/agents/test-agent-loading');

    // During loading, aria-busy skeletons should be present
    const skeletons = page.locator('[aria-busy="true"]');
    await expect(skeletons.first()).toBeVisible();
  });

  test('shows EmptyState with back action when agent not found', async ({ page }) => {
    await page.route(`${REGISTRY}/agents`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto('/agents/nonexistent-agent');

    await expect(page.getByText('Agent not found')).toBeVisible({ timeout: 5000 });
    // Back button action should be present
    await expect(page.getByRole('button', { name: '← Back to Agents' })).toBeVisible();
  });

  test('EmptyState back button navigates to /agents', async ({ page }) => {
    await page.route(`${REGISTRY}/agents`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto('/agents/nonexistent-agent');

    await page.getByRole('button', { name: '← Back to Agents' }).click();
    await expect(page.locator('header h1')).toHaveText('Agents');
  });
});

// ── ApprovalQueue ─────────────────────────────────────────────────────────────

test.describe('ApprovalQueue — skeleton + empty state', () => {
  test('shows EmptyState when no approvals exist', async ({ page }) => {
    await page.goto('/approvals');

    // After loading resolves, empty state should appear
    await expect(page.getByText('No pending approvals')).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText('Escalated actions from the policy engine will appear here.'),
    ).toBeVisible();
  });

  test('approval queue page renders without error', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.getByRole('heading', { name: 'Approval Queue' })).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
  });
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

test.describe('Dashboard — skeleton + empty state', () => {
  test('shows SkeletonCard grid (aria-busy) while agents load', async ({ page }) => {
    await delayRoute(page, `${REGISTRY}/agents`, [], 600);

    await page.goto('/');

    // During loading, at least one aria-busy element should exist
    const skeleton = page.locator('[aria-busy="true"]').first();
    await expect(skeleton).toBeVisible();
  });

  test('shows EmptyState when agents array is empty', async ({ page }) => {
    await page.route(`${REGISTRY}/agents`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto('/');

    await expect(page.getByText('No agents registered', { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('skeleton cards disappear once agents load', async ({ page }) => {
    const mockAgents = [
      {
        agent_id: 'dash-agent-001',
        capabilities: ['test'],
        status: 'running',
        boundary: 'internal',
        registered_at: new Date().toISOString(),
        metadata: {},
      },
    ];

    await page.route(`${REGISTRY}/agents`, async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockAgents),
      });
    });

    await page.goto('/');

    // Wait for content to load
    await expect(page.locator('text=dash-agent-001')).toBeVisible({ timeout: 5000 });
    // Skeleton card labels should no longer be visible
    await expect(page.locator('[aria-label="Loading card…"]')).not.toBeVisible();
  });
});
