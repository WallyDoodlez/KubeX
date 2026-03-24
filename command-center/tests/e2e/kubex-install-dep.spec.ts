import { test, expect } from '@playwright/test';

const MANAGER = 'http://localhost:8090';

// ── Fixtures ─────────────────────────────────────────────────────────

const runningKubex = {
  kubex_id: 'kubex-install-001',
  agent_id: 'agent-install-001',
  status: 'running',
  image: 'kubexclaw-base:latest',
};

const stoppedKubex = {
  kubex_id: 'kubex-install-stopped',
  agent_id: 'agent-install-stopped',
  status: 'stopped',
  image: 'kubexclaw-base:latest',
};

const installSuccessResponse = {
  kubex_id: 'kubex-install-001',
  package: 'requests',
  type: 'pip',
  status: 'installed',
  runtime_deps: ['requests (type=pip)'],
};

const installErrorResponse = {
  error: 'InstallFailed',
  message: 'Package install failed (exit 1): ERROR: Could not find a version that satisfies the requirement bad-pkg',
};

/** Mock kubex list. */
async function mockKubexList(page: import('@playwright/test').Page, data = [runningKubex]) {
  await page.route(`${MANAGER}/kubexes`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    }),
  );
}

/** Mock the install-dep endpoint. */
async function mockInstallDep(
  page: import('@playwright/test').Page,
  kubexId: string,
  responseBody: object,
  status = 200,
) {
  await page.route(`${MANAGER}/kubexes/${kubexId}/install-dep`, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(responseBody),
    }),
  );
}

/** Navigate to /containers and wait for the table. */
async function goToContainers(page: import('@playwright/test').Page) {
  await page.goto('/containers');
  await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });
}

// ── Tests ─────────────────────────────────────────────────────────────

test.describe('Kubex Install Dep — + Pkg button visibility', () => {
  test('+ Pkg button is visible on running kubex', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);

    const btn = page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`);
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('+ Pkg');
  });

  test('+ Pkg button is NOT present on stopped kubex', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await goToContainers(page);

    const btn = page.locator(`[data-testid="kubex-install-dep-btn-${stoppedKubex.kubex_id}"]`);
    await expect(btn).not.toBeAttached();
  });
});

test.describe('Kubex Install Dep — panel open/close', () => {
  test('install panel is hidden by default', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);

    const panel = page.locator(`[data-testid="install-dep-panel-${runningKubex.kubex_id}"]`);
    await expect(panel).not.toBeAttached();
  });

  test('clicking + Pkg opens the install panel', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);

    await page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`).click();

    const panel = page.locator(`[data-testid="install-dep-panel-${runningKubex.kubex_id}"]`);
    await expect(panel).toBeVisible();
  });

  test('clicking + Pkg again closes the install panel (toggle)', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);

    const btn = page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`);
    await btn.click();

    const panel = page.locator(`[data-testid="install-dep-panel-${runningKubex.kubex_id}"]`);
    await expect(panel).toBeVisible();

    await btn.click();
    await expect(panel).not.toBeAttached();
  });

  test('+ Pkg button has aria-expanded=false by default', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);

    const btn = page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`);
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  test('+ Pkg button has aria-expanded=true when panel is open', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);

    const btn = page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe('Kubex Install Dep — form elements', () => {
  test('install panel shows package input, type selector, and install button', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`).click();

    await expect(page.locator(`[data-testid="install-dep-input-${runningKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="install-dep-type-${runningKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="install-dep-submit-${runningKubex.kubex_id}"]`)).toBeVisible();
  });

  test('type selector defaults to pip', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`).click();

    const select = page.locator(`[data-testid="install-dep-type-${runningKubex.kubex_id}"]`);
    await expect(select).toHaveValue('pip');
  });

  test('install button is disabled when package input is empty', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`).click();

    const submitBtn = page.locator(`[data-testid="install-dep-submit-${runningKubex.kubex_id}"]`);
    await expect(submitBtn).toBeDisabled();
  });

  test('install button becomes enabled when package name is typed', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`).click();

    const input = page.locator(`[data-testid="install-dep-input-${runningKubex.kubex_id}"]`);
    const submitBtn = page.locator(`[data-testid="install-dep-submit-${runningKubex.kubex_id}"]`);

    await input.fill('requests');
    await expect(submitBtn).toBeEnabled();
  });
});

test.describe('Kubex Install Dep — successful install', () => {
  test('successful install shows success entry in history', async ({ page }) => {
    await mockKubexList(page);
    await mockInstallDep(page, runningKubex.kubex_id, installSuccessResponse, 200);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`).click();

    await page.locator(`[data-testid="install-dep-input-${runningKubex.kubex_id}"]`).fill('requests');
    await page.locator(`[data-testid="install-dep-submit-${runningKubex.kubex_id}"]`).click();

    const history = page.locator(`[data-testid="install-dep-history-${runningKubex.kubex_id}"]`);
    await expect(history).toBeVisible({ timeout: 5000 });

    const firstResult = page.locator(`[data-testid="install-dep-result-${runningKubex.kubex_id}-0"]`);
    await expect(firstResult).toBeVisible();
    await expect(firstResult).toContainText('requests');
  });

  test('input is cleared after successful install', async ({ page }) => {
    await mockKubexList(page);
    await mockInstallDep(page, runningKubex.kubex_id, installSuccessResponse, 200);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`).click();

    const input = page.locator(`[data-testid="install-dep-input-${runningKubex.kubex_id}"]`);
    await input.fill('requests');
    await page.locator(`[data-testid="install-dep-submit-${runningKubex.kubex_id}"]`).click();

    // After success, input should be cleared
    await expect(input).toHaveValue('', { timeout: 5000 });
  });

  test('can install cli type package', async ({ page }) => {
    const cliResponse = {
      ...installSuccessResponse,
      package: 'jq',
      type: 'cli',
      runtime_deps: ['jq (type=cli)'],
    };
    await mockKubexList(page);
    await mockInstallDep(page, runningKubex.kubex_id, cliResponse, 200);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`).click();

    await page.locator(`[data-testid="install-dep-type-${runningKubex.kubex_id}"]`).selectOption('cli');
    await page.locator(`[data-testid="install-dep-input-${runningKubex.kubex_id}"]`).fill('jq');
    await page.locator(`[data-testid="install-dep-submit-${runningKubex.kubex_id}"]`).click();

    const firstResult = page.locator(`[data-testid="install-dep-result-${runningKubex.kubex_id}-0"]`);
    await expect(firstResult).toBeVisible({ timeout: 5000 });
    await expect(firstResult).toContainText('jq');
  });
});

test.describe('Kubex Install Dep — failed install', () => {
  test('failed install shows error entry in history', async ({ page }) => {
    await mockKubexList(page);
    await mockInstallDep(page, runningKubex.kubex_id, installErrorResponse, 422);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`).click();

    await page.locator(`[data-testid="install-dep-input-${runningKubex.kubex_id}"]`).fill('bad-pkg');
    await page.locator(`[data-testid="install-dep-submit-${runningKubex.kubex_id}"]`).click();

    const history = page.locator(`[data-testid="install-dep-history-${runningKubex.kubex_id}"]`);
    await expect(history).toBeVisible({ timeout: 5000 });

    const firstResult = page.locator(`[data-testid="install-dep-result-${runningKubex.kubex_id}-0"]`);
    await expect(firstResult).toBeVisible();
  });

  test('multiple installs accumulate in history', async ({ page }) => {
    await mockKubexList(page);
    // First call succeeds, second fails
    let callCount = 0;
    await page.route(`${MANAGER}/kubexes/${runningKubex.kubex_id}/install-dep`, (route) => {
      callCount++;
      if (callCount === 1) {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(installSuccessResponse) });
      } else {
        route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify(installErrorResponse) });
      }
    });

    await goToContainers(page);
    await page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`).click();

    const input = page.locator(`[data-testid="install-dep-input-${runningKubex.kubex_id}"]`);
    const submitBtn = page.locator(`[data-testid="install-dep-submit-${runningKubex.kubex_id}"]`);

    // First install
    await input.fill('requests');
    await submitBtn.click();
    await expect(page.locator(`[data-testid="install-dep-result-${runningKubex.kubex_id}-0"]`)).toBeVisible({ timeout: 5000 });

    // Second install
    await input.fill('bad-pkg');
    await submitBtn.click();
    await expect(page.locator(`[data-testid="install-dep-result-${runningKubex.kubex_id}-0"]`)).toBeVisible({ timeout: 5000 });
    await expect(page.locator(`[data-testid="install-dep-result-${runningKubex.kubex_id}-1"]`)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Kubex Install Dep — accessibility', () => {
  test('panel has role=region and aria-label', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`).click();

    const panel = page.locator(`[data-testid="install-dep-panel-${runningKubex.kubex_id}"]`);
    await expect(panel).toHaveAttribute('role', 'region');
    await expect(panel).toHaveAttribute('aria-label', `Install package into kubex ${runningKubex.kubex_id}`);
  });

  test('package input has aria-label', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`).click();

    const input = page.locator(`[data-testid="install-dep-input-${runningKubex.kubex_id}"]`);
    await expect(input).toHaveAttribute('aria-label', 'Package name');
  });

  test('type selector has aria-label', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-install-dep-btn-${runningKubex.kubex_id}"]`).click();

    const select = page.locator(`[data-testid="install-dep-type-${runningKubex.kubex_id}"]`);
    await expect(select).toHaveAttribute('aria-label', 'Package type');
  });
});
