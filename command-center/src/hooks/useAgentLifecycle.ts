import { useState, useEffect, useRef, useCallback } from 'react';
import { getAgentLifecycleStreamUrl, getAgentLifecycleAuthHeader } from '../api';

export type LifecycleState =
  | 'booting'
  | 'ready'
  | 'running'
  | 'busy'
  | 'credential_wait'
  | 'stopped'
  | string;

export type LifecycleConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

interface UseAgentLifecycleResult {
  state: LifecycleState | null;
  isConnected: boolean;
  connectionStatus: LifecycleConnectionStatus;
  error: string | null;
}

const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_RETRIES = 8;

/**
 * useAgentLifecycle — subscribes to GET /agents/{agentId}/lifecycle SSE stream.
 *
 * Uses fetch() + ReadableStream instead of native EventSource so we can send
 * Authorization headers (EventSource doesn't support custom headers).
 *
 * Follows the same pattern used by LiveOutputTab in AgentDetailPage.tsx.
 *
 * @param agentId - the agent_id to subscribe to. Pass null to skip.
 */
export function useAgentLifecycle(agentId: string | null): UseAgentLifecycleResult {
  const [state, setState] = useState<LifecycleState | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<LifecycleConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const disconnect = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    if (!agentId) return;

    disconnect();

    if (!mountedRef.current) return;

    setConnectionStatus('connecting');
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const url = getAgentLifecycleStreamUrl(agentId);
      const authHeader = getAgentLifecycleAuthHeader();
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      if (authHeader) headers['Authorization'] = authHeader;

      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!mountedRef.current) return;

      if (!res.ok) {
        setConnectionStatus('error');
        setError(`HTTP ${res.status} — ${res.statusText || 'connection refused'}`);
        scheduleRetry();
        return;
      }

      if (!res.body) {
        setConnectionStatus('error');
        setError('No response body — SSE not supported by this endpoint');
        return;
      }

      setConnectionStatus('connected');
      retryCountRef.current = 0;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames — split on double newline
        const frames = buffer.split(/\n\n/);
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const lines = frame.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const raw = line.slice(5).trim();
              if (!raw) continue;
              try {
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                if (typeof parsed.state === 'string' && mountedRef.current) {
                  setState(parsed.state as LifecycleState);
                }
              } catch {
                // Non-JSON SSE data — ignore
              }
            }
          }
        }
      }

      if (mountedRef.current) {
        setConnectionStatus('closed');
        // Stream closed cleanly — reconnect with backoff
        scheduleRetry();
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if ((err as Error).name === 'AbortError') {
        setConnectionStatus('closed');
      } else {
        setConnectionStatus('error');
        setError((err as Error).message ?? 'Stream error');
        scheduleRetry();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, disconnect]);

  function scheduleRetry() {
    if (!mountedRef.current) return;
    if (retryCountRef.current >= MAX_RETRIES) {
      setConnectionStatus('error');
      setError('Max reconnect attempts reached');
      return;
    }
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** retryCountRef.current, MAX_BACKOFF_MS);
    retryCountRef.current += 1;
    retryTimerRef.current = setTimeout(() => {
      if (mountedRef.current) connect();
    }, delay);
  }

  useEffect(() => {
    mountedRef.current = true;
    if (agentId) {
      retryCountRef.current = 0;
      connect();
    } else {
      setConnectionStatus('idle');
      setState(null);
      setError(null);
    }
    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [agentId, connect, disconnect]);

  return {
    state,
    isConnected: connectionStatus === 'connected',
    connectionStatus,
    error,
  };
}
