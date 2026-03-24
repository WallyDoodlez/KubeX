import { test, expect } from '@playwright/test';

const MANAGER = 'http://localhost:8090';

const runningKubex = {
  kubex_id: 'kubex-running-del-001',
  agent_id: 'agent-alpha',
  status: 'running',
  image: 'kubexclaw-base:latest',
  container_id: 'abc123',
  boundary: 'default',
};

const stoppedKubex = {
  kubex_id: 'kubex-stopped-del-002',
  agent_id: 'agent-beta',
  status: 'stopped',
  image: 'kubexclaw-base:latest',
  container_id: 'def456',
  boundary: 'default',
};

/** Mock the kubexes list endpoint. */
async function mockKubexList(page: import('@playwright/test').Page, data: object[]) {
  await page.route(`${MANAGER}/kubexes`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }),
  );
}

/** Mock the DELETE endpoint for a specific kubex. */
async function mockDeleteKubex(
  page: import('@playwright/test').Page,
  kubexId: string,
  responseStatus = 204,
) {
  await page.route(`${MANAGER}/kubexes/${kubexId}`, (route) => {
    if (route.request().method() === 'DELETE') {
      route.fulfill({ status: responseStatus, body: '' });
    } else {
      route.fallback();
    }
  });
}

test.describe('Kubex delete confirmation', () => {
  test('Delete button is visible for a running kubex', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const deleteBtn = page.locator(`[data-testid="kubex-delete-${runningKubex.kubex_id}"]`);
    await expect(deleteBtn).toBeVisible();
  });

  test('Delete button is visible for a stopped kubex', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const deleteBtn = page.locator(`[data-testid="kubex-delete-${stoppedKubex.kubex_id}"]`);
    await expect(deleteBtn).toBeVisible();
  });

  test('Delete button opens confirm dialog', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-delete-${stoppedKubex.kubex_id}"]`).click();

    await expect(page.locator('dialog[open]')).toBeVisible();
    await expect(page.locator('dialog[open] h2')).toContainText('Delete Kubex');
  });

  test('confirm dialog shows kubex ID in the message', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-delete-${stoppedKubex.kubex_id}"]`).click();

    await expect(page.locator('dialog[open]')).toBeVisible();
    await expect(page.locator('dialog[open]')).toContainText(stoppedKubex.kubex_id);
  });

  test('confirm dialog has a Delete confirm button', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-delete-${stoppedKubex.kubex_id}"]`).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await expect(page.locator('dialog[open] button:has-text("Delete")')).toBeVisible();
  });

  test('Cancel dismisses dialog without deleting', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-delete-${stoppedKubex.kubex_id}"]`).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('dialog[open] button:has-text("Cancel")').click();
    await expect(page.locator('dialog[open]')).not.toBeVisible();

    // Row should still be visible (no deletion happened)
    await expect(page.locator(`[data-testid="kubex-delete-${stoppedKubex.kubex_id}"]`)).toBeVisible();
  });

  test('confirming delete calls DELETE endpoint and refreshes', async ({ page }) => {
    let deleteCallCount = 0;
    let listCallCount = 0;

    await page.route(`${MANAGER}/kubexes`, (route) => {
      if (route.request().method() === 'GET') {
        listCallCount++;
        if (listCallCount === 1) {
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([stoppedKubex]) });
        } else {
          // After delete, return empty list
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
        }
      } else {
        route.fallback();
      }
    });

    await page.route(`${MANAGER}/kubexes/${stoppedKubex.kubex_id}`, (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCallCount++;
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
    await expect(page.locator('dialog[open]')).not.toBeVisible();

    // Wait for refresh
    await page.waitForTimeout(500);

    expect(deleteCallCount).toBe(1);
    expect(listCallCount).toBeGreaterThan(1);
  });

  test('Delete button is also visible for running kubex', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-delete-${runningKubex.kubex_id}"]`).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await expect(page.locator('dialog[open] h2')).toContainText('Delete Kubex');
  });

  test('Delete dialog warns about running container', async ({ page }) => {
    await mockKubexList(page, [runningKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await page.locator(`[data-testid="kubex-delete-${runningKubex.kubex_id}"]`).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    // Should mention "kill it first" to warn user
    await expect(page.locator('dialog[open]')).toContainText('kill it first');
  });

  test('Delete button has correct test ID for each kubex', async ({ page }) => {
    await mockKubexList(page, [runningKubex, stoppedKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    await expect(page.locator(`[data-testid="kubex-delete-${runningKubex.kubex_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="kubex-delete-${stoppedKubex.kubex_id}"]`)).toBeVisible();
  });

  test('Delete button is focusable via keyboard', async ({ page }) => {
    await mockKubexList(page, [stoppedKubex]);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    const deleteBtn = page.locator(`[data-testid="kubex-delete-${stoppedKubex.kubex_id}"]`);
    await deleteBtn.focus();
    await expect(deleteBtn).toBeFocused();
  });

  test('deleting one of multiple kubexes only affects the targeted one', async ({ page }) => {
    await mockKubexList(page, [runningKubex, stoppedKubex]);
    await mockDeleteKubex(page, stoppedKubex.kubex_id);
    await page.goto('/containers');
    await expect(page.locator('[data-testid="containers-table"]')).toBeVisible({ timeout: 10000 });

    // Click delete on the stopped kubex
    await page.locator(`[data-testid="kubex-delete-${stoppedKubex.kubex_id}"]`).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await expect(page.locator('dialog[open]')).toContainText(stoppedKubex.kubex_id);

    // Dialog should NOT mention the running kubex
    await expect(page.locator('dialog[open]')).not.toContainText(runningKubex.kubex_id);
  });
});
