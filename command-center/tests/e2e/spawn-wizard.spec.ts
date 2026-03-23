import { test, expect } from '@playwright/test';

const REGISTRY = 'http://localhost:8070';
const MANAGER = 'http://localhost:8090';

const mockAgents = [
  {
    agent_id: 'agent-alpha',
    capabilities: ['orchestrate', 'file-analysis', 'code-review'],
    status: 'running',
    boundary: 'default',
  },
  {
    agent_id: 'agent-beta',
    capabilities: ['orchestrate', 'data-extraction', 'web-scraping'],
    status: 'idle',
    boundary: 'default',
  },
];

async function mockRegistryAgents(page: import('@playwright/test').Page) {
  await page.route(`${REGISTRY}/agents`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockAgents),
    }),
  );
}

async function mockManagerSpawn(
  page: import('@playwright/test').Page,
  response: object = { kubex_id: 'kubex-test-abc123', status: 'created' },
  status = 200,
) {
  await page.route(`${MANAGER}/kubexes`, (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    } else {
      route.continue();
    }
  });
}

test.describe('Spawn Wizard — /spawn page', () => {
  test.beforeEach(async ({ page }) => {
    await mockRegistryAgents(page);
    await page.goto('/spawn');
  });

  // ── Page structure ────────────────────────────────────────────────

  test('page loads at /spawn', async ({ page }) => {
    await expect(page.getByTestId('spawn-wizard')).toBeVisible();
  });

  test('page heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Spawn Kubex Wizard' })).toBeVisible();
  });

  test('stepper shows 4 steps', async ({ page }) => {
    const stepper = page.getByTestId('spawn-stepper');
    await expect(stepper).toBeVisible();
    for (let i = 1; i <= 4; i++) {
      await expect(page.getByTestId(`step-indicator-${i}`)).toBeVisible();
    }
  });

  test('nav link to /spawn exists in sidebar', async ({ page }) => {
    const navLink = page.getByRole('button', { name: /Spawn Kubex/i });
    await expect(navLink).toBeVisible();
  });

  // ── Step 1: Identity ──────────────────────────────────────────────

  test('step 1 identity section is visible on load', async ({ page }) => {
    await expect(page.getByTestId('step-identity')).toBeVisible();
  });

  test('step 1: agent ID input is present', async ({ page }) => {
    await expect(page.getByTestId('agent-id-input')).toBeVisible();
  });

  test('step 1: boundary input is present', async ({ page }) => {
    await expect(page.getByTestId('boundary-input')).toBeVisible();
  });

  test('step 1: boundary defaults to "default"', async ({ page }) => {
    await expect(page.getByTestId('boundary-input')).toHaveValue('default');
  });

  test('step 1: validation prevents empty agent ID from advancing', async ({ page }) => {
    const nextBtn = page.getByTestId('wizard-next-btn');
    await nextBtn.click();
    // Should show error and stay on step 1
    await expect(page.getByTestId('agent-id-error')).toBeVisible();
    await expect(page.getByTestId('step-identity')).toBeVisible();
  });

  test('step 1: validation error shown for invalid agent ID characters', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('invalid id!');
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('agent-id-error')).toBeVisible();
  });

  test('step 1: valid agent ID advances to step 2', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('step-capabilities')).toBeVisible();
  });

  test('step 1: back button is disabled on first step', async ({ page }) => {
    const backBtn = page.getByTestId('wizard-back-btn');
    await expect(backBtn).toBeDisabled();
  });

  // ── Step 2: Capabilities ──────────────────────────────────────────

  test('step 2: capabilities section is visible after advancing', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('step-capabilities')).toBeVisible();
  });

  test('step 2: capability chips are displayed from registry', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('capability-chips')).toBeVisible();
    // At least one chip should appear (unique caps from mockAgents)
    const chips = page.getByTestId('capability-chips').getByRole('button');
    await expect(chips.first()).toBeVisible();
  });

  test('step 2: can select a capability chip', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    // Wait for chips to load
    await expect(page.getByTestId('capability-chips')).toBeVisible();
    const chip = page.getByTestId('cap-chip-orchestrate');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  test('step 2: can add a custom capability', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('custom-capability-input').fill('my-custom-cap');
    await page.getByTestId('add-capability-btn').click();
    await expect(page.getByTestId('selected-cap-my-custom-cap')).toBeVisible();
  });

  test('step 2: custom capability can be added via Enter key', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('custom-capability-input').fill('enter-cap');
    await page.getByTestId('custom-capability-input').press('Enter');
    await expect(page.getByTestId('selected-cap-enter-cap')).toBeVisible();
  });

  test('step 2: validation error shown if no capabilities selected', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('step-capabilities')).toBeVisible();
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('capabilities-error')).toBeVisible();
  });

  // ── Step 3: Resources ─────────────────────────────────────────────

  test('step 3: resource presets section is visible', async ({ page }) => {
    // Advance to step 3
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('step-resources')).toBeVisible();
  });

  test('step 3: Light preset is visible', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('preset-light')).toBeVisible();
  });

  test('step 3: Medium preset is visible', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('preset-medium')).toBeVisible();
  });

  test('step 3: Heavy preset is visible', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('preset-heavy')).toBeVisible();
  });

  test('step 3: Custom preset reveals CPU and memory inputs', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('preset-custom').click();
    await expect(page.getByTestId('custom-resource-inputs')).toBeVisible();
    await expect(page.getByTestId('custom-cpu-input')).toBeVisible();
    await expect(page.getByTestId('custom-memory-input')).toBeVisible();
  });

  test('step 3: selecting a preset highlights it', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('preset-heavy').click();
    await expect(page.getByTestId('preset-heavy')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('preset-light')).toHaveAttribute('aria-checked', 'false');
  });

  // ── Step 4: Review ────────────────────────────────────────────────

  test('step 4: review panel shows config JSON', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('test-agent-99');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('step-review')).toBeVisible();
    await expect(page.getByTestId('config-json-preview')).toBeVisible();
    // Agent ID should appear in the JSON
    await expect(page.getByTestId('config-json-preview')).toContainText('test-agent-99');
  });

  test('step 4: Spawn Kubex button is present', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('test-agent-99');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('spawn-button')).toBeVisible();
  });

  // ── Back navigation ───────────────────────────────────────────────

  test('back button returns from step 2 to step 1', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('step-capabilities')).toBeVisible();
    await page.getByTestId('wizard-back-btn').click();
    await expect(page.getByTestId('step-identity')).toBeVisible();
  });

  test('back button returns from step 3 to step 2', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('step-resources')).toBeVisible();
    await page.getByTestId('wizard-back-btn').click();
    await expect(page.getByTestId('step-capabilities')).toBeVisible();
  });

  test('back button returns from step 4 to step 3', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('step-review')).toBeVisible();
    await page.getByTestId('wizard-back-btn').click();
    await expect(page.getByTestId('step-resources')).toBeVisible();
  });

  // ── Spawn action ──────────────────────────────────────────────────

  test('successful spawn shows success panel with kubex ID', async ({ page }) => {
    await mockManagerSpawn(page, { kubex_id: 'kubex-test-abc123' });
    await page.getByTestId('agent-id-input').fill('test-agent-99');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('spawn-button').click();
    await expect(page.getByTestId('spawn-success')).toBeVisible();
    await expect(page.getByTestId('spawned-kubex-id')).toContainText('kubex-test-abc123');
  });

  test('successful spawn shows View in Containers button', async ({ page }) => {
    await mockManagerSpawn(page, { kubex_id: 'kubex-test-abc123' });
    await page.getByTestId('agent-id-input').fill('test-agent-99');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('spawn-button').click();
    await expect(page.getByTestId('view-containers-btn')).toBeVisible();
  });

  test('successful spawn shows Spawn Another button', async ({ page }) => {
    await mockManagerSpawn(page, { kubex_id: 'kubex-test-abc123' });
    await page.getByTestId('agent-id-input').fill('test-agent-99');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('spawn-button').click();
    await expect(page.getByTestId('spawn-another-btn')).toBeVisible();
  });

  test('Spawn Another resets the wizard to step 1', async ({ page }) => {
    await mockManagerSpawn(page, { kubex_id: 'kubex-test-abc123' });
    await page.getByTestId('agent-id-input').fill('test-agent-99');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('spawn-button').click();
    await page.getByTestId('spawn-another-btn').click();
    await expect(page.getByTestId('step-identity')).toBeVisible();
    await expect(page.getByTestId('agent-id-input')).toHaveValue('');
  });

  test('failed spawn shows error state', async ({ page }) => {
    await mockManagerSpawn(page, { detail: 'Manager unavailable' }, 500);
    await page.getByTestId('agent-id-input').fill('test-agent-99');
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('cap-chip-orchestrate').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('spawn-button').click();
    await expect(page.getByTestId('spawn-error')).toBeVisible();
  });

  // ── Step indicator ─────────────────────────────────────────────────

  test('step 2 indicator is aria-current when on step 2', async ({ page }) => {
    await page.getByTestId('agent-id-input').fill('my-agent-01');
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('step-indicator-2')).toHaveAttribute('aria-current', 'step');
  });
});
