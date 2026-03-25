/**
 * Shared mock-route helpers for E2E tests.
 *
 * In mock mode (default): sets up Playwright route interception.
 * In live mode (E2E_MODE=live): all functions are no-ops — requests hit real services.
 *
 * Usage:
 *   import { mockBaseRoutes, mockDispatch, mockSSEStream } from '../helpers/mock-routes';
 *
 *   test.beforeEach(async ({ page }) => {
 *     await mockBaseRoutes(page);          // health + agents + kubexes + escalations
 *     await mockDispatch(page, TASK_ID);   // POST /actions → dispatched
 *   });
 */

import type { Page, Route } from '@playwright/test';
import { isMockMode, GATEWAY, REGISTRY, MANAGER } from './config';
import {
  MOCK_AGENTS,
  MOCK_KUBEXES,
  MOCK_DISPATCH_RESPONSE,
  MOCK_TASK_RESULT,
  MOCK_SSE_RESULT,
} from './test-data';

// ── Helpers ─────────────────────────────────────────────────────────

type RouteHandler = (route: Route) => Promise<void> | void;

/** In mock mode, register a Playwright route. In live mode, no-op. */
async function mockRoute(page: Page, url: string, handler: RouteHandler): Promise<void> {
  if (!isMockMode) return;
  await page.route(url, handler);
}

// ── Base Routes (health, agents, kubexes, escalations) ──────────────

/**
 * Mock the four base routes every page needs to render without errors.
 * No-op in live mode.
 */
export async function mockBaseRoutes(
  page: Page,
  overrides?: {
    agents?: unknown[];
    kubexes?: unknown[];
    healthy?: boolean;
  },
): Promise<void> {
  if (!isMockMode) return;

  const agents = overrides?.agents ?? MOCK_AGENTS;
  const kubexes = overrides?.kubexes ?? MOCK_KUBEXES;
  const healthy = overrides?.healthy ?? true;

  const healthHandler = (route: Route) =>
    route.fulfill({
      status: healthy ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify({ status: healthy ? 'healthy' : 'unhealthy' }),
    });

  const agentsHandler = (route: Route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(agents),
      });
    } else {
      route.continue();
    }
  };

  const kubexesHandler = (route: Route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(kubexes),
      });
    } else {
      route.continue();
    }
  };

  const escalationsHandler = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });

  // Health — specific service URLs (NOT wildcards — wildcards intercept SPA routes)
  await page.route(`${GATEWAY}/health`, healthHandler);
  await page.route(`${REGISTRY}/health`, healthHandler);
  await page.route(`${MANAGER}/health`, healthHandler);

  // Agents — Gateway proxy + Registry (specific URLs to avoid intercepting /agents SPA route)
  await page.route(`${GATEWAY}/agents`, agentsHandler);
  await page.route(`${REGISTRY}/agents`, agentsHandler);

  // Kubexes — Manager only
  await page.route(`${MANAGER}/kubexes`, kubexesHandler);

  // Escalations — Gateway only
  await page.route(`${GATEWAY}/escalations`, escalationsHandler);
}

// ── Health Routes (specific services) ───────────────────────────────

export async function mockHealthRoutes(
  page: Page,
  statuses?: { gateway?: boolean; registry?: boolean; manager?: boolean },
): Promise<void> {
  if (!isMockMode) return;

  const gw = statuses?.gateway ?? true;
  const reg = statuses?.registry ?? true;
  const mgr = statuses?.manager ?? true;

  await page.route(`${GATEWAY}/health`, (route) =>
    route.fulfill({
      status: gw ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify({ status: gw ? 'healthy' : 'unhealthy', service: 'kubex-gateway' }),
    }),
  );
  await page.route(`${REGISTRY}/health`, (route) =>
    route.fulfill({
      status: reg ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify({ status: reg ? 'healthy' : 'unhealthy', service: 'kubex-registry' }),
    }),
  );
  await page.route(`${MANAGER}/health`, (route) =>
    route.fulfill({
      status: mgr ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify({ status: mgr ? 'healthy' : 'unhealthy', service: 'kubex-manager' }),
    }),
  );
}

// ── Task Dispatch ───────────────────────────────────────────────────

/**
 * Mock POST /actions → dispatched response.
 * Optionally provide a custom task_id and response.
 */
export async function mockDispatch(
  page: Page,
  taskId?: string,
  response?: Record<string, unknown>,
): Promise<void> {
  const resp = response ?? {
    ...MOCK_DISPATCH_RESPONSE,
    ...(taskId ? { task_id: taskId } : {}),
  };
  await mockRoute(page, `${GATEWAY}/actions`, (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(resp),
      });
    } else {
      route.continue();
    }
  });
}

// ── SSE Stream ──────────────────────────────────────────────────────

/**
 * Mock the SSE task stream endpoint.
 * @param body — raw SSE body string (use MOCK_SSE_RESULT or custom)
 *               Pass empty string '' for a non-terminating stream.
 */
export async function mockSSEStream(
  page: Page,
  taskId: string,
  body?: string,
): Promise<void> {
  const sseBody = body ?? MOCK_SSE_RESULT(taskId, 'Task completed successfully.');
  await mockRoute(page, `${GATEWAY}/tasks/${taskId}/stream`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: sseBody,
    });
  });
}

// ── Task Result ─────────────────────────────────────────────────────

/**
 * Mock GET /tasks/{id}/result → completed task result.
 */
export async function mockTaskResult(
  page: Page,
  taskId: string,
  result?: Record<string, unknown>,
): Promise<void> {
  const resp = result ?? { ...MOCK_TASK_RESULT, task_id: taskId };
  await mockRoute(page, `${GATEWAY}/tasks/${taskId}/result`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resp),
    });
  });
}

/**
 * Mock GET /tasks/{id}/result → 404 (task not found).
 */
export async function mockTaskResult404(
  page: Page,
  taskId: string,
): Promise<void> {
  await mockRoute(page, `${GATEWAY}/tasks/${taskId}/result`, (route) => {
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Task not found' }),
    });
  });
}

// ── Task Cancel ─────────────────────────────────────────────────────

export async function mockTaskCancel(
  page: Page,
  taskId: string,
): Promise<void> {
  await mockRoute(page, `${GATEWAY}/tasks/${taskId}/cancel`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ task_id: taskId, status: 'cancelled' }),
    });
  });
}

// ── Task Audit Trail ────────────────────────────────────────────────

export async function mockTaskAudit(
  page: Page,
  taskId: string,
  entries?: unknown[],
): Promise<void> {
  const data = entries ?? [
    { timestamp: '2026-03-22T08:00:00Z', event: 'dispatched', detail: 'Task dispatched' },
    { timestamp: '2026-03-22T08:00:02Z', event: 'picked_up', detail: 'Agent picked up task' },
    { timestamp: '2026-03-22T08:00:10Z', event: 'completed', detail: 'Task completed' },
  ];
  await mockRoute(page, `${GATEWAY}/tasks/${taskId}/audit`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ task_id: taskId, entries: data }),
    });
  });
}

// ── Kubex Lifecycle Actions ─────────────────────────────────────────

/**
 * Mock all kubex lifecycle endpoints (start, stop, restart, respawn, kill, delete, pause, resume).
 */
export async function mockKubexLifecycle(page: Page): Promise<void> {
  if (!isMockMode) return;

  const actions = ['start', 'stop', 'restart', 'respawn', 'kill', 'pause', 'resume'];
  for (const action of actions) {
    await page.route(`${MANAGER}/kubexes/*//${action}`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', message: `Kubex ${action}` }),
      });
    });
  }

  // Delete kubex
  await page.route(`${MANAGER}/kubexes/*`, (route) => {
    if (route.request().method() === 'DELETE') {
      route.fulfill({ status: 204 });
    } else {
      route.continue();
    }
  });

  // Kill all
  await page.route(`${MANAGER}/kubexes/kill-all`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', message: 'All kubexes killed' }),
    });
  });
}

// ── Kubex Credentials ───────────────────────────────────────────────

export async function mockKubexCredentials(page: Page): Promise<void> {
  if (!isMockMode) return;

  await page.route(`${MANAGER}/kubexes/*/credentials`, (route) => {
    const kubexId = route.request().url().split('/kubexes/')[1]?.split('/')[0];
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'injected',
        kubex_id: kubexId,
        runtime: 'claude-code',
        path: '/root/.claude/.credentials.json',
      }),
    });
  });
}

// ── Agent Registration ──────────────────────────────────────────────

export async function mockAgentRegister(page: Page): Promise<void> {
  await mockRoute(page, `${REGISTRY}/agents`, (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ agent_id: 'new-agent-001', status: 'registered' }),
      });
    } else {
      route.continue();
    }
  });
}

// ── Agent Status Update ─────────────────────────────────────────────

export async function mockAgentStatusUpdate(page: Page): Promise<void> {
  if (!isMockMode) return;

  await page.route(`${REGISTRY}/agents/*/status`, (route) => {
    if (route.request().method() === 'PATCH') {
      const agentId = route.request().url().split('/agents/')[1]?.split('/')[0];
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ agent_id: agentId, status: 'updated' }),
      });
    } else {
      route.continue();
    }
  });
}

// ── Agent Detail ────────────────────────────────────────────────────

export async function mockAgentDetail(
  page: Page,
  agentId: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const agent = data ?? {
    agent_id: agentId,
    capabilities: ['summarise', 'classify'],
    status: 'running',
    boundary: 'internal',
    registered_at: '2026-03-22T08:00:00Z',
    metadata: { version: '1.0.0' },
  };
  await mockRoute(page, `${REGISTRY}/agents/${agentId}`, (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(agent),
      });
    } else {
      route.continue();
    }
  });
}

// ── Policy Check ────────────────────────────────────────────────────

export async function mockPolicyCheck(page: Page): Promise<void> {
  await mockRoute(page, `${GATEWAY}/policy/skill-check`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        decision: 'ALLOW',
        reason: 'All skills on allowlist',
        rule_matched: 'agent.skills.allow',
        agent_id: 'mock-agent',
      }),
    });
  });
}

// ── Spawn Kubex ─────────────────────────────────────────────────────

export async function mockSpawnKubex(page: Page): Promise<void> {
  await mockRoute(page, `${MANAGER}/kubexes`, (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          kubex_id: 'kubex-new-spawn-001',
          agent_id: 'agent-alpha-001',
          status: 'created',
          container_name: 'kubex_new_spawn',
        }),
      });
    } else {
      route.continue();
    }
  });
}

// ── Convenience: Full Chat Setup ────────────────────────────────────

/**
 * Set up all routes needed for a full chat flow:
 * base routes + dispatch + SSE stream + task result.
 */
export async function mockChatFlow(
  page: Page,
  taskId: string,
  result?: string,
): Promise<void> {
  await mockBaseRoutes(page);
  await mockDispatch(page, taskId);
  await mockSSEStream(page, taskId, result ? MOCK_SSE_RESULT(taskId, result) : undefined);
  await mockTaskResult(page, taskId);
}

// ── Re-exports for convenience ──────────────────────────────────────

export { isMockMode, isLiveMode, GATEWAY, REGISTRY, MANAGER } from './config';
export { MOCK_AGENTS, MOCK_KUBEXES, MOCK_TASK_ID, MOCK_SSE_RESULT, MOCK_SSE_PROGRESS } from './test-data';
