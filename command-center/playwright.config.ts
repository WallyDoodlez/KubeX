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
  workers: 4,
  retries: 0,
  reporter: 'html',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://localhost:3099',
    trace: 'on-first-retry',
    // Pre-populate localStorage with onboarding completed so the first-run
    // tour overlay never interferes with other tests.  Tests in
    // onboarding-tour.spec.ts explicitly clear this state before each
    // tour-specific assertion.
    storageState: ONBOARDING_STATE,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx vite --port 3099',
    port: 3099,
    reuseExistingServer: true,
  },
});
