import { test, expect } from '@playwright/test';

const MANAGER = 'http://localhost:8090';

// ── Fixtures ─────────────────────────────────────────────────────────

const runningKubex = {
  kubex_id: 'kubex-cred-001',
  agent_id: 'agent-cred-001',
  status: 'running',
  image: 'kubexclaw-base:latest',
};

const stoppedKubex = {
  kubex_id: 'kubex-cred-stopped',
  agent_id: 'agent-cred-stopped',
  status: 'stopped',
  image: 'kubexclaw-base:latest',
};

const credSuccessResponse = {
  status: 'injected',
  kubex_id: 'kubex-cred-001',
  runtime: 'claude-code',
  path: '/root/.claude/.credentials.json',
};

const credErrorResponse = {
  error: 'ContainerNotFound',
  message: 'Container not running for kubex: kubex-cred-001',
};

const validCredJson = JSON.stringify({
  access_token: 'sk-ant-test-token',
  refresh_token: 'sk-ant-refresh-test',
  expires_at: 9999999999,
});

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

/** Mock the credentials endpoint. */
async function mockCredentials(
  page: import('@playwright/test').Page,
  kubexId: string,
  responseBody: object,
  status = 200,
) {
  await page.route(`${MANAGER}/kubexes/${kubexId}/credentials`, (route) =>
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

// ── Button visibility ─────────────────────────────────────────────────

test.describe('Kubex Credentials — Creds button visibility', () => {
  test('Creds button is visible on running kubex', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);

    const btn = page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`);
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('Creds');
  });

  test('Creds button is NOT present on stopped kubex', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await goToContainers(page);

    const btn = page.locator(`[data-testid="kubex-credentials-btn-${stoppedKubex.kubex_id}"]`);
    await expect(btn).not.toBeAttached();
  });
});

// ── Panel open / close ───────────────────────────────────────────────

test.describe('Kubex Credentials — panel open/close', () => {
  test('credential panel is hidden by default', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);

    const panel = page.locator(`[data-testid="credential-panel-${runningKubex.kubex_id}"]`);
    await expect(panel).not.toBeAttached();
  });

  test('clicking Creds opens the credential panel', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);

    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    const panel = page.locator(`[data-testid="credential-panel-${runningKubex.kubex_id}"]`);
    await expect(panel).toBeVisible();
  });

  test('clicking Creds again closes the panel (toggle)', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);

    const btn = page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`);
    await btn.click();

    const panel = page.locator(`[data-testid="credential-panel-${runningKubex.kubex_id}"]`);
    await expect(panel).toBeVisible();

    await btn.click();
    await expect(panel).not.toBeAttached();
  });

  test('Creds button has aria-expanded=false by default', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);

    const btn = page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`);
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  test('Creds button has aria-expanded=true when panel is open', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);

    const btn = page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
  });
});

// ── Form elements ────────────────────────────────────────────────────

test.describe('Kubex Credentials — form elements', () => {
  test('panel shows runtime selector, JSON textarea, and inject button', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    await expect(page.locator(`[data-testid="credential-runtime-${runningKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="credential-json-${runningKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="credential-submit-${runningKubex.kubex_id}"]`)).toBeVisible();
  });

  test('runtime selector defaults to claude-code', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    const select = page.locator(`[data-testid="credential-runtime-${runningKubex.kubex_id}"]`);
    await expect(select).toHaveValue('claude-code');
  });

  test('runtime selector has all three runtime options', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    const select = page.locator(`[data-testid="credential-runtime-${runningKubex.kubex_id}"]`);
    await expect(select.locator('option[value="claude-code"]')).toBeAttached();
    await expect(select.locator('option[value="codex-cli"]')).toBeAttached();
    await expect(select.locator('option[value="gemini-cli"]')).toBeAttached();
  });

  test('inject button is disabled when JSON textarea is empty', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    const submitBtn = page.locator(`[data-testid="credential-submit-${runningKubex.kubex_id}"]`);
    await expect(submitBtn).toBeDisabled();
  });

  test('inject button is disabled when JSON is invalid', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    const textarea = page.locator(`[data-testid="credential-json-${runningKubex.kubex_id}"]`);
    await textarea.fill('{ invalid json ');

    const submitBtn = page.locator(`[data-testid="credential-submit-${runningKubex.kubex_id}"]`);
    await expect(submitBtn).toBeDisabled();
  });

  test('JSON error message shown for invalid JSON', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    await page.locator(`[data-testid="credential-json-${runningKubex.kubex_id}"]`).fill('{ bad }');

    const errorMsg = page.locator(`[data-testid="credential-json-error-${runningKubex.kubex_id}"]`);
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText('Invalid JSON');
  });

  test('inject button is enabled when JSON textarea has valid JSON object', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    await page.locator(`[data-testid="credential-json-${runningKubex.kubex_id}"]`).fill(validCredJson);

    const submitBtn = page.locator(`[data-testid="credential-submit-${runningKubex.kubex_id}"]`);
    await expect(submitBtn).toBeEnabled();
  });
});

// ── Successful injection ─────────────────────────────────────────────

test.describe('Kubex Credentials — successful injection', () => {
  test('successful injection shows success entry in history', async ({ page }) => {
    await mockKubexList(page);
    await mockCredentials(page, runningKubex.kubex_id, credSuccessResponse, 200);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    await page.locator(`[data-testid="credential-json-${runningKubex.kubex_id}"]`).fill(validCredJson);
    await page.locator(`[data-testid="credential-submit-${runningKubex.kubex_id}"]`).click();

    const history = page.locator(`[data-testid="credential-history-${runningKubex.kubex_id}"]`);
    await expect(history).toBeVisible({ timeout: 5000 });

    const firstResult = page.locator(`[data-testid="credential-result-${runningKubex.kubex_id}-0"]`);
    await expect(firstResult).toBeVisible();
    await expect(firstResult).toContainText('claude-code');
  });

  test('JSON textarea is cleared after successful injection', async ({ page }) => {
    await mockKubexList(page);
    await mockCredentials(page, runningKubex.kubex_id, credSuccessResponse, 200);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    const textarea = page.locator(`[data-testid="credential-json-${runningKubex.kubex_id}"]`);
    await textarea.fill(validCredJson);
    await page.locator(`[data-testid="credential-submit-${runningKubex.kubex_id}"]`).click();

    await expect(textarea).toHaveValue('', { timeout: 5000 });
  });

  test('can inject with gemini-cli runtime selected', async ({ page }) => {
    const geminiResponse = {
      ...credSuccessResponse,
      runtime: 'gemini-cli',
      path: '/root/.gemini/oauth_creds.json',
    };
    await mockKubexList(page);
    await mockCredentials(page, runningKubex.kubex_id, geminiResponse, 200);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    await page.locator(`[data-testid="credential-runtime-${runningKubex.kubex_id}"]`).selectOption('gemini-cli');
    await page.locator(`[data-testid="credential-json-${runningKubex.kubex_id}"]`).fill(validCredJson);
    await page.locator(`[data-testid="credential-submit-${runningKubex.kubex_id}"]`).click();

    const firstResult = page.locator(`[data-testid="credential-result-${runningKubex.kubex_id}-0"]`);
    await expect(firstResult).toBeVisible({ timeout: 5000 });
    await expect(firstResult).toContainText('gemini-cli');
  });
});

// ── Failed injection ─────────────────────────────────────────────────

test.describe('Kubex Credentials — failed injection', () => {
  test('failed injection shows error entry in history', async ({ page }) => {
    await mockKubexList(page);
    await mockCredentials(page, runningKubex.kubex_id, credErrorResponse, 404);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    await page.locator(`[data-testid="credential-json-${runningKubex.kubex_id}"]`).fill(validCredJson);
    await page.locator(`[data-testid="credential-submit-${runningKubex.kubex_id}"]`).click();

    const history = page.locator(`[data-testid="credential-history-${runningKubex.kubex_id}"]`);
    await expect(history).toBeVisible({ timeout: 5000 });

    const firstResult = page.locator(`[data-testid="credential-result-${runningKubex.kubex_id}-0"]`);
    await expect(firstResult).toBeVisible();
  });
});

// ── Accessibility ────────────────────────────────────────────────────

test.describe('Kubex Credentials — accessibility', () => {
  test('panel has role=region and aria-label', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    const panel = page.locator(`[data-testid="credential-panel-${runningKubex.kubex_id}"]`);
    await expect(panel).toHaveAttribute('role', 'region');
    await expect(panel).toHaveAttribute('aria-label', `Inject credentials into kubex ${runningKubex.kubex_id}`);
  });

  test('runtime selector has aria-label', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    const select = page.locator(`[data-testid="credential-runtime-${runningKubex.kubex_id}"]`);
    await expect(select).toHaveAttribute('aria-label', 'CLI runtime');
  });

  test('JSON textarea has aria-label', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    const textarea = page.locator(`[data-testid="credential-json-${runningKubex.kubex_id}"]`);
    await expect(textarea).toHaveAttribute('aria-label', 'Credential JSON');
  });

  test('JSON error has role=alert', async ({ page }) => {
    await mockKubexList(page);
    await goToContainers(page);
    await page.locator(`[data-testid="kubex-credentials-btn-${runningKubex.kubex_id}"]`).click();

    await page.locator(`[data-testid="credential-json-${runningKubex.kubex_id}"]`).fill('bad json');

    const errorMsg = page.locator(`[data-testid="credential-json-error-${runningKubex.kubex_id}"]`);
    await expect(errorMsg).toHaveAttribute('role', 'alert');
  });
});
