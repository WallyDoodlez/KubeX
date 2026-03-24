import { test, expect } from '@playwright/test';

const GATEWAY = 'http://localhost:8080';

// ── Helpers ───────────────────────────────────────────────────────────

async function goToPolicyCheck(page: import('@playwright/test').Page) {
  await page.goto('/policy-check');
  await expect(page.locator('[data-testid="policy-check-page"]')).toBeVisible({ timeout: 10000 });
}

/** Mock the policy/skill-check endpoint with a fixed response. */
async function mockSkillCheck(
  page: import('@playwright/test').Page,
  response: object,
  status = 200,
) {
  await page.route(`${GATEWAY}/policy/skill-check`, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(response),
    }),
  );
}

// ── Navigation ────────────────────────────────────────────────────────

test.describe('Policy Check — navigation', () => {
  test('sidebar link navigates to /policy-check', async ({ page }) => {
    await page.goto('/');
    await page.click('button[aria-label="Policy Check — Skill policy tool"]');
    await expect(page).toHaveURL('/policy-check');
    await expect(page.locator('[data-testid="policy-check-page"]')).toBeVisible();
  });

  test('direct navigation to /policy-check renders the page', async ({ page }) => {
    await goToPolicyCheck(page);
    await expect(page.locator('[data-testid="policy-check-heading"]')).toHaveText('Policy Skill Check');
  });
});

// ── Page structure ────────────────────────────────────────────────────

test.describe('Policy Check — page structure', () => {
  test('shows form with agent ID input, skills textarea, and submit button', async ({ page }) => {
    await goToPolicyCheck(page);
    await expect(page.locator('[data-testid="policy-check-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="policy-agent-id-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="policy-skills-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="policy-check-submit"]')).toBeVisible();
  });

  test('shows empty state when no checks have been run', async ({ page }) => {
    await goToPolicyCheck(page);
    await expect(page.locator('[data-testid="policy-check-empty"]')).toBeVisible();
  });

  test('submit button has correct label', async ({ page }) => {
    await goToPolicyCheck(page);
    await expect(page.locator('[data-testid="policy-check-submit"]')).toContainText('Check Policy');
  });
});

// ── Validation ────────────────────────────────────────────────────────

test.describe('Policy Check — form validation', () => {
  test('shows error when agent ID is empty', async ({ page }) => {
    await goToPolicyCheck(page);
    await page.fill('[data-testid="policy-skills-input"]', 'summarise');
    await page.click('[data-testid="policy-check-submit"]');
    await expect(page.locator('[data-testid="policy-check-error"]')).toContainText('Agent ID is required');
  });

  test('shows error when skills are empty', async ({ page }) => {
    await goToPolicyCheck(page);
    await page.fill('[data-testid="policy-agent-id-input"]', 'agent-alpha-001');
    await page.click('[data-testid="policy-check-submit"]');
    await expect(page.locator('[data-testid="policy-check-error"]')).toContainText('least one skill');
  });

  test('clears error on subsequent submission', async ({ page }) => {
    await mockSkillCheck(page, {
      decision: 'ALLOW',
      reason: 'All skills on allowlist',
      rule_matched: 'agent.skills.allow',
      agent_id: 'agent-alpha-001',
    });
    await goToPolicyCheck(page);
    // Trigger validation error first
    await page.click('[data-testid="policy-check-submit"]');
    await expect(page.locator('[data-testid="policy-check-error"]')).toBeVisible();
    // Fix inputs and submit
    await page.fill('[data-testid="policy-agent-id-input"]', 'agent-alpha-001');
    await page.fill('[data-testid="policy-skills-input"]', 'summarise');
    await page.click('[data-testid="policy-check-submit"]');
    await expect(page.locator('[data-testid="policy-check-error"]')).not.toBeVisible();
  });
});

// ── ALLOW result ──────────────────────────────────────────────────────

test.describe('Policy Check — ALLOW decision', () => {
  test('shows ALLOW result with correct badge and reason', async ({ page }) => {
    await mockSkillCheck(page, {
      decision: 'ALLOW',
      reason: 'All skills on allowlist',
      rule_matched: 'agent.skills.allow',
      agent_id: 'agent-alpha-001',
    });
    await goToPolicyCheck(page);
    await page.fill('[data-testid="policy-agent-id-input"]', 'agent-alpha-001');
    await page.fill('[data-testid="policy-skills-input"]', 'summarise, classify');
    await page.click('[data-testid="policy-check-submit"]');

    const item = page.locator('[data-testid="policy-check-result-item"]').first();
    await expect(item).toBeVisible();
    await expect(item.locator('[data-testid="policy-result-decision"]')).toContainText('ALLOW');
    await expect(item.locator('[data-testid="policy-result-agent-id"]')).toContainText('agent-alpha-001');
    await expect(item.locator('[data-testid="policy-result-reason"]')).toContainText('All skills on allowlist');
  });

  test('hides empty state once a result is present', async ({ page }) => {
    await mockSkillCheck(page, {
      decision: 'ALLOW',
      reason: 'All skills on allowlist',
      rule_matched: 'agent.skills.allow',
      agent_id: 'agent-alpha-001',
    });
    await goToPolicyCheck(page);
    await page.fill('[data-testid="policy-agent-id-input"]', 'agent-alpha-001');
    await page.fill('[data-testid="policy-skills-input"]', 'summarise');
    await page.click('[data-testid="policy-check-submit"]');
    await expect(page.locator('[data-testid="policy-check-empty"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="policy-check-results"]')).toBeVisible();
  });
});

// ── ESCALATE result ───────────────────────────────────────────────────

test.describe('Policy Check — ESCALATE decision', () => {
  test('shows ESCALATE result when skill is not on allowlist', async ({ page }) => {
    await mockSkillCheck(page, {
      decision: 'ESCALATE',
      reason: "Skill 'hack' not in allowlist for agent 'agent-alpha-001'",
      rule_matched: 'agent.skills.escalate',
      agent_id: 'agent-alpha-001',
    });
    await goToPolicyCheck(page);
    await page.fill('[data-testid="policy-agent-id-input"]', 'agent-alpha-001');
    await page.fill('[data-testid="policy-skills-input"]', 'hack');
    await page.click('[data-testid="policy-check-submit"]');

    const item = page.locator('[data-testid="policy-check-result-item"]').first();
    await expect(item.locator('[data-testid="policy-result-decision"]')).toContainText('ESCALATE');
    await expect(item.locator('[data-testid="policy-result-reason"]')).toContainText("Skill 'hack' not in allowlist");
  });

  test('shows ESCALATE for unknown agent (no policy)', async ({ page }) => {
    await mockSkillCheck(page, {
      decision: 'ESCALATE',
      reason: "No skill allowlist for agent 'agent-unknown'",
      rule_matched: 'agent.skills.no_policy',
      agent_id: 'agent-unknown',
    });
    await goToPolicyCheck(page);
    await page.fill('[data-testid="policy-agent-id-input"]', 'agent-unknown');
    await page.fill('[data-testid="policy-skills-input"]', 'summarise');
    await page.click('[data-testid="policy-check-submit"]');

    const item = page.locator('[data-testid="policy-check-result-item"]').first();
    await expect(item.locator('[data-testid="policy-result-decision"]')).toContainText('ESCALATE');
    await expect(item.locator('[data-testid="policy-result-reason"]')).toContainText('No skill allowlist');
  });
});

// ── Multiple skills parsing ───────────────────────────────────────────

test.describe('Policy Check — skills parsing', () => {
  test('parses comma-separated skills into individual tags', async ({ page }) => {
    await mockSkillCheck(page, {
      decision: 'ALLOW',
      reason: 'All skills on allowlist',
      rule_matched: 'agent.skills.allow',
      agent_id: 'agent-alpha-001',
    });
    await goToPolicyCheck(page);
    await page.fill('[data-testid="policy-agent-id-input"]', 'agent-alpha-001');
    await page.fill('[data-testid="policy-skills-input"]', 'summarise, classify, extract');
    await page.click('[data-testid="policy-check-submit"]');

    const item = page.locator('[data-testid="policy-check-result-item"]').first();
    await expect(item).toBeVisible();
    // All three skill tags should appear inside the result item
    await expect(item.locator('span.font-mono').filter({ hasText: 'summarise' })).toBeVisible();
    await expect(item.locator('span.font-mono').filter({ hasText: 'classify' })).toBeVisible();
    await expect(item.locator('span.font-mono').filter({ hasText: 'extract' })).toBeVisible();
  });

  test('parses newline-separated skills', async ({ page }) => {
    await mockSkillCheck(page, {
      decision: 'ALLOW',
      reason: 'All skills on allowlist',
      rule_matched: 'agent.skills.allow',
      agent_id: 'agent-beta-007',
    });
    await goToPolicyCheck(page);
    await page.fill('[data-testid="policy-agent-id-input"]', 'agent-beta-007');
    await page.fill('[data-testid="policy-skills-input"]', 'translate\nsentiment');
    await page.click('[data-testid="policy-check-submit"]');

    const item = page.locator('[data-testid="policy-check-result-item"]').first();
    await expect(item).toBeVisible();
    await expect(item.locator('span.font-mono').filter({ hasText: 'translate' })).toBeVisible();
    await expect(item.locator('span.font-mono').filter({ hasText: 'sentiment' })).toBeVisible();
  });
});

// ── Multiple checks / history ─────────────────────────────────────────

test.describe('Policy Check — history', () => {
  test('accumulates multiple results newest-first', async ({ page }) => {
    let callCount = 0;
    await page.route(`${GATEWAY}/policy/skill-check`, (route) => {
      callCount++;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          decision: callCount === 1 ? 'ALLOW' : 'ESCALATE',
          reason: callCount === 1 ? 'All skills on allowlist' : 'No policy',
          rule_matched: callCount === 1 ? 'agent.skills.allow' : 'agent.skills.no_policy',
          agent_id: callCount === 1 ? 'agent-alpha-001' : 'agent-unknown',
        }),
      });
    });

    await goToPolicyCheck(page);

    // First check
    await page.fill('[data-testid="policy-agent-id-input"]', 'agent-alpha-001');
    await page.fill('[data-testid="policy-skills-input"]', 'summarise');
    await page.click('[data-testid="policy-check-submit"]');
    await expect(page.locator('[data-testid="policy-check-result-item"]')).toHaveCount(1);

    // Second check
    await page.fill('[data-testid="policy-agent-id-input"]', 'agent-unknown');
    await page.fill('[data-testid="policy-skills-input"]', 'hack');
    await page.click('[data-testid="policy-check-submit"]');
    await expect(page.locator('[data-testid="policy-check-result-item"]')).toHaveCount(2);

    // Newest first — first item should be ESCALATE (second call)
    const firstItem = page.locator('[data-testid="policy-check-result-item"]').first();
    await expect(firstItem.locator('[data-testid="policy-result-decision"]')).toContainText('ESCALATE');
  });

  test('clear button removes all results and shows empty state', async ({ page }) => {
    await mockSkillCheck(page, {
      decision: 'ALLOW',
      reason: 'All skills on allowlist',
      rule_matched: 'agent.skills.allow',
      agent_id: 'agent-alpha-001',
    });
    await goToPolicyCheck(page);
    await page.fill('[data-testid="policy-agent-id-input"]', 'agent-alpha-001');
    await page.fill('[data-testid="policy-skills-input"]', 'summarise');
    await page.click('[data-testid="policy-check-submit"]');
    await expect(page.locator('[data-testid="policy-check-result-item"]')).toHaveCount(1);

    await page.click('[data-testid="policy-check-clear"]');
    await expect(page.locator('[data-testid="policy-check-result-item"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="policy-check-empty"]')).toBeVisible();
  });
});

// ── Network error handling ────────────────────────────────────────────

test.describe('Policy Check — error handling', () => {
  test('shows error when Gateway returns non-ok status', async ({ page }) => {
    await mockSkillCheck(page, { detail: 'Internal Server Error' }, 500);
    await goToPolicyCheck(page);
    await page.fill('[data-testid="policy-agent-id-input"]', 'agent-alpha-001');
    await page.fill('[data-testid="policy-skills-input"]', 'summarise');
    await page.click('[data-testid="policy-check-submit"]');
    await expect(page.locator('[data-testid="policy-check-error"]')).toBeVisible();
    // No result items should be added on error
    await expect(page.locator('[data-testid="policy-check-result-item"]')).toHaveCount(0);
  });
});

// ── Accessibility ─────────────────────────────────────────────────────

test.describe('Policy Check — accessibility', () => {
  test('form has accessible label', async ({ page }) => {
    await goToPolicyCheck(page);
    await expect(page.locator('[aria-label="Policy skill check form"]')).toBeVisible();
  });

  test('agent ID and skills inputs have associated labels', async ({ page }) => {
    await goToPolicyCheck(page);
    await expect(page.locator('label[for="policy-agent-id"]')).toBeVisible();
    await expect(page.locator('label[for="policy-skills"]')).toBeVisible();
  });

  test('error message has role=alert', async ({ page }) => {
    await goToPolicyCheck(page);
    await page.click('[data-testid="policy-check-submit"]');
    await expect(page.locator('[role="alert"][data-testid="policy-check-error"]')).toBeVisible();
  });

  test('results section has accessible label', async ({ page }) => {
    await mockSkillCheck(page, {
      decision: 'ALLOW',
      reason: 'All skills on allowlist',
      rule_matched: 'agent.skills.allow',
      agent_id: 'agent-alpha-001',
    });
    await goToPolicyCheck(page);
    await page.fill('[data-testid="policy-agent-id-input"]', 'agent-alpha-001');
    await page.fill('[data-testid="policy-skills-input"]', 'summarise');
    await page.click('[data-testid="policy-check-submit"]');
    await expect(page.locator('[aria-label="Policy check results"]')).toBeVisible();
  });
});
