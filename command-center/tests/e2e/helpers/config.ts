/**
 * E2E Test Configuration — Dual-mode support (mock vs live)
 *
 * Environment variable: E2E_MODE
 *   - "mock"  (default) — Playwright route interception mocks all backend calls
 *   - "live"  — No mocks; requests hit real running services
 *
 * When running in CI as the FE team (mocked):
 *   npx playwright test
 *
 * When running as the BE/QA team against live services:
 *   E2E_MODE=live npx playwright test --config playwright.live.config.ts
 */

export type E2EMode = 'mock' | 'live';

export const E2E_MODE: E2EMode =
  (process.env.E2E_MODE as E2EMode) ?? 'mock';

export const isMockMode = E2E_MODE === 'mock';
export const isLiveMode = E2E_MODE === 'live';

// ── Service URLs ────────────────────────────────────────────────────
// In mock mode these are intercepted by Playwright routes.
// In live mode these hit the real services.
export const GATEWAY  = process.env.E2E_GATEWAY_URL  ?? 'http://localhost:8080';
export const REGISTRY = process.env.E2E_REGISTRY_URL ?? 'http://localhost:8070';
export const MANAGER  = process.env.E2E_MANAGER_URL  ?? 'http://localhost:8090';
