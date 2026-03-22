// ── Service health ──────────────────────────────────────────────────

export interface HealthResponse {
  status: string;
  service?: string;
  [key: string]: unknown;
}

export interface ServiceHealth {
  name: string;
  url: string;
  status: 'healthy' | 'degraded' | 'down' | 'loading';
  responseTime: number | null;
  lastChecked: Date | null;
  detail?: string;
}

// ── Agents ──────────────────────────────────────────────────────────

export interface Agent {
  agent_id: string;
  capabilities: string[];
  status: 'running' | 'busy' | 'idle' | 'stopped' | string;
  boundary: string;
  registered_at?: string;
  metadata?: Record<string, unknown>;
}

// ── Kubexes (containers via Manager) ────────────────────────────────

export interface Kubex {
  kubex_id: string;
  agent_id?: string;
  status: 'running' | 'created' | 'stopped' | 'error' | string;
  image?: string;
  created_at?: string;
  started_at?: string;
  container_name?: string;
  config?: Record<string, unknown>;
}

// ── Tasks ────────────────────────────────────────────────────────────

export interface TaskRequest {
  request_id: string;
  agent_id: string;
  action: string;
  parameters: {
    capability: string;
    context_message: string;
  };
  context: {
    task_id: string | null;
    workflow_id: string;
  };
  priority: 'normal' | 'high' | 'low';
}

export interface TaskResponse {
  task_id: string;
  status?: string;
  message?: string;
  [key: string]: unknown;
}

export interface TaskResult {
  task_id: string;
  status: string;
  result?: unknown;
  error?: string;
  completed_at?: string;
  [key: string]: unknown;
}

// ── Traffic log entries (local synthetic log) ────────────────────────

export type ActionStatus = 'allowed' | 'denied' | 'escalated' | 'pending';

export interface TrafficEntry {
  id: string;
  timestamp: Date;
  agent_id: string;
  action: string;
  capability?: string;
  target?: string;
  status: ActionStatus;
  policy_rule?: string;
  task_id?: string;
  details?: unknown;
}

// ── Chat messages ────────────────────────────────────────────────────

export type ChatRole = 'user' | 'system' | 'result' | 'error';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: Date;
  task_id?: string;
  raw?: unknown;
}

// ── Traffic filters ─────────────────────────────────────────────────

export interface TrafficFilter {
  status: ActionStatus | 'all';
  agentId: string;
  search: string;
}

// ── Agent detail ────────────────────────────────────────────────────

export interface AgentDetail extends Agent {
  tasks_completed?: number;
  tasks_failed?: number;
  uptime?: string;
  last_active?: string;
}

// ── Navigation ───────────────────────────────────────────────────────

export type NavPage = 'dashboard' | 'agents' | 'traffic' | 'chat' | 'containers';
