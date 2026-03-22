import { useState, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePolling } from '../hooks/usePolling';
import { useSearch } from '../hooks/useSearch';
import { useSort } from '../hooks/useSort';
import { usePagination } from '../hooks/usePagination';
import type { Agent } from '../types';
import { getAgents, deregisterAgent } from '../api';
import StatusBadge from './StatusBadge';
import ConfirmDialog from './ConfirmDialog';
import SearchInput from './SearchInput';
import Pagination from './Pagination';
import { SkeletonTable } from './SkeletonLoader';
import EmptyState from './EmptyState';
import ExportMenu from './ExportMenu';
import { exportAsJSON } from '../utils/export';
import CapabilityMatrix from './CapabilityMatrix';

// Stable comparators defined at module level so their references don't change between renders
const sortComparators = {
  agent_id: (a: Agent, b: Agent) => a.agent_id.localeCompare(b.agent_id),
  status: (a: Agent, b: Agent) => a.status.localeCompare(b.status),
  boundary: (a: Agent, b: Agent) => a.boundary.localeCompare(b.boundary),
};

export default function AgentsPanel() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deregistering, setDeregistering] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

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

  // Search — useSearch internally uses useMemo, so searchedAgents only recomputes when
  // agents array or query changes (not on every parent render).
  const { query, setQuery, filteredItems: searchedAgents } = useSearch(agents, {
    fields: [
      (a) => a.agent_id,
      (a) => a.capabilities.join(' '),
      (a) => a.status,
      (a) => a.boundary,
    ],
  });

  // Sort — useSort internally uses useMemo, sortedItems only recomputes when
  // searchedAgents or sortConfig changes.
  const { sortedItems, requestSort, getSortIndicator } = useSort(searchedAgents, sortComparators);

  // Paginate — usePagination internally uses useMemo for paginatedItems slice.
  const pagination = usePagination(sortedItems, { initialPageSize: 10 });

  function requestDeregister(agentId: string) {
    setConfirmTarget(agentId);
  }

  async function handleDeregister() {
    if (!confirmTarget) return;
    setConfirmTarget(null);
    setDeregistering(confirmTarget);
    await deregisterAgent(confirmTarget);
    setDeregistering(null);
    await load();
  }

  return (
    <div className="p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Registered Agents</h2>
          <p className="text-xs text-[var(--color-text-dim)]">
            {loading ? 'Loading…' : query ? `${searchedAgents.length} of ${agents.length} agents` : `${agents.length} agents in registry`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            testId="agents-export-menu"
            disabled={agents.length === 0}
            onExportJSON={() => {
              exportAsJSON(agents, `agents-${new Date().toISOString().slice(0, 10)}`);
            }}
          />
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="mb-4">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search agents by ID, capability, status…"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Registry unreachable: {error}
        </div>
      )}

      {loading && agents.length === 0 ? (
        <SkeletonTable rows={3} cols={5} />
      ) : agents.length === 0 ? (
        <EmptyState
          icon="◎"
          title="No agents registered"
          description="Run docker compose up to start agents."
        />
      ) : (
        <>
          <div className="rounded-xl border border-[var(--color-border)] overflow-hidden" role="table">
            {/* Table header */}
            <div className="grid grid-cols-[2fr_3fr_1fr_1fr_auto] gap-4 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-dark)]" role="row">
              {[
                { label: 'Agent ID', sortKey: 'agent_id' as const },
                { label: 'Capabilities', sortKey: null },
                { label: 'Status', sortKey: 'status' as const },
                { label: 'Boundary', sortKey: 'boundary' as const },
                { label: '', sortKey: null },
              ].map(({ label, sortKey }) => (
                <span
                  key={label || 'actions'}
                  className={`text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)] ${sortKey ? 'cursor-pointer hover:text-[var(--color-text-dim)] select-none' : ''}`}
                  onClick={sortKey ? () => requestSort(sortKey) : undefined}
                  role="columnheader"
                >
                  {label}{sortKey ? getSortIndicator(sortKey) : ''}
                </span>
              ))}
            </div>

            {/* Rows */}
            {pagination.paginatedItems.map((agent, idx) => (
              <AgentRow
                key={agent.agent_id}
                agent={agent}
                isLast={idx === pagination.paginatedItems.length - 1}
                expanded={expandedId === agent.agent_id}
                onToggle={() =>
                  setExpandedId((prev) => (prev === agent.agent_id ? null : agent.agent_id))
                }
                onDeregister={() => requestDeregister(agent.agent_id)}
                onNavigateToDetail={() => navigate(`/agents/${agent.agent_id}`)}
                deregistering={deregistering === agent.agent_id}
              />
            ))}
          </div>

          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            totalItems={sortedItems.length}
            startIndex={pagination.startIndex}
            endIndex={pagination.endIndex}
            hasNext={pagination.hasNext}
            hasPrev={pagination.hasPrev}
            onNextPage={pagination.nextPage}
            onPrevPage={pagination.prevPage}
            onPageSizeChange={pagination.setPageSize}
          />
        </>
      )}

      {/* Capability Matrix — shown when agents are available */}
      {agents.length > 0 && (
        <div className="mt-6">
          <CapabilityMatrix agents={agents} />
        </div>
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        title="Deregister Agent"
        message={`Are you sure you want to deregister agent "${confirmTarget}"?`}
        confirmLabel="Deregister"
        variant="danger"
        onConfirm={handleDeregister}
        onCancel={() => setConfirmTarget(null)}
      />
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
  onNavigateToDetail: () => void;
  deregistering: boolean;
}

// Wrapped in React.memo — AgentsPanel re-renders on every 10s poll tick (setLoading, setAgents).
// Each AgentRow will skip re-render when its own props haven't changed.
// Note: onToggle/onDeregister/onNavigateToDetail are new arrow functions on every parent render;
// for full stability these would need useCallback in the parent. The memo still helps for
// rows that are not in the "active" slot (e.g., expanded row changes, others stay stable).
const AgentRow = memo(function AgentRow({ agent, isLast, expanded, onToggle, onDeregister, onNavigateToDetail, deregistering }: AgentRowProps) {
  return (
    <div className={`${!isLast ? 'border-b border-[var(--color-border)]' : ''}`}>
      {/* Main row */}
      <div
        className="grid grid-cols-[2fr_3fr_1fr_1fr_auto] gap-4 px-4 py-3 items-center bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
        onClick={onToggle}
        role="row"
      >
        {/* Agent ID */}
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
          <span
            className="font-mono-data text-sm text-[var(--color-text)] truncate hover:text-emerald-400 transition-colors"
            onClick={(e) => { e.stopPropagation(); onNavigateToDetail(); }}
            role="link"
            tabIndex={0}
          >
            {agent.agent_id}
          </span>
        </div>

        {/* Capabilities */}
        <div className="flex flex-wrap gap-1 min-w-0">
          {agent.capabilities.map((cap) => (
            <span
              key={cap}
              className="text-[10px] font-mono-data px-1.5 py-0.5 rounded bg-[var(--color-border)] text-[var(--color-text-secondary)] border border-[var(--color-border-strong)]"
            >
              {cap}
            </span>
          ))}
        </div>

        {/* Status */}
        <StatusBadge status={agent.status} />

        {/* Boundary */}
        <span className="text-xs font-mono-data text-[var(--color-text-dim)]">{agent.boundary}</span>

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
        <div className="bg-[var(--color-surface-dark)] border-t border-[var(--color-border)] px-6 py-4">
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
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-2">Metadata</p>
              <pre className="text-xs font-mono-data text-[var(--color-text-secondary)] bg-[var(--color-bg)] rounded-lg p-3 overflow-x-auto border border-[var(--color-border)]">
                {JSON.stringify(agent.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-0.5">{label}</p>
      <p className={`text-[var(--color-text-secondary)] ${mono ? 'font-mono-data' : ''} break-all`}>{value}</p>
    </div>
  );
}
