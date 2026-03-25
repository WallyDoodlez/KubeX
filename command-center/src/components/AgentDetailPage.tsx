import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAgents, dispatchTask, getAgentLifecycleStreamUrl, getAgentLifecycleAuthHeader, updateAgentStatus } from '../api';
import type { Agent, TrafficEntry } from '../types';
import { validateCapability, validateMessage } from '../utils/validation';
import { useAppContext } from '../context/AppContext';
import { useFavorites } from '../hooks/useFavorites';
import Tabs from './Tabs';
import StatusBadge from './StatusBadge';
import { SkeletonCard, SkeletonText } from './SkeletonLoader';
import EmptyState from './EmptyState';
import Breadcrumb from './Breadcrumb';
import CopyButton from './CopyButton';
import AgentTaskMetrics from './AgentTaskMetrics';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'actions', label: 'Actions' },
  { id: 'task-metrics', label: 'Task Metrics' },
  { id: 'live-output', label: 'Live Output' },
  { id: 'config', label: 'Config' },
];

export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const { trafficLog, addTrafficEntry } = useAppContext();
  const { isFavorite, toggle: toggleFavorite } = useFavorites();

  const loadAgent = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    const res = await getAgents();
    if (res.ok && Array.isArray(res.data)) {
      const found = res.data.find((a) => a.agent_id === agentId);
      if (found) {
        setAgent(found);
      } else {
        setError(`Agent "${agentId}" not found`);
      }
    } else {
      setError(res.error ?? `HTTP ${res.status}`);
    }
    if (!silent) setLoading(false);
  }, [agentId]);

  // Silent refresh callback — refreshes agent data without triggering loading skeleton
  const silentRefresh = useCallback(() => { loadAgent(true); }, [loadAgent]);

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  if (loading) {
    return (
      <div className="p-6 animate-fade-in space-y-4">
        <SkeletonCard />
        <SkeletonText lines={4} />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="p-6 animate-fade-in">
        <EmptyState
          icon="⚠"
          title="Agent not found"
          description={error ?? 'The requested agent could not be found.'}
          action={{ label: '← Back to Agents', onClick: () => navigate('/agents') }}
        />
      </div>
    );
  }

  // Filter traffic log entries for this specific agent
  const agentTraffic = trafficLog.filter(
    (e) => e.agent_id === agent.agent_id || e.agent_id === agentId,
  );

  return (
    <div className="p-6 animate-fade-in">
      {/* Breadcrumb navigation */}
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Agents', path: '/agents' },
          { label: agent.agent_id, ariaLabel: `Agent ${agent.agent_id}` },
        ]}
      />

      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-lg font-semibold text-[var(--color-text)] font-mono-data">{agent.agent_id}</h2>
        <CopyButton text={agent.agent_id} ariaLabel="Copy agent ID" testId="copy-agent-id-heading" />
        <button
          aria-label={isFavorite(agent.agent_id) ? 'Unpin agent' : 'Pin agent'}
          data-testid="agent-detail-favorite-btn"
          onClick={() => toggleFavorite(agent.agent_id)}
          className={`text-lg transition-colors focus:outline-none focus:ring-1 focus:ring-amber-400/40 rounded ${isFavorite(agent.agent_id) ? 'text-amber-400 hover:text-amber-300' : 'text-[var(--color-text-muted)] hover:text-amber-400'}`}
        >
          {isFavorite(agent.agent_id) ? '★' : '☆'}
        </button>
        <StatusBadge status={agent.status} />
      </div>

      {/* Tabs */}
      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'overview' && (
          <OverviewTab agent={agent} onDispatchClick={() => setActiveTab('actions')} onStatusUpdated={silentRefresh} />
        )}
        {activeTab === 'actions' && (
          <ActionsTab agent={agent} trafficLog={agentTraffic} addTrafficEntry={addTrafficEntry} />
        )}
        {activeTab === 'task-metrics' && <AgentTaskMetrics agentId={agent.agent_id} />}
        {activeTab === 'live-output' && <LiveOutputTab agentId={agent.agent_id} />}
        {activeTab === 'config' && <ConfigTab agent={agent} />}
      </Tabs>
    </div>
  );
}

// ── Agent Status Controls ─────────────────────────────────────────

type AgentStatusValue = 'running' | 'stopped' | 'busy' | 'unknown';

const STATUS_OPTIONS: { value: AgentStatusValue; label: string; color: string; bg: string; border: string }[] = [
  { value: 'running', label: 'Running', color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30' },
  { value: 'busy', label: 'Busy', color: 'text-blue-400', bg: 'bg-blue-500/15', border: 'border-blue-500/30' },
  { value: 'stopped', label: 'Stopped', color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/30' },
  { value: 'unknown', label: 'Unknown', color: 'text-[var(--color-text-muted)]', bg: 'bg-[var(--color-border)]', border: 'border-[var(--color-border-strong)]' },
];

function AgentStatusControls({
  agent,
  onStatusUpdated,
}: {
  agent: Agent;
  onStatusUpdated: () => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  async function handleStatusChange(newStatus: AgentStatusValue) {
    if (updating || newStatus === agent.status) return;
    setUpdating(true);
    setResult(null);
    const res = await updateAgentStatus(agent.agent_id, newStatus);
    if (res.ok) {
      setResult({ ok: true, message: `Status updated to "${newStatus}"` });
      onStatusUpdated();
    } else {
      setResult({ ok: false, message: res.error ?? `HTTP ${res.status}` });
    }
    setUpdating(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setResult(null), 4000);
  }

  return (
    <div
      data-testid="agent-status-controls"
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-3">
        Change Status
      </p>
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map(({ value, label, color, bg, border }) => {
          const isActive = agent.status === value;
          return (
            <button
              key={value}
              data-testid={`status-btn-${value}`}
              onClick={() => handleStatusChange(value)}
              disabled={updating || isActive}
              aria-pressed={isActive}
              aria-label={`Set agent status to ${label}`}
              className={`
                text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors
                focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-[var(--color-surface)]
                ${isActive
                  ? `${color} ${bg} ${border} opacity-100 cursor-default ring-2 ${border.replace('border-', 'ring-')}`
                  : `text-[var(--color-text-muted)] bg-[var(--color-bg)] border-[var(--color-border)] hover:${color} hover:${bg} hover:${border}`
                }
                disabled:opacity-40 disabled:cursor-not-allowed
              `}
            >
              {isActive && <span className="mr-1.5">●</span>}
              {label}
            </button>
          );
        })}
      </div>
      {updating && (
        <p data-testid="status-update-loading" className="text-[10px] text-[var(--color-text-muted)] mt-2 animate-pulse">
          Updating…
        </p>
      )}
      {result && !updating && (
        <p
          data-testid={result.ok ? 'status-update-success' : 'status-update-error'}
          className={`text-[10px] mt-2 ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {result.ok ? '✓ ' : '✗ '}{result.message}
        </p>
      )}
    </div>
  );
}

// ── Tab content ──────────────────────────────────────────────────────

function OverviewTab({
  agent,
  onDispatchClick,
  onStatusUpdated,
}: {
  agent: Agent;
  onDispatchClick: () => void;
  onStatusUpdated: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Info grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <InfoCard label="Agent ID" value={agent.agent_id} mono copyable />
        <InfoCard label="Status" value={agent.status} />
        <InfoCard label="Boundary" value={agent.boundary} />
        {agent.registered_at && <InfoCard label="Registered" value={agent.registered_at} mono />}
      </div>

      {/* Status controls */}
      <AgentStatusControls agent={agent} onStatusUpdated={onStatusUpdated} />

      {/* Capabilities */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">Capabilities</p>
          {agent.capabilities.length > 0 && (
            <button
              onClick={onDispatchClick}
              data-testid="dispatch-task-btn"
              className="
                text-xs px-3 py-1 rounded-lg font-medium
                bg-emerald-500/15 text-emerald-400 border border-emerald-500/30
                hover:bg-emerald-500/25 hover:border-emerald-500/50
                transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/40
              "
            >
              Dispatch Task →
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {agent.capabilities.length === 0 ? (
            <span className="text-xs text-[var(--color-text-dim)]">No capabilities registered</span>
          ) : (
            agent.capabilities.map((cap) => (
              <span key={cap} className="text-xs font-mono-data px-2 py-1 rounded-lg bg-[var(--color-border)] text-[var(--color-text-secondary)] border border-[var(--color-border-strong)]">
                {cap}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Metadata */}
      {agent.metadata && Object.keys(agent.metadata).length > 0 && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-2">Metadata</p>
          <pre className="text-xs font-mono-data text-[var(--color-text-secondary)] bg-[var(--color-bg)] rounded-lg p-3 overflow-x-auto border border-[var(--color-border)]">
            {JSON.stringify(agent.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Lifecycle event shape ──────────────────────────────────────────

interface LifecycleEvent {
  id: string;
  agent_id?: string;
  state?: string;
  timestamp?: string;
  raw: string;
  receivedAt: Date;
}

type LiveOutputConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

function LiveOutputTab({ agentId }: { agentId: string }) {
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [status, setStatus] = useState<LiveOutputConnectionStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new events arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  const disconnect = useCallback(() => {
    abortRef.current?.abort();
    readerRef.current?.cancel().catch(() => {});
    readerRef.current = null;
    abortRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    disconnect();
    setStatus('connecting');
    setErrorMsg(null);

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

      if (!res.ok) {
        setStatus('error');
        setErrorMsg(`HTTP ${res.status} — ${res.statusText || 'connection refused'}`);
        return;
      }

      if (!res.body) {
        setStatus('error');
        setErrorMsg('No response body — SSE not supported');
        return;
      }

      setStatus('connected');
      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames: split on double newline
        const frames = buffer.split(/\n\n/);
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const lines = frame.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const raw = line.slice(5).trim();
              if (!raw) continue;
              let parsed: Record<string, unknown> = {};
              try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { /* not JSON */ }
              const ev: LifecycleEvent = {
                id: crypto.randomUUID(),
                agent_id: parsed.agent_id as string | undefined,
                state: parsed.state as string | undefined,
                timestamp: parsed.timestamp as string | undefined,
                raw,
                receivedAt: new Date(),
              };
              setEvents((prev) => [...prev.slice(-199), ev]); // cap at 200
            }
          }
        }
      }

      setStatus('closed');
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatus('closed');
      } else {
        setStatus('error');
        setErrorMsg((err as Error).message ?? 'Stream error');
      }
    }
  }, [agentId, disconnect]);

  // Auto-connect when tab mounts
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  const statusDot: Record<LiveOutputConnectionStatus, string> = {
    idle: 'bg-[var(--color-text-muted)]',
    connecting: 'bg-yellow-400 animate-pulse',
    connected: 'bg-emerald-400 animate-pulse',
    error: 'bg-red-400',
    closed: 'bg-[var(--color-text-muted)]',
  };

  const statusLabel: Record<LiveOutputConnectionStatus, string> = {
    idle: 'Not connected',
    connecting: 'Connecting…',
    connected: 'Live',
    error: 'Error',
    closed: 'Disconnected',
  };

  const stateColors: Record<string, string> = {
    running: 'text-emerald-400',
    busy: 'text-blue-400',
    idle: 'text-[var(--color-text-secondary)]',
    stopped: 'text-[var(--color-text-muted)]',
    booting: 'text-yellow-400',
    credential_wait: 'text-orange-400',
    ready: 'text-emerald-400',
  };

  return (
    <div className="space-y-4" data-testid="live-output-tab">
      {/* Header bar */}
      <div className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            data-testid="live-output-status-dot"
            className={`inline-block w-2 h-2 rounded-full ${statusDot[status]}`}
          />
          <span className="text-xs text-[var(--color-text-secondary)]" data-testid="live-output-status-label">
            {statusLabel[status]}
          </span>
          {events.length > 0 && (
            <span className="text-[10px] text-[var(--color-text-muted)] ml-1">
              ({events.length} event{events.length !== 1 ? 's' : ''})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {events.length > 0 && (
            <button
              onClick={() => setEvents([])}
              data-testid="live-output-clear-btn"
              className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            >
              Clear
            </button>
          )}
          {status === 'connected' ? (
            <button
              onClick={() => { disconnect(); setStatus('closed'); }}
              data-testid="live-output-disconnect-btn"
              className="text-xs px-2.5 py-1 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] transition-colors"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={connect}
              data-testid="live-output-connect-btn"
              className="text-xs px-2.5 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-colors"
            >
              {status === 'connecting' ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {/* Error display */}
      {status === 'error' && errorMsg && (
        <div
          data-testid="live-output-error"
          className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-400"
        >
          {errorMsg}
        </div>
      )}

      {/* Event stream */}
      <div
        data-testid="live-output-events"
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] font-mono-data text-xs overflow-y-auto"
        style={{ minHeight: '12rem', maxHeight: '24rem' }}
        role="log"
        aria-label="Agent lifecycle event log"
        aria-live="polite"
      >
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--color-text-muted)]">
            {status === 'connected' ? (
              <>
                <p className="text-sm" data-testid="live-output-waiting">Waiting for events…</p>
                <p className="text-[10px] mt-1">Lifecycle state changes will appear here in real time.</p>
              </>
            ) : (
              <>
                <p className="text-sm" data-testid="live-output-empty">No events yet.</p>
                <p className="text-[10px] mt-1">
                  {status === 'error' ? 'Connect failed — check backend is running.' : 'Connect to start listening.'}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {events.map((ev) => (
              <div
                key={ev.id}
                data-testid="live-output-event-row"
                className="flex items-start gap-3 px-4 py-2.5 hover:bg-[var(--color-surface)] transition-colors"
              >
                <span className="text-[var(--color-text-muted)] flex-shrink-0 w-20 text-right">
                  {ev.receivedAt.toLocaleTimeString()}
                </span>
                <span className={`flex-shrink-0 w-24 ${stateColors[ev.state ?? ''] ?? 'text-[var(--color-text-secondary)]'}`}>
                  {ev.state ?? '—'}
                </span>
                <span className="text-[var(--color-text-dim)] truncate flex-1">
                  {ev.raw}
                </span>
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// Priority options
const PRIORITIES = ['normal', 'high', 'low'] as const;
type Priority = (typeof PRIORITIES)[number];

interface ActionsTabProps {
  agent: Agent;
  trafficLog: TrafficEntry[];
  addTrafficEntry: (entry: TrafficEntry) => void;
}

function ActionsTab({ agent, trafficLog, addTrafficEntry }: ActionsTabProps) {
  const [capability, setCapability] = useState(agent.capabilities[0] ?? '');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [capError, setCapError] = useState<string | null>(null);
  const [msgError, setMsgError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [lastTaskId, setLastTaskId] = useState<string | null>(null);
  const [dispatchStatus, setDispatchStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [dispatchMessage, setDispatchMessage] = useState<string | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    };
  }, []);

  async function handleDispatch() {
    if (dispatching) return;

    const capTrimmed = capability.trim();
    const msgTrimmed = message.trim();

    const capV = validateCapability(capTrimmed);
    const msgV = validateMessage(msgTrimmed);

    setCapError(capV.valid ? null : (capV.error ?? 'Invalid'));
    setMsgError(msgV.valid ? null : (msgV.error ?? 'Invalid'));

    if (!capV.valid || !msgV.valid) return;

    setDispatching(true);
    setDispatchStatus('idle');
    setDispatchMessage(null);

    const res = await dispatchTask(capTrimmed, msgTrimmed, agent.agent_id);

    const entry: TrafficEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      agent_id: agent.agent_id,
      action: 'dispatch_task',
      capability: capTrimmed,
      status: res.ok ? 'allowed' : 'denied',
      policy_rule: res.ok ? undefined : (res.error ?? `HTTP ${res.status}`),
      task_id: res.ok && res.data ? (res.data as { task_id?: string }).task_id : undefined,
    };
    addTrafficEntry(entry);

    if (res.ok && res.data) {
      const taskId = (res.data as { task_id?: string }).task_id ?? 'unknown';
      setLastTaskId(taskId);
      setDispatchStatus('success');
      setDispatchMessage(`Task accepted — ID: ${taskId}`);
      setMessage('');
    } else {
      setDispatchStatus('error');
      setDispatchMessage(res.error ?? `HTTP ${res.status}`);
    }

    setDispatching(false);

    // Auto-clear status after 5 s
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = setTimeout(() => {
      setDispatchStatus('idle');
      setDispatchMessage(null);
    }, 5000);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleDispatch();
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Dispatch Form ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-4">
          Dispatch Task to {agent.agent_id}
        </p>

        <div className="space-y-3">
          {/* Capability */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1">
              Capability
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={capability}
                data-testid="dispatch-capability"
                onChange={(e) => {
                  setCapability(e.target.value);
                  const r = validateCapability(e.target.value);
                  setCapError(e.target.value.trim() ? (r.valid ? null : (r.error ?? null)) : null);
                }}
                onKeyDown={handleKeyDown}
                list="agent-caps-list"
                placeholder="e.g. summarise"
                disabled={dispatching}
                className="
                  flex-1 px-3 py-2 rounded-lg text-sm font-mono-data
                  bg-[var(--color-bg)] border border-[var(--color-border)]
                  text-[var(--color-text)] placeholder-[var(--color-text-muted)]
                  focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20
                  disabled:opacity-50 transition-colors
                "
              />
              <datalist id="agent-caps-list">
                {agent.capabilities.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {/* Capability chip shortcuts */}
              <div className="flex gap-1 flex-wrap">
                {agent.capabilities.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { setCapability(c); setCapError(null); }}
                    className="text-[10px] font-mono-data px-2 py-1 rounded-md bg-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-border-strong)] transition-colors border border-[var(--color-border-strong)]"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            {capError && <p className="text-[10px] text-red-400 mt-0.5">{capError}</p>}
          </div>

          {/* Priority */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1">
              Priority
            </label>
            <select
              value={priority}
              data-testid="dispatch-priority"
              onChange={(e) => setPriority(e.target.value as Priority)}
              disabled={dispatching}
              className="
                px-3 py-2 rounded-lg text-sm
                bg-[var(--color-bg)] border border-[var(--color-border)]
                text-[var(--color-text)]
                focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20
                disabled:opacity-50 transition-colors
              "
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* Message */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1">
              Instructions
            </label>
            <textarea
              value={message}
              data-testid="dispatch-message"
              onChange={(e) => {
                setMessage(e.target.value);
                const r = validateMessage(e.target.value);
                setMsgError(e.target.value.trim() ? (r.valid ? null : (r.error ?? null)) : null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Task instructions… (Ctrl+Enter to dispatch)"
              disabled={dispatching}
              rows={3}
              className="
                w-full px-3 py-2 rounded-lg text-sm resize-none
                bg-[var(--color-bg)] border border-[var(--color-border)]
                text-[var(--color-text)] placeholder-[var(--color-text-muted)]
                focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20
                disabled:opacity-50 transition-colors
              "
            />
            {msgError && <p className="text-[10px] text-red-400 mt-0.5">{msgError}</p>}
          </div>

          {/* Dispatch button + status */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleDispatch}
              data-testid="dispatch-submit"
              disabled={dispatching || !capability.trim() || !message.trim() || !!capError || !!msgError}
              className="
                px-4 py-2 rounded-lg text-sm font-semibold
                bg-emerald-500 text-white
                hover:bg-emerald-400 active:bg-emerald-600
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/40
              "
            >
              {dispatching ? (
                <span className="flex items-center gap-1.5">
                  <span className="animate-pulse">⟳</span> Dispatching…
                </span>
              ) : (
                'Dispatch Task'
              )}
            </button>

            {dispatchStatus === 'success' && dispatchMessage && (
              <p data-testid="dispatch-success" className="text-xs text-emerald-400 font-mono-data">
                ✓ {dispatchMessage}
              </p>
            )}
            {dispatchStatus === 'error' && dispatchMessage && (
              <p data-testid="dispatch-error" className="text-xs text-red-400">
                ✗ Dispatch failed: {dispatchMessage}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Dispatch History ───────────────────────────────────────── */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-3">
          Dispatch History
          {trafficLog.length > 0 && (
            <span className="ml-2 text-[var(--color-text-dim)]">({trafficLog.length} entries)</span>
          )}
        </p>

        {trafficLog.length === 0 ? (
          <p data-testid="dispatch-history-empty" className="text-xs text-[var(--color-text-dim)] py-3">
            No dispatch history for this agent yet. Send a task above to get started.
          </p>
        ) : (
          <div className="space-y-2" data-testid="dispatch-history-list">
            {trafficLog.slice(0, 20).map((entry) => (
              <DispatchHistoryRow key={entry.id} entry={entry} currentTaskId={lastTaskId} />
            ))}
            {trafficLog.length > 20 && (
              <p className="text-[10px] text-[var(--color-text-muted)] text-center pt-1">
                + {trafficLog.length - 20} more entries in Traffic Log
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DispatchHistoryRow({
  entry,
  currentTaskId,
}: {
  entry: TrafficEntry;
  currentTaskId: string | null;
}) {
  const isNew = currentTaskId !== null && entry.task_id === currentTaskId;
  const statusColors: Record<string, string> = {
    allowed: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    denied: 'text-red-400 bg-red-500/10 border-red-500/20',
    escalated: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    pending: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  };
  const statusClass = statusColors[entry.status] ?? 'text-[var(--color-text-dim)] bg-[var(--color-border)] border-[var(--color-border)]';

  return (
    <div
      className={`flex items-start gap-3 rounded-lg p-2.5 border transition-colors ${
        isNew
          ? 'bg-emerald-500/5 border-emerald-500/20'
          : 'bg-[var(--color-bg)] border-[var(--color-border)]'
      }`}
    >
      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium flex-shrink-0 ${statusClass}`}>
        {entry.status}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {entry.capability && (
            <span className="text-xs font-mono-data text-[var(--color-text-secondary)]">{entry.capability}</span>
          )}
          {entry.task_id && (
            <span className="flex items-center gap-1">
              <span className="text-[10px] font-mono-data text-[var(--color-text-muted)]">{entry.task_id}</span>
              <CopyButton text={entry.task_id} ariaLabel="Copy task ID" testId="copy-task-id-history" />
            </span>
          )}
        </div>
        {entry.policy_rule && (
          <p className="text-[10px] text-red-400 mt-0.5">{entry.policy_rule}</p>
        )}
      </div>
      <span className="text-[10px] font-mono-data text-[var(--color-text-muted)] flex-shrink-0">
        {entry.timestamp.toLocaleTimeString()}
      </span>
    </div>
  );
}

function ConfigTab({ agent }: { agent: Agent }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-2">Agent Configuration</p>
      <pre className="text-xs font-mono-data text-[var(--color-text-secondary)] bg-[var(--color-bg)] rounded-lg p-3 overflow-x-auto border border-[var(--color-border)]">
        {JSON.stringify({
          agent_id: agent.agent_id,
          status: agent.status,
          boundary: agent.boundary,
          capabilities: agent.capabilities,
          registered_at: agent.registered_at,
          metadata: agent.metadata,
        }, null, 2)}
      </pre>
    </div>
  );
}

function InfoCard({ label, value, mono, copyable }: { label: string; value: string; mono?: boolean; copyable?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1">{label}</p>
      <div className="flex items-center gap-1.5">
        <p className={`text-sm text-[var(--color-text)] ${mono ? 'font-mono-data' : ''} break-all flex-1`}>{value}</p>
        {copyable && (
          <CopyButton
            text={value}
            ariaLabel={`Copy ${label}`}
            testId={`copy-info-${label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`}
          />
        )}
      </div>
    </div>
  );
}
