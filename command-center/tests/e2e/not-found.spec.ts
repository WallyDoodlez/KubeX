import { test, expect } from '@playwright/test';

test.describe('404 Not Found page', () => {
  test('renders not-found page for unknown route', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await expect(page.locator('[data-testid="not-found-page"]')).toBeVisible();
  });

  test('heading reads "Page not found"', async ({ page }) => {
    await page.goto('/totally/unknown/path');
    await expect(page.locator('[data-testid="not-found-heading"]')).toHaveText('Page not found');
  });

  test('description text is present', async ({ page }) => {
    await page.goto('/does-not-exist');
    await expect(page.locator('[data-testid="not-found-description"]')).toBeVisible();
  });

  test('"Back to Dashboard" button is present', async ({ page }) => {
    await page.goto('/no-such-page');
    const btn = page.locator('[data-testid="not-found-home-link"]');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Back to Dashboard');
  });

  test('"Back to Dashboard" navigates to Dashboard', async ({ page }) => {
    await page.goto('/nonexistent');
    await page.locator('[data-testid="not-found-home-link"]').click();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  });

  test('404 glyph is rendered', async ({ page }) => {
    await page.goto('/garbage-route');
    // The large decorative "404" text is in the DOM (aria-hidden, but still in DOM)
    await expect(page.locator('[data-testid="not-found-page"]')).toContainText('404');
  });

  test('layout sidebar and top bar are still present on 404 page', async ({ page }) => {
    await page.goto('/unknown-route-xyz');
    // Layout wraps all routes including catch-all
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible();
  });

  test('known routes do NOT render not-found page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="not-found-page"]')).not.toBeVisible();
  });

  test('agents route does not show not-found page', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.locator('[data-testid="not-found-page"]')).not.toBeVisible();
  });

  test('deeply nested unknown route shows not-found page', async ({ page }) => {
    await page.goto('/agents/unknown-agent/deeply/nested');
    await expect(page.locator('[data-testid="not-found-page"]')).toBeVisible();
  });
});

test.describe('Favicon and PWA manifest', () => {
  test('manifest.json is served at /manifest.json', async ({ page }) => {
    const response = await page.goto('/manifest.json');
    expect(response?.status()).toBe(200);
    const contentType = response?.headers()['content-type'] ?? '';
    expect(contentType).toMatch(/json/);
  });

  test('manifest has correct app name', async ({ page }) => {
    const response = await page.goto('/manifest.json');
    const body = await response?.json();
    expect(body.name).toBe('KubexClaw Command Center');
    expect(body.short_name).toBe('KubexClaw');
  });

  test('manifest has correct theme and background colors', async ({ page }) => {
    const response = await page.goto('/manifest.json');
    const body = await response?.json();
    expect(body.theme_color).toBe('#10b981');
    expect(body.background_color).toBe('#0f1117');
  });

  test('manifest display mode is standalone', async ({ page }) => {
    const response = await page.goto('/manifest.json');
    const body = await response?.json();
    expect(body.display).toBe('standalone');
  });

  test('manifest has at least one icon entry', async ({ page }) => {
    const response = await page.goto('/manifest.json');
    const body = await response?.json();
    expect(Array.isArray(body.icons)).toBe(true);
    expect(body.icons.length).toBeGreaterThan(0);
  });

  test('favicon.svg is served at /favicon.svg', async ({ page }) => {
    const response = await page.goto('/favicon.svg');
    expect(response?.status()).toBe(200);
    const contentType = response?.headers()['content-type'] ?? '';
    expect(contentType).toMatch(/svg/);
  });

  test('index.html references manifest.json', async ({ page }) => {
    const response = await page.goto('/');
    const html = await response?.text();
    expect(html).toContain('manifest.json');
  });

  test('index.html has theme-color meta tag', async ({ page }) => {
    await page.goto('/');
    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(themeColor).toBe('#10b981');
  });

  test('index.html has description meta tag', async ({ page }) => {
    await page.goto('/');
    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(desc).toBeTruthy();
    expect(desc!.length).toBeGreaterThan(10);
  });
});
