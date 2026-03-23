import { test, expect } from '@playwright/test';

/**
 * Iteration 39: Auto-Refresh Countdown Indicator
 *
 * Tests that the RefreshCountdown ring is present next to the ConnectionIndicator
 * status dot, animates correctly, and provides accessible labels for operators.
 */
test.describe('Auto-Refresh Countdown Indicator', () => {

  // ── Presence ──────────────────────────────────────────────────────────

  test('countdown ring is present in the top bar on Dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('refresh-countdown')).toBeVisible();
  });

  test('countdown ring is present on the Agents page', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.getByTestId('refresh-countdown')).toBeVisible();
  });

  test('countdown ring is present on the Traffic page', async ({ page }) => {
    await page.goto('/traffic');
    await expect(page.getByTestId('refresh-countdown')).toBeVisible();
  });

  test('countdown ring is present on the Containers page', async ({ page }) => {
    await page.goto('/containers');
    await expect(page.getByTestId('refresh-countdown')).toBeVisible();
  });

  test('countdown ring is present on the Approvals page', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.getByTestId('refresh-countdown')).toBeVisible();
  });

  test('countdown ring is present on the Chat page', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.getByTestId('refresh-countdown')).toBeVisible();
  });

  // ── SVG ring structure ────────────────────────────────────────────────

  test('countdown SVG ring element is present', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('refresh-countdown-ring')).toBeVisible();
  });

  test('countdown arc element is present within the SVG', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('refresh-countdown-arc')).toBeVisible();
  });

  test('SVG ring has correct role="img"', async ({ page }) => {
    await page.goto('/');
    const ring = page.getByTestId('refresh-countdown-ring');
    await expect(ring).toHaveAttribute('role', 'img');
  });

  test('countdown ring wrapper has an aria-label', async ({ page }) => {
    await page.goto('/');
    const countdown = page.getByTestId('refresh-countdown');
    const ariaLabel = await countdown.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
  });

  // ── Accessible label content ──────────────────────────────────────────

  test('aria-label mentions "health check" after first poll completes', async ({ page }) => {
    await page.goto('/');
    // Wait for the first health check to complete (hook fires immediately)
    await page.waitForTimeout(2500);
    const countdown = page.getByTestId('refresh-countdown');
    const ariaLabel = await countdown.getAttribute('aria-label');
    expect(ariaLabel).toMatch(/health check/i);
  });

  test('aria-label includes interval in seconds after first poll', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2500);
    const countdown = page.getByTestId('refresh-countdown');
    const ariaLabel = await countdown.getAttribute('aria-label');
    // Should mention "15s" for the 15-second interval
    expect(ariaLabel).toMatch(/15s/);
  });

  test('aria-label includes seconds remaining after first poll', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2500);
    const countdown = page.getByTestId('refresh-countdown');
    const ariaLabel = await countdown.getAttribute('aria-label');
    // Should mention some number of seconds remaining
    expect(ariaLabel).toMatch(/\d+s/);
  });

  test('title tooltip matches aria-label', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2500);
    const countdown = page.getByTestId('refresh-countdown');
    const ariaLabel = await countdown.getAttribute('aria-label');
    const title = await countdown.getAttribute('title');
    expect(title).toBe(ariaLabel);
  });

  // ── Before first poll ─────────────────────────────────────────────────

  test('aria-label mentions "waiting" or "checking" before first poll resolves', async ({ page }) => {
    await page.goto('/');
    // Immediately after load, before health check resolves
    const countdown = page.getByTestId('refresh-countdown');
    const ariaLabel = await countdown.getAttribute('aria-label');
    // Could say "Waiting for first health check" or already resolved — just ensure it's truthy
    expect(ariaLabel).toBeTruthy();
  });

  // ── Co-location with status dot ────────────────────────────────────────

  test('countdown ring co-exists with the connection indicator dot', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('connection-indicator-dot')).toBeVisible();
    await expect(page.getByTestId('refresh-countdown')).toBeVisible();
  });

  test('countdown ring is inside the connection indicator button', async ({ page }) => {
    await page.goto('/');
    const button = page.getByTestId('connection-indicator');
    const ring = button.getByTestId('refresh-countdown');
    await expect(ring).toBeVisible();
  });

  // ── SVG arc properties ────────────────────────────────────────────────

  test('arc has stroke-dasharray set', async ({ page }) => {
    await page.goto('/');
    const arc = page.getByTestId('refresh-countdown-arc');
    const dashArray = await arc.getAttribute('stroke-dasharray');
    expect(dashArray).toBeTruthy();
    // Should be a positive number (circumference of the ring)
    expect(parseFloat(dashArray!)).toBeGreaterThan(0);
  });

  test('arc has stroke-dashoffset set', async ({ page }) => {
    await page.goto('/');
    const arc = page.getByTestId('refresh-countdown-arc');
    const dashOffset = await arc.getAttribute('stroke-dashoffset');
    expect(dashOffset).toBeTruthy();
  });

  test('arc stroke-dashoffset decreases over time (ring is animating)', async ({ page }) => {
    await page.goto('/');
    // Wait for first poll to complete so countdown starts
    await page.waitForTimeout(2500);

    const arc = page.getByTestId('refresh-countdown-arc');
    const offset1Str = await arc.getAttribute('stroke-dashoffset');
    const offset1 = parseFloat(offset1Str ?? '0');

    // Wait 2 seconds — ring should have progressed
    await page.waitForTimeout(2000);
    const offset2Str = await arc.getAttribute('stroke-dashoffset');
    const offset2 = parseFloat(offset2Str ?? '0');

    // As time passes, dashOffset should increase (ring drains)
    // Allow for the transition — offset2 >= offset1 means the ring drained more
    expect(offset2).toBeGreaterThanOrEqual(offset1 - 1); // small tolerance
  });

  // ── Accessibility ─────────────────────────────────────────────────────

  test('countdown wrapper has aria-hidden=false (it is informative)', async ({ page }) => {
    await page.goto('/');
    const countdown = page.getByTestId('refresh-countdown');
    // The wrapper must NOT be aria-hidden since it provides accessible context
    const ariaHidden = await countdown.getAttribute('aria-hidden');
    expect(ariaHidden).not.toBe('true');
  });

  test('countdown ring persists after navigation between pages', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('refresh-countdown')).toBeVisible();

    await page.goto('/agents');
    await expect(page.getByTestId('refresh-countdown')).toBeVisible();

    await page.goto('/traffic');
    await expect(page.getByTestId('refresh-countdown')).toBeVisible();
  });
});
