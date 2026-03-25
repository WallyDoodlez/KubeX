import { http, HttpResponse } from 'msw';

// ── Base URLs (match api.ts defaults) ───────────────────────────────
const GATEWAY = 'http://localhost:8080';
const REGISTRY = 'http://localhost:8070';
const MANAGER = 'http://localhost:8090';

// ── Mock data ────────────────────────────────────────────────────────

const mockAgents = [
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

const mockKubexes = [
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

// ── Handlers ─────────────────────────────────────────────────────────

export const handlers = [
  // Health — Gateway
  http.get(`${GATEWAY}/health`, () => {
    return HttpResponse.json({ status: 'healthy', service: 'kubex-gateway' });
  }),

  // Health — Registry
  http.get(`${REGISTRY}/health`, () => {
    return HttpResponse.json({ status: 'healthy', service: 'kubex-registry' });
  }),

  // Health — Manager
  http.get(`${MANAGER}/health`, () => {
    return HttpResponse.json({ status: 'healthy', service: 'kubex-manager' });
  }),

  // Agents — Registry
  http.get(`${REGISTRY}/agents`, () => {
    return HttpResponse.json(mockAgents);
  }),

  // Agents by capability — Registry
  http.get(`${REGISTRY}/capabilities/:capability`, () => {
    return HttpResponse.json(mockAgents.slice(0, 1));
  }),

  // Agents — Gateway proxy
  http.get(`${GATEWAY}/agents`, () => {
    return HttpResponse.json(mockAgents);
  }),

  // Deregister agent — Registry
  http.delete(`${REGISTRY}/agents/:agentId`, () => {
    return HttpResponse.json({ status: 'ok', message: 'Agent deregistered' });
  }),

  // Update agent status — Registry
  http.patch(`${REGISTRY}/agents/:agentId/status`, async ({ request, params }) => {
    const { agentId } = params;
    const body = await request.json() as { status?: string };
    const agent = mockAgents.find((a) => a.agent_id === agentId);
    if (!agent) {
      return HttpResponse.json({ detail: 'Agent not found' }, { status: 404 });
    }
    if (body.status) {
      agent.status = body.status;
    }
    return HttpResponse.json({ agent_id: agentId, status: body.status ?? agent.status });
  }),

  // Kubexes — Manager
  http.get(`${MANAGER}/kubexes`, () => {
    return HttpResponse.json(mockKubexes);
  }),

  // Kill kubex — Manager
  http.post(`${MANAGER}/kubexes/:kubexId/kill`, () => {
    return HttpResponse.json({ status: 'ok', message: 'Kubex stopped' });
  }),

  // Start kubex — Manager
  http.post(`${MANAGER}/kubexes/:kubexId/start`, () => {
    return HttpResponse.json({ status: 'ok', message: 'Kubex started' });
  }),

  // Stop kubex — Manager
  http.post(`${MANAGER}/kubexes/:kubexId/stop`, () => {
    return HttpResponse.json({ status: 'ok', message: 'Kubex stopped' });
  }),

  // Restart kubex — Manager
  http.post(`${MANAGER}/kubexes/:kubexId/restart`, () => {
    return HttpResponse.json({ status: 'ok', message: 'Kubex restarted' });
  }),

  // Respawn kubex — Manager
  http.post(`${MANAGER}/kubexes/:kubexId/respawn`, () => {
    return HttpResponse.json({ status: 'ok', message: 'Kubex respawned' });
  }),

  // Delete kubex — Manager
  http.delete(`${MANAGER}/kubexes/:kubexId`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Inject credentials — Manager
  http.post(`${MANAGER}/kubexes/:kubexId/credentials`, ({ params }) => {
    const { kubexId } = params;
    return HttpResponse.json({
      status: 'injected',
      kubex_id: kubexId,
      runtime: 'claude-code',
      path: '/root/.claude/.credentials.json',
    });
  }),

  // Kill all kubexes — Manager
  http.post(`${MANAGER}/kubexes/kill-all`, () => {
    return HttpResponse.json({ status: 'ok', message: 'All kubexes killed' });
  }),

  // Pause kubex — Manager
  http.post(`${MANAGER}/kubexes/:kubexId/pause`, () => {
    return HttpResponse.json({ status: 'ok', message: 'Kubex paused' });
  }),

  // Resume kubex — Manager
  http.post(`${MANAGER}/kubexes/:kubexId/resume`, () => {
    return HttpResponse.json({ status: 'ok', message: 'Kubex resumed' });
  }),

  // Dispatch task — Gateway
  http.post(`${GATEWAY}/actions`, () => {
    return HttpResponse.json({ task_id: 'mock-task-1', status: 'accepted' });
  }),

  // Task cancel — Gateway
  http.post(`${GATEWAY}/tasks/:taskId/cancel`, ({ params }) => {
    const { taskId } = params;
    return HttpResponse.json({ task_id: taskId, status: 'cancelled' });
  }),

  // Task result — Gateway
  http.get(`${GATEWAY}/tasks/:taskId/result`, ({ params }) => {
    const { taskId } = params;
    return HttpResponse.json({
      task_id: taskId,
      status: 'completed',
      result: 'Mock result: task completed successfully by the orchestrator.',
      completed_at: new Date().toISOString(),
    });
  }),

  // Policy skill-check — Gateway
  http.post(`${GATEWAY}/policy/skill-check`, async ({ request }) => {
    const body = await request.json() as { agent_id?: string; skills?: string[] };
    const agentId = body.agent_id ?? '';
    const skills = body.skills ?? [];

    // Simulate: known agents with an allowlist; unknown agents → ESCALATE
    const allowlists: Record<string, string[]> = {
      'agent-alpha-001': ['summarise', 'classify', 'extract'],
      'agent-beta-007': ['translate', 'sentiment'],
      'agent-gamma-099': ['code_review', 'security_scan'],
    };

    const allowlist = allowlists[agentId];
    if (!allowlist) {
      return HttpResponse.json({
        decision: 'ESCALATE',
        reason: `No skill allowlist for agent '${agentId}'`,
        rule_matched: 'agent.skills.no_policy',
        agent_id: agentId,
      });
    }

    for (const skill of skills) {
      if (!allowlist.includes(skill)) {
        return HttpResponse.json({
          decision: 'ESCALATE',
          reason: `Skill '${skill}' not in allowlist for agent '${agentId}'`,
          rule_matched: 'agent.skills.escalate',
          agent_id: agentId,
        });
      }
    }

    return HttpResponse.json({
      decision: 'ALLOW',
      reason: 'All skills on allowlist',
      rule_matched: 'agent.skills.allow',
      agent_id: agentId,
    });
  }),
];
