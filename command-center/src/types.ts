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
  status: 'running' | 'busy' | 'idle' | 'stopped' | 'booting' | 'credential_wait' | 'ready' | string;
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

/** A single lifecycle phase recorded during task execution */
export type TaskPhaseStatus = 'pending' | 'active' | 'done' | 'failed';

export interface TaskPhaseEntry {
  /** Phase name shown in the timeline stepper */
  label: string;
  /** Current status of this phase */
  status: TaskPhaseStatus;
  /** ISO timestamp when this phase started/completed (optional) */
  timestamp?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: Date;
  task_id?: string;
  raw?: unknown;
  /** Explicitly chosen capability from the Advanced panel (undefined = default "orchestrate") */
  capability?: string;
  /** Original capability used when the task was dispatched — enables retry on error bubbles */
  retryCapability?: string;
  /** Original message text used when the task was dispatched — enables retry on error bubbles */
  retryMessage?: string;
  /** Task lifecycle phases — populated on result/error bubbles to show execution timeline */
  phases?: TaskPhaseEntry[];
  /** User feedback on the message result — 'up' = helpful, 'down' = not helpful, null = no feedback */
  feedback?: 'up' | 'down' | null;
}

// ── SSE streaming ───────────────────────────────────────────────────

export interface SSEChunk {
  type: 'progress' | 'output' | 'awaiting_input' | 'result' | 'cancelled' | 'failed' | string;
  content?: string;
  stream?: 'stdout' | 'stderr';
  prompt?: string;
  result?: unknown;
  error?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface HITLRequest {
  task_id: string;
  prompt: string;
  timestamp: string;
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

// ── Approvals (escalated actions) ───────────────────────────────────

export interface ApprovalRequest {
  id: string;
  task_id: string;
  agent_id: string;
  action: string;
  capability?: string;
  reason: string;
  policy_rule?: string;
  timestamp: Date;
  status: 'pending' | 'approved' | 'rejected';
}

export type ApprovalDecision = 'approve' | 'reject';

// ── Audit trail ─────────────────────────────────────────────────────

/** A single audit event stored in Redis for a task (Phase 10 — Hooks monitoring) */
export interface AuditEntry {
  /** Event type identifier, e.g. "hook_pre_task", "task_started", "hook_post_task" */
  event_type: string;
  /** ISO 8601 timestamp of when the event was recorded */
  timestamp: string;
  /** Optional hook name when the event comes from a hook */
  hook_name?: string;
  /** Exit code or status code for the event (hook exit code, etc.) */
  status?: number | string;
  /** Arbitrary additional details about the event */
  details?: string | Record<string, unknown>;
  [key: string]: unknown;
}

/** Response shape from GET /tasks/{task_id}/audit */
export interface AuditResponse {
  task_id: string;
  entries: AuditEntry[];
}

// ── Navigation ───────────────────────────────────────────────────────

export type NavPage = 'dashboard' | 'agents' | 'traffic' | 'chat' | 'containers';

// ── Spawn Wizard (Manager — POST /kubexes) ───────────────────────────

export interface CreateKubexBody {
  config: {
    agent: {
      id: string;
      boundary?: string;
      capabilities?: string[];
      providers?: string[];
      skills?: string[];
    };
    [key: string]: unknown;
  };
  resource_limits?: Record<string, string>;
  image?: string;
  skill_mounts?: string[];
}

export interface CreateKubexResponse {
  kubex_id: string;
  status?: string;
  message?: string;
  [key: string]: unknown;
}

// ── Kubex Config ─────────────────────────────────────────────────────

/** Response from GET /kubexes/{id}/config */
export interface KubexConfigResponse {
  kubex_id: string;
  config_path: string | null;
  config: Record<string, unknown> | null;
}

// ── Kubex Dependency Install ──────────────────────────────────────────

/** Request body for POST /kubexes/{id}/install-dep */
export interface InstallDepBody {
  package: string;
  type: 'pip' | 'cli';
}

/** Response from POST /kubexes/{id}/install-dep */
export interface InstallDepResponse {
  kubex_id: string;
  package: string;
  type: string;
  status: string;
  runtime_deps: string[];
}
