import { chromium, FullConfig } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Global Playwright setup — runs once before all tests.
 *
 * Creates a storage state file with the onboarding tour marked as completed.
 * This prevents the first-run tour overlay from interfering with other tests
 * (the tour overlay is a fixed z-index 9000 dialog that can affect accessible
 * name resolution and element visibility in Playwright's aria engine).
 *
 * Tests in onboarding-tour.spec.ts explicitly clear this state via
 * clearOnboarding(page) before testing tour functionality.
 */
export default async function globalSetup(_config: FullConfig) {
  const stateDir = join(__dirname, '..', 'state');
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  const stateFile = join(stateDir, 'onboarding-complete.json');

  // Create a browser instance just to generate the storage state
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: 'http://localhost:3099' });
  const page = await context.newPage();

  // Navigate to the app and set onboarding as completed
  await page.goto('http://localhost:3099');
  await page.evaluate(() => {
    localStorage.setItem(
      'kubex-onboarding',
      JSON.stringify({ completed: true, currentStep: 0, active: false })
    );
  });

  // Save the storage state (includes cookies + localStorage)
  await context.storageState({ path: stateFile });
  await browser.close();
}
