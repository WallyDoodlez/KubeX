import { test, expect } from '@playwright/test';

const MANAGER = 'http://localhost:8090';

const runningKubex = {
  kubex_id: 'kubex-toast-run-001',
  agent_id: 'agent-toast-alpha',
  status: 'running',
  image: 'kubexclaw-base:latest',
  container_id: 'abc123',
  boundary: 'default',
};

const stoppedKubex = {
  kubex_id: 'kubex-toast-stop-002',
  agent_id: 'agent-toast-beta',
  status: 'stopped',
  image: 'kubexclaw-base:latest',
  container_id: 'def456',
  boundary: 'default',
};

/** Mock kubex list — always returns the provided data. */
async function mockKubexList(page: import('@playwright/test').Page, data: object[]) {
  await page.route(`${MANAGER}/kubexes`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }),
  );
}

/** Mock a lifecycle action endpoint with a given HTTP status. */
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
      body: JSON.stringify(
        responseStatus === 200
          ? { kubex_id: kubexId, status: action === 'kill' ? 'stopped' : action }
          : { error: 'action failed' },
      ),
    }),
  );
}

test.describe('Iteration 66 — lifecycle action toasts', () => {
  test('Stop action shows success toast', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await mockLifecycleAction(page, runningKubex.kubex_id, 'stop');

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-stop-${runningKubex.kubex_id}"]`).click();

    const toast = page.locator('[data-testid="toast"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(runningKubex.kubex_id);
    await expect(toast).toContainText('Stopped');
  });

  test('Stop action failure shows error toast', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await mockLifecycleAction(page, runningKubex.kubex_id, 'stop', 500);

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-stop-${runningKubex.kubex_id}"]`).click();

    const toast = page.locator('[data-testid="toast"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Failed to stop');
    await expect(toast).toContainText(runningKubex.kubex_id);
  });

  test('Start action shows success toast', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await mockLifecycleAction(page, stoppedKubex.kubex_id, 'start');

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-start-${stoppedKubex.kubex_id}"]`).click();

    const toast = page.locator('[data-testid="toast"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Started');
    await expect(toast).toContainText(stoppedKubex.kubex_id);
  });

  test('Start action failure shows error toast', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await mockLifecycleAction(page, stoppedKubex.kubex_id, 'start', 503);

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-start-${stoppedKubex.kubex_id}"]`).click();

    const toast = page.locator('[data-testid="toast"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Failed to start');
    await expect(toast).toContainText(stoppedKubex.kubex_id);
  });

  test('Kill confirmed action shows success toast', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await mockLifecycleAction(page, runningKubex.kubex_id, 'kill');

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-kill-${runningKubex.kubex_id}"]`).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.locator('dialog[open] button:has-text("Kill")').click();
    await expect(page.locator('dialog[open]')).not.toBeVisible();

    const toast = page.locator('[data-testid="toast"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Kill');
    await expect(toast).toContainText(runningKubex.kubex_id);
  });

  test('Kill confirmed action failure shows error toast', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await mockLifecycleAction(page, runningKubex.kubex_id, 'kill', 500);

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-kill-${runningKubex.kubex_id}"]`).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.locator('dialog[open] button:has-text("Kill")').click();

    const toast = page.locator('[data-testid="toast"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Failed to kill');
    await expect(toast).toContainText(runningKubex.kubex_id);
  });

  test('Restart confirmed action shows success toast', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await mockLifecycleAction(page, runningKubex.kubex_id, 'restart');

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-restart-${runningKubex.kubex_id}"]`).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.locator('dialog[open] button:has-text("Restart")').click();

    const toast = page.locator('[data-testid="toast"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Restart');
    await expect(toast).toContainText(runningKubex.kubex_id);
  });

  test('Respawn confirmed action shows success toast', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await mockLifecycleAction(page, stoppedKubex.kubex_id, 'respawn');

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-respawn-${stoppedKubex.kubex_id}"]`).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.locator('dialog[open] button:has-text("Respawn")').click();

    const toast = page.locator('[data-testid="toast"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Respawn');
    await expect(toast).toContainText(stoppedKubex.kubex_id);
  });

  test('Delete confirmed action shows success toast', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await page.route(`${MANAGER}/kubexes/${stoppedKubex.kubex_id}`, (route) => {
      if (route.request().method() === 'DELETE') {
        route.fulfill({ status: 204, body: '' });
      } else {
        route.fallback();
      }
    });

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-delete-${stoppedKubex.kubex_id}"]`).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.locator('dialog[open] button:has-text("Delete")').click();

    const toast = page.locator('[data-testid="toast"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Delete');
    await expect(toast).toContainText(stoppedKubex.kubex_id);
  });

  test('toast is dismissible via close button', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await mockLifecycleAction(page, runningKubex.kubex_id, 'stop');

    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-stop-${runningKubex.kubex_id}"]`).click();

    const toast = page.locator('[data-testid="toast"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Dismiss via the close button
    await toast.locator('button[aria-label="Dismiss notification"]').click();
    await expect(toast).not.toBeVisible({ timeout: 2000 });
  });
});
