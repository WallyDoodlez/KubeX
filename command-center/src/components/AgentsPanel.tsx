import { useState, useCallback } from 'react';
import { usePolling } from '../hooks/usePolling';
import type { Agent } from '../types';
import { getAgents, deregisterAgent } from '../api';
import StatusBadge from './StatusBadge';

export default function AgentsPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deregistering, setDeregistering] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getAgents();
    if (res.ok && Array.isArray(res.data)) {
      setAgents(res.data);
    } else {
      setError(res.error ?? `HTTP ${res.status}`);
    }
    setLoading(false);
  }, []);

  const { refresh } = usePolling(load, { interval: 10_000, immediate: true, pauseOnHidden: true, maxBackoff: 4 });

  async function handleDeregister(agentId: string) {
    if (!confirm(`Deregister agent "${agentId}"?`)) return;
    setDeregistering(agentId);
    await deregisterAgent(agentId);
    setDeregistering(null);
    await load();
  }

  return (
    <div className="p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-[#e2e8f0]">Registered Agents</h2>
          <p className="text-xs text-[#64748b]">
            {loading ? 'Loading…' : `${agents.length} agents in registry`}
          </p>
        </div>
        <button
          onClick={refresh}
          className="px-3 py-1.5 text-xs rounded-lg border border-[#2a2f45] text-[#94a3b8] hover:border-[#3a3f5a] hover:text-[#e2e8f0] transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Registry unreachable: {error}
        </div>
      )}

      {loading && agents.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-xl bg-[#1a1d27] border border-[#2a2f45] animate-pulse" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rounded-xl border border-[#2a2f45] overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_3fr_1fr_1fr_auto] gap-4 px-4 py-2.5 border-b border-[#2a2f45] bg-[#12151f]">
            {['Agent ID', 'Capabilities', 'Status', 'Boundary', ''].map((h) => (
              <span key={h} className="text-[10px] uppercase tracking-widest font-semibold text-[#3a3f5a]">
                {h}
              </span>
            ))}
          </div>

          {/* Rows */}
          {agents.map((agent, idx) => (
            <AgentRow
              key={agent.agent_id}
              agent={agent}
              isLast={idx === agents.length - 1}
              expanded={expandedId === agent.agent_id}
              onToggle={() =>
                setExpandedId((prev) => (prev === agent.agent_id ? null : agent.agent_id))
              }
              onDeregister={() => handleDeregister(agent.agent_id)}
              deregistering={deregistering === agent.agent_id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Row component ────────────────────────────────────────────────────

interface AgentRowProps {
  agent: Agent;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDeregister: () => void;
  deregistering: boolean;
}

function AgentRow({ agent, isLast, expanded, onToggle, onDeregister, deregistering }: AgentRowProps) {
  return (
    <div className={`${!isLast ? 'border-b border-[#2a2f45]' : ''}`}>
      {/* Main row */}
      <div
        className="grid grid-cols-[2fr_3fr_1fr_1fr_auto] gap-4 px-4 py-3 items-center bg-[#1a1d27] hover:bg-[#20243a] cursor-pointer transition-colors"
        onClick={onToggle}
      >
        {/* Agent ID */}
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
          <span className="font-mono-data text-sm text-[#e2e8f0] truncate">{agent.agent_id}</span>
        </div>

        {/* Capabilities */}
        <div className="flex flex-wrap gap-1 min-w-0">
          {agent.capabilities.map((cap) => (
            <span
              key={cap}
              className="text-[10px] font-mono-data px-1.5 py-0.5 rounded bg-[#2a2f45] text-[#94a3b8] border border-[#3a3f5a]"
            >
              {cap}
            </span>
          ))}
        </div>

        {/* Status */}
        <StatusBadge status={agent.status} />

        {/* Boundary */}
        <span className="text-xs font-mono-data text-[#64748b]">{agent.boundary}</span>

        {/* Actions */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDeregister();
          }}
          disabled={deregistering}
          className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
        >
          {deregistering ? '…' : 'Deregister'}
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="bg-[#12151f] border-t border-[#2a2f45] px-6 py-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
            <DetailField label="agent_id" value={agent.agent_id} mono />
            <DetailField label="status" value={agent.status} />
            <DetailField label="boundary" value={agent.boundary} />
            <DetailField
              label="capabilities"
              value={agent.capabilities.join(', ') || '—'}
              mono
            />
            {agent.registered_at && (
              <DetailField label="registered_at" value={agent.registered_at} mono />
            )}
          </div>

          {agent.metadata && Object.keys(agent.metadata).length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-widest text-[#3a3f5a] mb-2">Metadata</p>
              <pre className="text-xs font-mono-data text-[#94a3b8] bg-[#0f1117] rounded-lg p-3 overflow-x-auto border border-[#2a2f45]">
                {JSON.stringify(agent.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-[#3a3f5a] mb-0.5">{label}</p>
      <p className={`text-[#94a3b8] ${mono ? 'font-mono-data' : ''} break-all`}>{value}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-[#2a2f45] bg-[#1a1d27] p-12 text-center">
      <p className="text-3xl mb-3">◎</p>
      <p className="text-sm font-medium text-[#94a3b8]">No agents registered</p>
      <p className="text-xs text-[#64748b] mt-1">
        Run <code className="font-mono-data bg-[#2a2f45] px-1 rounded">docker compose up</code> to start agents.
      </p>
    </div>
  );
}
