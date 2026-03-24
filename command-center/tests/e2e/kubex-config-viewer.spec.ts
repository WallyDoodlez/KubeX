import { test, expect } from '@playwright/test';

const MANAGER = 'http://localhost:8090';

// ── Test fixtures ────────────────────────────────────────────────────

const kubex = {
  kubex_id: 'kubex-cfg-test-001',
  agent_id: 'agent-cfg-001',
  status: 'running',
  image: 'kubexclaw-base:latest',
};

const configResponse = {
  kubex_id: 'kubex-cfg-test-001',
  config_path: '/app/configs/agent-cfg-001.yaml',
  config: {
    agent: {
      id: 'agent-cfg-001',
      boundary: 'internal',
      capabilities: ['summarise', 'extract'],
      skills: ['web-search', 'code-review'],
      providers: ['claude'],
    },
    resource_limits: {
      memory: '512m',
      cpu: '0.5',
    },
  },
};

const configResponseEmpty = {
  kubex_id: 'kubex-cfg-test-001',
  config_path: null,
  config: null,
};

const configResponseNoAgent = {
  kubex_id: 'kubex-cfg-test-001',
  config_path: '/app/configs/agent-cfg-001.yaml',
  config: { resource_limits: { memory: '256m' } },
};

/** Mock the kubex list endpoint. */
async function mockKubexList(page: import('@playwright/test').Page, data = [kubex]) {
  await page.route(`${MANAGER}/kubexes`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    }),
  );
}

/** Mock the config endpoint for a specific kubex. */
async function mockKubexConfig(
  page: import('@playwright/test').Page,
  kubexId: string,
  responseBody: object,
  status = 200,
) {
  await page.route(`${MANAGER}/kubexes/${kubexId}/config`, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(responseBody),
    }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────

test.describe('Kubex Config Viewer', () => {
  test('expand arrow is visible in each kubex row', async ({ page }) => {
    await mockKubexList(page);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const expandBtn = page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`);
    await expect(expandBtn).toBeVisible();
  });

  test('config panel is hidden by default', async ({ page }) => {
    await mockKubexList(page);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const configContent = page.locator(`[data-testid="kubex-config-content-${kubex.kubex_id}"]`);
    await expect(configContent).not.toBeVisible();
  });

  test('clicking the expand button opens the config panel', async ({ page }) => {
    await mockKubexList(page);
    await mockKubexConfig(page, kubex.kubex_id, configResponse);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const expandBtn = page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`);
    await expandBtn.click();

    const configContent = page.locator(`[data-testid="kubex-config-content-${kubex.kubex_id}"]`);
    await expect(configContent).toBeVisible({ timeout: 5000 });
  });

  test('config panel shows JSON content after loading', async ({ page }) => {
    await mockKubexList(page);
    await mockKubexConfig(page, kubex.kubex_id, configResponse);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`).click();

    const jsonDisplay = page.locator(`[data-testid="kubex-config-json-${kubex.kubex_id}"]`);
    await expect(jsonDisplay).toBeVisible({ timeout: 5000 });
    const text = await jsonDisplay.textContent();
    expect(text).toContain('agent-cfg-001');
    expect(text).toContain('summarise');
  });

  test('config panel shows config_path metadata', async ({ page }) => {
    await mockKubexList(page);
    await mockKubexConfig(page, kubex.kubex_id, configResponse);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`).click();
    await expect(page.locator(`[data-testid="kubex-config-content-${kubex.kubex_id}"]`)).toBeVisible({ timeout: 5000 });

    const content = page.locator(`[data-testid="kubex-config-content-${kubex.kubex_id}"]`);
    await expect(content).toContainText('/app/configs/agent-cfg-001.yaml');
  });

  test('summary cards render capabilities', async ({ page }) => {
    await mockKubexList(page);
    await mockKubexConfig(page, kubex.kubex_id, configResponse);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`).click();

    const capsCard = page.locator(`[data-testid="kubex-config-capabilities-${kubex.kubex_id}"]`);
    await expect(capsCard).toBeVisible({ timeout: 5000 });
    await expect(capsCard).toContainText('summarise');
    await expect(capsCard).toContainText('extract');
  });

  test('summary cards render skills', async ({ page }) => {
    await mockKubexList(page);
    await mockKubexConfig(page, kubex.kubex_id, configResponse);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`).click();

    const skillsCard = page.locator(`[data-testid="kubex-config-skills-${kubex.kubex_id}"]`);
    await expect(skillsCard).toBeVisible({ timeout: 5000 });
    await expect(skillsCard).toContainText('web-search');
    await expect(skillsCard).toContainText('code-review');
  });

  test('summary cards render boundary', async ({ page }) => {
    await mockKubexList(page);
    await mockKubexConfig(page, kubex.kubex_id, configResponse);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`).click();

    const boundaryCard = page.locator(`[data-testid="kubex-config-boundary-${kubex.kubex_id}"]`);
    await expect(boundaryCard).toBeVisible({ timeout: 5000 });
    await expect(boundaryCard).toContainText('internal');
  });

  test('summary cards render providers', async ({ page }) => {
    await mockKubexList(page);
    await mockKubexConfig(page, kubex.kubex_id, configResponse);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`).click();

    const providersCard = page.locator(`[data-testid="kubex-config-providers-${kubex.kubex_id}"]`);
    await expect(providersCard).toBeVisible({ timeout: 5000 });
    await expect(providersCard).toContainText('claude');
  });

  test('copy button is visible in config panel', async ({ page }) => {
    await mockKubexList(page);
    await mockKubexConfig(page, kubex.kubex_id, configResponse);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`).click();

    const copyBtn = page.locator(`[data-testid="kubex-config-copy-${kubex.kubex_id}"]`);
    await expect(copyBtn).toBeVisible({ timeout: 5000 });
  });

  test('clicking expand again collapses the config panel', async ({ page }) => {
    await mockKubexList(page);
    await mockKubexConfig(page, kubex.kubex_id, configResponse);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const expandBtn = page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`);
    await expandBtn.click();
    await expect(page.locator(`[data-testid="kubex-config-content-${kubex.kubex_id}"]`)).toBeVisible({ timeout: 5000 });

    // Click again to collapse
    await expandBtn.click();
    await expect(page.locator(`[data-testid="kubex-config-content-${kubex.kubex_id}"]`)).not.toBeVisible();
  });

  test('config panel shows error when manager returns 404', async ({ page }) => {
    await mockKubexList(page);
    await mockKubexConfig(page, kubex.kubex_id, { error: 'KubexNotFound', message: 'Kubex not found' }, 404);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`).click();

    const errorEl = page.locator(`[data-testid="kubex-config-error-${kubex.kubex_id}"]`);
    await expect(errorEl).toBeVisible({ timeout: 5000 });
    await expect(errorEl).toContainText('Failed to load config');
  });

  test('config panel shows empty state when config is null', async ({ page }) => {
    await mockKubexList(page);
    await mockKubexConfig(page, kubex.kubex_id, configResponseEmpty);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`).click();

    const emptyEl = page.locator(`[data-testid="kubex-config-empty-${kubex.kubex_id}"]`);
    await expect(emptyEl).toBeVisible({ timeout: 5000 });
  });

  test('config fetches exactly once on open', async ({ page }) => {
    await mockKubexList(page);

    let fetchCount = 0;
    await page.route(`${MANAGER}/kubexes/${kubex.kubex_id}/config`, (route) => {
      fetchCount++;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(configResponse),
      });
    });

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const expandBtn = page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`);

    // Open — should fetch once
    await expandBtn.click();
    await expect(page.locator(`[data-testid="kubex-config-content-${kubex.kubex_id}"]`)).toBeVisible({ timeout: 5000 });
    await expect(page.locator(`[data-testid="kubex-config-json-${kubex.kubex_id}"]`)).toBeVisible({ timeout: 5000 });

    // Should have exactly 1 fetch
    expect(fetchCount).toBe(1);
  });

  test('multiple kubexes each have their own expand button', async ({ page }) => {
    const kubex2 = { ...kubex, kubex_id: 'kubex-cfg-test-002', agent_id: 'agent-cfg-002' };
    await mockKubexList(page, [kubex, kubex2]);
    await mockKubexConfig(page, kubex.kubex_id, configResponse);
    await mockKubexConfig(page, kubex2.kubex_id, { ...configResponse, kubex_id: kubex2.kubex_id });

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await expect(page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="kubex-expand-${kubex2.kubex_id}"]`)).toBeVisible();
  });

  test('expanding one row does not expand others', async ({ page }) => {
    const kubex2 = { ...kubex, kubex_id: 'kubex-cfg-test-002', agent_id: 'agent-cfg-002' };
    await mockKubexList(page, [kubex, kubex2]);
    await mockKubexConfig(page, kubex.kubex_id, configResponse);
    await mockKubexConfig(page, kubex2.kubex_id, { ...configResponse, kubex_id: kubex2.kubex_id });

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    // Expand first row
    await page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`).click();
    await expect(page.locator(`[data-testid="kubex-config-content-${kubex.kubex_id}"]`)).toBeVisible({ timeout: 5000 });

    // Second row's config should remain hidden
    await expect(page.locator(`[data-testid="kubex-config-content-${kubex2.kubex_id}"]`)).not.toBeVisible();
  });

  test('config panel shows no agent summary cards when config has no agent section', async ({ page }) => {
    await mockKubexList(page);
    await mockKubexConfig(page, kubex.kubex_id, configResponseNoAgent);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`).click();
    await expect(page.locator(`[data-testid="kubex-config-content-${kubex.kubex_id}"]`)).toBeVisible({ timeout: 5000 });

    // No capabilities/skills cards should render when agent section is absent
    await expect(page.locator(`[data-testid="kubex-config-capabilities-${kubex.kubex_id}"]`)).not.toBeVisible();
    await expect(page.locator(`[data-testid="kubex-config-skills-${kubex.kubex_id}"]`)).not.toBeVisible();
  });

  test('aria-expanded attribute reflects panel state', async ({ page }) => {
    await mockKubexList(page);
    await mockKubexConfig(page, kubex.kubex_id, configResponse);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const expandBtn = page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`);

    // Initially collapsed
    await expect(expandBtn).toHaveAttribute('aria-expanded', 'false');

    // After click, expanded
    await expandBtn.click();
    await expect(expandBtn).toHaveAttribute('aria-expanded', 'true');

    // After second click, collapsed again
    await expandBtn.click();
    await expect(expandBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('config panel has correct data-testid when expanded', async ({ page }) => {
    await mockKubexList(page);
    await mockKubexConfig(page, kubex.kubex_id, configResponse);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    // Panel is only in DOM after expand
    await page.locator(`[data-testid="kubex-expand-${kubex.kubex_id}"]`).click();

    const panel = page.locator(`[data-testid="kubex-config-panel-${kubex.kubex_id}"]`);
    await expect(panel).toBeVisible({ timeout: 5000 });
  });
});
