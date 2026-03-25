/**
 * Playwright config for LIVE E2E tests (no mocks).
 *
 * Usage:
 *   E2E_MODE=live npx playwright test --config playwright.live.config.ts
 *
 * Prerequisites:
 *   - All backend services running (Gateway :8080, Registry :8070, Manager :8090)
 *   - At least one agent registered with capability 'task_orchestration'
 *   - Frontend dev server running on :3099
 *
 * Tests tagged @mock-only are automatically skipped in live mode
 * (they use test.skip(isLiveMode, ...) internally).
 */

import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ONBOARDING_STATE = join(__dirname, 'tests', 'state', 'onboarding-complete.json');

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  // Fewer workers for live mode — hitting real services
  workers: 2,
  retries: 1, // One retry for flaky network conditions
  reporter: [
    ['html', { outputFolder: 'test-results/live-report' }],
    ['json', { outputFile: 'test-results/live-results.json' }],
  ],
  // Longer timeouts for real backend round-trips
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: 'http://localhost:3099',
    trace: 'on-first-retry',
    storageState: ONBOARDING_STATE,
  },
  projects: [
    {
      name: 'chromium-live',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx vite --port 3099',
    port: 3099,
    reuseExistingServer: true,
  },
});
