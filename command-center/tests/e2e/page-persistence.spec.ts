/**
 * Iteration 93 — Persist last visited page across refresh
 *
 * Feature: Save the current route to localStorage (key: kubex-last-page).
 * On mount, if the URL is `/`, redirect to the saved page (if valid).
 * Direct URLs (e.g. /agents opened directly) are never overridden.
 */

import { test, expect } from '@playwright/test';
import { mockBaseRoutes } from './helpers';

const LAST_PAGE_KEY = 'kubex-last-page';

test.describe('page persistence across refresh', () => {
  test('saves current path to localStorage on navigation', async ({ page }) => {
    await mockBaseRoutes(page);
    await page.goto('/');

    // Navigate to /agents via sidebar
    await page.click('[data-testid="nav-agents"]');
    await expect(page).toHaveURL(/\/agents$/);

    // Wait for the save useEffect to flush to localStorage
    await page.waitForFunction(
      ([key, expected]) => localStorage.getItem(key) === expected,
      [LAST_PAGE_KEY, '/agents'] as [string, string],
    );

    const saved = await page.evaluate(
      (key) => localStorage.getItem(key),
      LAST_PAGE_KEY,
    );
    expect(saved).toBe('/agents');
  });

  test('redirects from `/` to saved page on refresh', async ({ page }) => {
    await mockBaseRoutes(page);

    // Pre-seed localStorage with a saved page
    await page.goto('/');
    await page.evaluate(
      ([key, val]) => localStorage.setItem(key, val),
      [LAST_PAGE_KEY, '/chat'],
    );

    // Simulate a refresh by navigating to `/` again
    // The app mounts, reads localStorage, and redirects client-side — wait for it
    await page.goto('/');
    await page.waitForURL(/\/chat$/, { timeout: 5000 });
    await expect(page).toHaveURL(/\/chat$/);
  });

  test('does NOT redirect when opening a direct URL', async ({ page }) => {
    await mockBaseRoutes(page);

    // Pre-seed localStorage with a different saved page
    await page.goto('/');
    await page.evaluate(
      ([key, val]) => localStorage.setItem(key, val),
      [LAST_PAGE_KEY, '/chat'],
    );

    // Navigate directly to /containers — the saved /chat must NOT take over
    await page.goto('/containers');
    await expect(page).toHaveURL(/\/containers$/);
  });

  test('does NOT redirect when saved page is `/`', async ({ page }) => {
    await mockBaseRoutes(page);

    await page.goto('/');
    await page.evaluate(
      ([key, val]) => localStorage.setItem(key, val),
      [LAST_PAGE_KEY, '/'],
    );

    await page.goto('/');
    // Should stay at root
    await expect(page).toHaveURL(/\/$/);
    // Ensure no redirect loop — dashboard heading is visible
    await expect(page.locator('h1')).toBeVisible();
  });

  test('does NOT redirect when saved page is invalid/unknown', async ({ page }) => {
    await mockBaseRoutes(page);

    await page.goto('/');
    await page.evaluate(
      ([key, val]) => localStorage.setItem(key, val),
      [LAST_PAGE_KEY, '/some-unknown-route'],
    );

    await page.goto('/');
    // Should stay at root — invalid paths are rejected
    await expect(page).toHaveURL(/\/$/);
  });

  test('saves path when navigating to nested /agents/:id routes', async ({ page }) => {
    await mockBaseRoutes(page);
    await page.goto('/');

    // Go to an agent detail page (navigating directly since we have no live agents)
    await page.goto('/agents/agent-alpha-001');

    const saved = await page.evaluate(
      (key) => localStorage.getItem(key),
      LAST_PAGE_KEY,
    );
    expect(saved).toBe('/agents/agent-alpha-001');
  });

  test('restores a nested /agents/:id path after refresh', async ({ page }) => {
    await mockBaseRoutes(page);
    await page.goto('/');

    await page.evaluate(
      ([key, val]) => localStorage.setItem(key, val),
      [LAST_PAGE_KEY, '/agents/agent-alpha-001'],
    );

    await page.goto('/');
    await page.waitForURL(/\/agents\/agent-alpha-001$/, { timeout: 5000 });
    await expect(page).toHaveURL(/\/agents\/agent-alpha-001$/);
  });
});
