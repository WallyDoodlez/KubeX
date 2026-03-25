/**
 * Centralized mock data for E2E tests.
 * Used by mock-routes.ts when E2E_MODE=mock.
 * Also available for assertions in live mode.
 */

export const MOCK_AGENTS = [
  {
    agent_id: 'agent-alpha-001',
    capabilities: ['summarise', 'classify', 'extract'],
    status: 'running',
    boundary: 'internal',
    registered_at: '2026-03-22T08:00:00Z',
    metadata: { version: '1.2.0', region: 'us-east-1' },
  },
  {
    agent_id: 'agent-beta-007',
    capabilities: ['translate', 'sentiment'],
    status: 'idle',
    boundary: 'restricted',
    registered_at: '2026-03-22T09:15:00Z',
    metadata: { version: '1.1.3', region: 'eu-west-1' },
  },
  {
    agent_id: 'agent-gamma-099',
    capabilities: ['code_review', 'security_scan'],
    status: 'busy',
    boundary: 'internal',
    registered_at: '2026-03-21T14:30:00Z',
    metadata: { version: '2.0.0', region: 'us-west-2' },
  },
];

export const MOCK_KUBEXES = [
  {
    kubex_id: 'kubex-550e8400-e29b-41d4',
    agent_id: 'agent-alpha-001',
    status: 'running',
    image: 'kubex-base:latest',
    container_name: 'kubex_alpha_001',
    created_at: '2026-03-22T08:00:00Z',
    started_at: '2026-03-22T08:00:05Z',
    config: { memory_limit: '512m', cpu_quota: 50000 },
  },
  {
    kubex_id: 'kubex-6ba7b810-9dad-11d1',
    agent_id: 'agent-beta-007',
    status: 'created',
    image: 'kubex-base:latest',
    container_name: 'kubex_beta_007',
    created_at: '2026-03-22T09:15:00Z',
    started_at: null,
    config: { memory_limit: '256m', cpu_quota: 25000 },
  },
  {
    kubex_id: 'kubex-c2bb65b5-1a8d-4b3c',
    agent_id: 'agent-gamma-099',
    status: 'stopped',
    image: 'kubex-base:latest',
    container_name: 'kubex_gamma_099',
    created_at: '2026-03-21T14:30:00Z',
    started_at: null,
    config: { memory_limit: '128m', cpu_quota: 10000 },
  },
];

export const MOCK_TASK_ID = 'mock-task-e2e-001';

export const MOCK_DISPATCH_RESPONSE = {
  task_id: MOCK_TASK_ID,
  status: 'dispatched',
};

export const MOCK_TASK_RESULT = {
  task_id: MOCK_TASK_ID,
  status: 'completed',
  result: 'Mock result: task completed successfully by the orchestrator.',
  completed_at: '2026-03-22T10:00:00Z',
};

export const MOCK_SSE_RESULT = (taskId: string, result: string) =>
  `data: ${JSON.stringify({ type: 'result', result })}\n\n`;

export const MOCK_SSE_PROGRESS = (taskId: string, chunk: string) =>
  `data: ${JSON.stringify({ type: 'progress', chunk })}\n\n`;
