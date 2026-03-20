import type {
  Agent,
  HealthResponse,
  Kubex,
  TaskRequest,
  TaskResponse,
  TaskResult,
} from './types';

// ── Service base URLs ───────────────────────────────────────────────
// In Docker Compose the command-center reaches services by container name.
// In dev (npm run dev) it hits localhost ports.
// We read from env vars so Vite can expose them at build time.

function getBase(envKey: string, fallback: string): string {
  // Vite exposes VITE_* env vars on import.meta.env
  const val = import.meta.env[envKey as keyof ImportMetaEnv] as string | undefined;
  return val ?? fallback;
}

export const GATEWAY = getBase('VITE_GATEWAY_URL', 'http://localhost:8080');
export const REGISTRY = getBase('VITE_REGISTRY_URL', 'http://localhost:8070');
export const MANAGER = getBase('VITE_MANAGER_URL', 'http://localhost:8090');
export const MANAGER_TOKEN = getBase('VITE_MANAGER_TOKEN', 'changeme-manager-token');

// ── Low-level fetch wrapper ─────────────────────────────────────────

interface FetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  responseTime: number;
}

async function apiFetch<T>(
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<FetchResult<T>> {
  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const responseTime = performance.now() - start;
    const text = await res.text();
    let data: T | null = null;
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text as unknown as T;
    }

    return { ok: res.ok, status: res.status, data, error: null, responseTime };
  } catch (err) {
    const responseTime = performance.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: null, error, responseTime };
  } finally {
    clearTimeout(timeout);
  }
}

function managerHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${MANAGER_TOKEN}` };
}

// ── Health checks ────────────────────────────────────────────────────

export async function getGatewayHealth(): Promise<FetchResult<HealthResponse>> {
  return apiFetch<HealthResponse>('GET', `${GATEWAY}/health`);
}

export async function getRegistryHealth(): Promise<FetchResult<HealthResponse>> {
  return apiFetch<HealthResponse>('GET', `${REGISTRY}/health`);
}

export async function getManagerHealth(): Promise<FetchResult<HealthResponse>> {
  return apiFetch<HealthResponse>('GET', `${MANAGER}/health`, undefined, managerHeaders());
}

// Broker has no host port — we poll via Gateway proxy if available.
// Gateway exposes a /health/broker passthrough or we just try our best.
export async function getBrokerHealth(): Promise<FetchResult<HealthResponse>> {
  // Try gateway proxy path first; fall back gracefully
  return apiFetch<HealthResponse>('GET', `${GATEWAY}/health/broker`);
}

// ── Agents (Registry) ────────────────────────────────────────────────

export async function getAgents(): Promise<FetchResult<Agent[]>> {
  return apiFetch<Agent[]>('GET', `${REGISTRY}/agents`);
}

export async function getAgentsByCapability(cap: string): Promise<FetchResult<Agent[]>> {
  return apiFetch<Agent[]>('GET', `${REGISTRY}/capabilities/${encodeURIComponent(cap)}`);
}

export async function deregisterAgent(agentId: string): Promise<FetchResult<unknown>> {
  return apiFetch<unknown>('DELETE', `${REGISTRY}/agents/${encodeURIComponent(agentId)}`);
}

// ── Kubexes (Manager) ────────────────────────────────────────────────

export async function getKubexes(): Promise<FetchResult<Kubex[]>> {
  return apiFetch<Kubex[]>('GET', `${MANAGER}/kubexes`, undefined, managerHeaders());
}

export async function killKubex(kubexId: string): Promise<FetchResult<unknown>> {
  return apiFetch<unknown>(
    'POST',
    `${MANAGER}/kubexes/${encodeURIComponent(kubexId)}/kill`,
    undefined,
    managerHeaders(),
  );
}

export async function startKubex(kubexId: string): Promise<FetchResult<unknown>> {
  return apiFetch<unknown>(
    'POST',
    `${MANAGER}/kubexes/${encodeURIComponent(kubexId)}/start`,
    undefined,
    managerHeaders(),
  );
}

// ── Tasks (Gateway) ──────────────────────────────────────────────────

export async function dispatchTask(
  capability: string,
  message: string,
  agentId = 'command-center',
): Promise<FetchResult<TaskResponse>> {
  const body: TaskRequest = {
    request_id: crypto.randomUUID(),
    agent_id: agentId,
    action: 'dispatch_task',
    parameters: {
      capability,
      context_message: message,
    },
    context: {
      task_id: null,
      workflow_id: `cc-${Date.now()}`,
    },
    priority: 'normal',
  };
  return apiFetch<TaskResponse>('POST', `${GATEWAY}/actions`, body);
}

export async function getTaskResult(taskId: string): Promise<FetchResult<TaskResult>> {
  return apiFetch<TaskResult>('GET', `${GATEWAY}/tasks/${encodeURIComponent(taskId)}/result`);
}

// ── Gateway agents proxy ─────────────────────────────────────────────

export async function getGatewayAgents(): Promise<FetchResult<Agent[]>> {
  return apiFetch<Agent[]>('GET', `${GATEWAY}/agents`);
}
