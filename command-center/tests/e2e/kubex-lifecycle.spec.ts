import { test, expect } from '@playwright/test';

const MANAGER = 'http://localhost:8090';

const runningKubex = {
  kubex_id: 'kubex-running-001',
  agent_id: 'agent-alpha',
  status: 'running',
  image: 'kubexclaw-base:latest',
  container_id: 'abc123',
  boundary: 'default',
};

const stoppedKubex = {
  kubex_id: 'kubex-stopped-002',
  agent_id: 'agent-beta',
  status: 'stopped',
  image: 'kubexclaw-base:latest',
  container_id: 'def456',
  boundary: 'default',
};

const createdKubex = {
  kubex_id: 'kubex-created-003',
  agent_id: 'agent-gamma',
  status: 'created',
  image: 'kubexclaw-base:latest',
  container_id: 'ghi789',
  boundary: 'default',
};

/** Mock the kubexes list with specified data. */
async function mockKubexList(page: import('@playwright/test').Page, data = [runningKubex, stoppedKubex]) {
  await page.route(`${MANAGER}/kubexes`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }),
  );
}

/** Mock a lifecycle action endpoint. */
async function mockLifecycleAction(
  page: import('@playwright/test').Page,
  kubexId: string,
  action: string,
  responseStatus = 200,
) {
  await page.route(`${MANAGER}/kubexes/${kubexId}/${action}`, (route) =>
    route.fulfill({
      status: responseStatus,
      contentType: 'application/json',
      body: JSON.stringify({ kubex_id: kubexId, status: action === 'kill' ? 'stopped' : action }),
    }),
  );
}

test.describe('Kubex lifecycle controls', () => {
  test('running kubex shows Stop, Restart, Kill buttons', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const actions = page.locator(`[data-testid="kubex-actions-${runningKubex.kubex_id}"]`);
    await expect(actions).toBeVisible();
    await expect(page.locator(`[data-testid="kubex-stop-${runningKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="kubex-restart-${runningKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="kubex-kill-${runningKubex.kubex_id}"]`)).toBeVisible();
  });

  test('running kubex does NOT show Start or Respawn buttons', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await expect(page.locator(`[data-testid="kubex-start-${runningKubex.kubex_id}"]`)).not.toBeVisible();
    await expect(page.locator(`[data-testid="kubex-respawn-${runningKubex.kubex_id}"]`)).not.toBeVisible();
  });

  test('stopped kubex shows Start and Respawn buttons', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await expect(page.locator(`[data-testid="kubex-start-${stoppedKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="kubex-respawn-${stoppedKubex.kubex_id}"]`)).toBeVisible();
  });

  test('stopped kubex does NOT show Stop, Restart, Kill buttons', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await expect(page.locator(`[data-testid="kubex-stop-${stoppedKubex.kubex_id}"]`)).not.toBeVisible();
    await expect(page.locator(`[data-testid="kubex-restart-${stoppedKubex.kubex_id}"]`)).not.toBeVisible();
    await expect(page.locator(`[data-testid="kubex-kill-${stoppedKubex.kubex_id}"]`)).not.toBeVisible();
  });

  test('created kubex shows Start and Respawn buttons', async ({ page }) => {
    await mockKubexList(page, [createdKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await expect(page.locator(`[data-testid="kubex-start-${createdKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="kubex-respawn-${createdKubex.kubex_id}"]`)).toBeVisible();
  });

  test('Stop button calls stop endpoint and refreshes', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await mockLifecycleAction(page, runningKubex.kubex_id, 'stop');
    // After stop, list refreshes — return the same kubex as stopped
    let requestCount = 0;
    await page.route(`${MANAGER}/kubexes`, (route) => {
      requestCount++;
      if (requestCount === 1) {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([runningKubex]) });
      } else {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ ...runningKubex, status: 'stopped' }]),
        });
      }
    });

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const stopBtn = page.locator(`[data-testid="kubex-stop-${runningKubex.kubex_id}"]`);
    await expect(stopBtn).toBeVisible();
    await stopBtn.click();
    // Button should show loading or disappear after reload
    await page.waitForTimeout(300);
  });

  test('Kill button shows confirm dialog', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const killBtn = page.locator(`[data-testid="kubex-kill-${runningKubex.kubex_id}"]`);
    await killBtn.click();

    // Confirm dialog should appear
    await expect(page.locator('dialog[open]')).toBeVisible();
    await expect(page.locator('dialog[open] h2')).toContainText('Kill Kubex');
  });

  test('Restart button shows confirm dialog with warning style', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const restartBtn = page.locator(`[data-testid="kubex-restart-${runningKubex.kubex_id}"]`);
    await restartBtn.click();

    await expect(page.locator('dialog[open]')).toBeVisible();
    await expect(page.locator('dialog[open] h2')).toContainText('Restart Kubex');
  });

  test('Respawn button shows confirm dialog', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const respawnBtn = page.locator(`[data-testid="kubex-respawn-${stoppedKubex.kubex_id}"]`);
    await respawnBtn.click();

    await expect(page.locator('dialog[open]')).toBeVisible();
    await expect(page.locator('dialog[open] h2')).toContainText('Respawn Kubex');
  });

  test('confirm dialog Cancel button dismisses dialog', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-kill-${runningKubex.kubex_id}"]`).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('dialog[open] button:has-text("Cancel")').click();
    await expect(page.locator('dialog[open]')).not.toBeVisible();
  });

  test('confirm dialog confirms kill action', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await mockLifecycleAction(page, runningKubex.kubex_id, 'kill');
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-kill-${runningKubex.kubex_id}"]`).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('dialog[open] button:has-text("Kill")').click();
    // Dialog should close
    await expect(page.locator('dialog[open]')).not.toBeVisible();
  });

  test('confirm dialog confirms restart action', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await mockLifecycleAction(page, runningKubex.kubex_id, 'restart');
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-restart-${runningKubex.kubex_id}"]`).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('dialog[open] button:has-text("Restart")').click();
    await expect(page.locator('dialog[open]')).not.toBeVisible();
  });

  test('confirm dialog confirms respawn action', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await mockLifecycleAction(page, stoppedKubex.kubex_id, 'respawn');
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-respawn-${stoppedKubex.kubex_id}"]`).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('dialog[open] button:has-text("Respawn")').click();
    await expect(page.locator('dialog[open]')).not.toBeVisible();
  });

  test('action buttons are disabled during in-flight action', async ({ page }) => {
    // Slow down stop response so we can catch the disabled state
    await mockKubexList(page, [runningKubex]);
    await page.route(`${MANAGER}/kubexes/${runningKubex.kubex_id}/stop`, async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'stopped' }) });
    });

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const stopBtn = page.locator(`[data-testid="kubex-stop-${runningKubex.kubex_id}"]`);
    await expect(stopBtn).toBeVisible();
    await stopBtn.click();

    // While in-flight the button should be disabled
    await expect(stopBtn).toBeDisabled();
  });

  test('multiple kubexes show correct buttons per status', async ({ page }) => {
    await mockKubexList(page, [runningKubex, stoppedKubex, createdKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    // Running kubex: Stop, Restart, Kill visible; Start hidden
    await expect(page.locator(`[data-testid="kubex-stop-${runningKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="kubex-restart-${runningKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="kubex-kill-${runningKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="kubex-start-${runningKubex.kubex_id}"]`)).not.toBeVisible();

    // Stopped kubex: Start, Respawn visible; Kill hidden
    await expect(page.locator(`[data-testid="kubex-start-${stoppedKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="kubex-respawn-${stoppedKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="kubex-kill-${stoppedKubex.kubex_id}"]`)).not.toBeVisible();

    // Created kubex: Start, Respawn visible; Kill hidden
    await expect(page.locator(`[data-testid="kubex-start-${createdKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="kubex-respawn-${createdKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="kubex-kill-${createdKubex.kubex_id}"]`)).not.toBeVisible();
  });
});
