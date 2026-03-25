import { useState, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePolling } from '../hooks/usePolling';
import { useSearch } from '../hooks/useSearch';
import { useSort } from '../hooks/useSort';
import { usePagination } from '../hooks/usePagination';
import { useQueryParams } from '../hooks/useQueryParams';
import { useSelection } from '../hooks/useSelection';
import { useTableKeyboardNav } from '../hooks/useTableKeyboardNav';
import { useFavorites } from '../hooks/useFavorites';
import type { Agent } from '../types';
import { getAgents, deregisterAgent } from '../api';
import { useToast } from '../context/ToastContext';
import StatusBadge from './StatusBadge';
import ConfirmDialog from './ConfirmDialog';
import SearchInput from './SearchInput';
import Pagination from './Pagination';
import { SkeletonTable } from './SkeletonLoader';
import EmptyState from './EmptyState';
import ExportMenu from './ExportMenu';
import SelectionBar from './SelectionBar';
import { exportAsJSON } from '../utils/export';
import CapabilityMatrix from './CapabilityMatrix';
import CopyButton from './CopyButton';
import AgentRegisterModal from './AgentRegisterModal';

// Stable comparators defined at module level so their references don't change between renders
const sortComparators = {
  agent_id: (a: Agent, b: Agent) => a.agent_id.localeCompare(b.agent_id),
  status: (a: Agent, b: Agent) => a.status.localeCompare(b.status),
  boundary: (a: Agent, b: Agent) => a.boundary.localeCompare(b.boundary),
};

type AgentSortKey = keyof typeof sortComparators;

// URL param defaults for AgentsPanel
const AGENTS_PARAM_DEFAULTS = {
  search: '',
  sort: '',
  dir: '',
  page: '1',
};

export default function AgentsPanel() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deregistering, setDeregistering] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  // Bulk selection
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkActionInProgress, setBulkActionInProgress] = useState(false);
  const { selectedIds, selectedCount, toggleOne, toggleAll, clearSelection, isSelected } = useSelection();
  // Favorites
  const { favoritesSet, isFavorite, toggle: toggleFavorite } = useFavorites();

  // URL query params — search, sort key/direction, page
  const [qp, setQp] = useQueryParams(AGENTS_PARAM_DEFAULTS);

  // Keyboard navigation for the agents table
  const agentsTableId = 'agents-table';

  // Derive initial sort config from URL params
  const validSortKeys = Object.keys(sortComparators) as AgentSortKey[];
  const urlSortKey = validSortKeys.includes(qp.sort as AgentSortKey) ? (qp.sort as AgentSortKey) : null;
  const urlSortDir = qp.dir === 'desc' ? 'desc' as const : (qp.dir === 'asc' ? 'asc' as const : null);
  const initialSortConfig =
    urlSortKey && urlSortDir ? { key: urlSortKey, direction: urlSortDir } : null;

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

  // Derived: which visible (paginated page) agent IDs are available for toggleAll
  // We compute allSelected from the full sortedItems list (not just current page)
  // so the header checkbox reflects the total filtered result set.
  // (will be referenced after pagination is defined — hoisted into JSX below)

  const { refresh } = usePolling(load, { interval: 10_000, immediate: true, pauseOnHidden: true, maxBackoff: 4 });

  // Search — useSearch internally uses useMemo, so searchedAgents only recomputes when
  // agents array or query changes (not on every parent render).
  // initialQuery seeds state from URL on mount; URL-driven page shares/refreshes restore the filter.
  const { query, setQuery, filteredItems: searchedAgents } = useSearch(agents, {
    fields: [
      (a) => a.agent_id,
      (a) => a.capabilities.join(' '),
      (a) => a.status,
      (a) => a.boundary,
    ],
    initialQuery: qp.search,
  });

  // When search changes, update URL (replaceState to avoid polluting history on every keystroke)
  function handleSearchChange(q: string) {
    setQuery(q);
    setQp({ search: q, page: '1' }, false);
  }

  // Sort — useSort internally uses useMemo, sortedItems only recomputes when
  // searchedAgents or sortConfig changes.
  // initialSortConfig restores sort from URL on mount.
  const { sortedItems, sortConfig, requestSort, getSortIndicator } = useSort(
    searchedAgents,
    sortComparators,
    initialSortConfig,
  );

  // When sort changes, update URL
  function handleRequestSort(key: AgentSortKey) {
    requestSort(key);
    // Compute next sort state (mirrors useSort toggle logic)
    let newKey = key;
    let newDir: 'asc' | 'desc' | '' = 'asc';
    if (sortConfig?.key === key) {
      if (sortConfig.direction === 'asc') {
        newDir = 'desc';
      } else {
        // Clear sort
        newKey = '' as AgentSortKey;
        newDir = '';
      }
    }
    setQp({ sort: newKey, dir: newDir, page: '1' }, false);
  }

  // Lift favorites to top — stable sort: favorited agents come first, then the rest
  // retains the existing sort order within each group.
  const sortedWithFavorites = sortedItems.slice().sort((a, b) => {
    const aFav = favoritesSet.has(a.agent_id) ? 0 : 1;
    const bFav = favoritesSet.has(b.agent_id) ? 0 : 1;
    return aFav - bFav;
  });

  // Paginate — usePagination internally uses useMemo for paginatedItems slice.
  const initialPage = Math.max(1, parseInt(qp.page, 10) || 1);
  const pagination = usePagination(sortedWithFavorites, { initialPageSize: 10, initialPage });

  // Wrap pagination actions to also update URL
  function handleNextPage() {
    pagination.nextPage();
    setQp({ page: String(pagination.page + 1) }, false);
  }
  function handlePrevPage() {
    pagination.prevPage();
    setQp({ page: String(Math.max(1, pagination.page - 1)) }, false);
  }
  function handlePageSizeChange(size: number) {
    pagination.setPageSize(size);
    setQp({ page: '1' }, false);
  }

  // Keyboard navigation — scoped to the currently visible (paginated) rows
  const { focusedIndex, handleKeyDown: handleTableKeyDown, getRowProps } = useTableKeyboardNav({
    rowCount: pagination.paginatedItems.length,
    onEnter: useCallback((idx: number) => {
      const agent = pagination.paginatedItems[idx];
      if (agent) setExpandedId((prev) => (prev === agent.agent_id ? null : agent.agent_id));
    }, [pagination.paginatedItems]),
    onSpace: useCallback((idx: number) => {
      const agent = pagination.paginatedItems[idx];
      if (agent) toggleOne(agent.agent_id);
    }, [pagination.paginatedItems, toggleOne]),
  });

  function requestDeregister(agentId: string) {
    setConfirmTarget(agentId);
  }

  async function handleDeregister() {
    if (!confirmTarget) return;
    const targetId = confirmTarget;
    setConfirmTarget(null);
    setDeregistering(targetId);
    const res = await deregisterAgent(targetId);
    setDeregistering(null);
    if (res.ok) {
      addToast(`Agent deregistered — ${targetId}`, 'success');
    } else {
      addToast('Deregister failed', 'error');
    }
    await load();
  }

  async function handleBulkDeregister() {
    setBulkConfirmOpen(false);
    setBulkActionInProgress(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.all(ids.map((id) => deregisterAgent(id)));
    const failCount = results.filter((r) => !r.ok).length;
    clearSelection();
    setBulkActionInProgress(false);
    if (failCount === 0) {
      addToast(`${ids.length} agent${ids.length === 1 ? '' : 's'} deregistered`, 'success');
    } else {
      addToast('Deregister failed', 'error');
    }
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
            onClick={() => setRegisterModalOpen(true)}
            data-testid="open-register-agent-btn"
            className="px-3 py-1.5 text-xs rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          >
            + Register Agent
          </button>
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
          onChange={handleSearchChange}
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
          {/* Compute allSelected and someSelected from the full filtered list */}
          {(() => {
            const allIds = sortedWithFavorites.map((a) => a.agent_id);
            const allSelected = allIds.length > 0 && allIds.every((id) => isSelected(id));
            const someSelected = selectedCount > 0 && !allSelected;

            // Determine the index of the first non-favorite item on this page
            // (for rendering the "— Pinned / Unpinned —" separator)
            const firstUnpinnedIdx = pagination.paginatedItems.findIndex(
              (a) => !isFavorite(a.agent_id),
            );
            const hasPinnedOnPage = firstUnpinnedIdx > 0;
            const hasUnpinnedOnPage =
              firstUnpinnedIdx !== -1 && firstUnpinnedIdx < pagination.paginatedItems.length;

            return (
              <div
                id={agentsTableId}
                className="rounded-xl border border-[var(--color-border)] overflow-hidden outline-none"
                role="grid"
                aria-label="Registered agents"
                aria-activedescendant={focusedIndex >= 0 ? `${agentsTableId}-row-${focusedIndex}` : undefined}
                tabIndex={0}
                onKeyDown={handleTableKeyDown}
                data-testid="agents-table"
              >
                {/* Table header */}
                <div className="grid grid-cols-[auto_auto_2fr_3fr_1fr_1fr_auto] gap-4 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-dark)]" role="row">
                  {/* Select-all checkbox */}
                  <span role="columnheader" className="flex items-center">
                    <input
                      type="checkbox"
                      aria-label="Select all agents"
                      data-testid="agents-select-all"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected; }}
                      onChange={() => toggleAll(allIds)}
                      className="h-3.5 w-3.5 rounded border-[var(--color-border)] accent-emerald-500 cursor-pointer"
                    />
                  </span>
                  {/* Star column header */}
                  <span role="columnheader" className="w-5" aria-label="Favorite" />
                  {[
                    { label: 'Agent ID', sortKey: 'agent_id' as AgentSortKey },
                    { label: 'Capabilities', sortKey: null },
                    { label: 'Status', sortKey: 'status' as AgentSortKey },
                    { label: 'Boundary', sortKey: 'boundary' as AgentSortKey },
                    { label: '', sortKey: null },
                  ].map(({ label, sortKey }) => (
                    <span
                      key={label || 'actions'}
                      className={`text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)] ${sortKey ? 'cursor-pointer hover:text-[var(--color-text-dim)] select-none' : ''}`}
                      onClick={sortKey ? () => handleRequestSort(sortKey) : undefined}
                      role="columnheader"
                    >
                      {label}{sortKey ? getSortIndicator(sortKey) : ''}
                    </span>
                  ))}
                </div>

                {/* Pinned section label — only shown when at least one pinned row is on this page */}
                {hasPinnedOnPage && (
                  <div
                    className="px-4 py-1 bg-amber-500/5 border-b border-amber-500/15 flex items-center gap-2"
                    data-testid="pinned-section-label"
                  >
                    <span className="text-amber-400 text-[10px]">★</span>
                    <span className="text-[10px] uppercase tracking-widest font-semibold text-amber-500/70">
                      Pinned
                    </span>
                  </div>
                )}

                {/* Rows */}
                {pagination.paginatedItems.map((agent, idx) => {
                  const showUnpinnedSeparator =
                    hasPinnedOnPage && hasUnpinnedOnPage && idx === firstUnpinnedIdx;
                  return (
                    <div key={agent.agent_id}>
                      {showUnpinnedSeparator && (
                        <div
                          className="px-4 py-1 bg-[var(--color-surface-dark)] border-t border-b border-[var(--color-border)] flex items-center gap-2"
                          data-testid="unpinned-section-label"
                        >
                          <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)]">
                            All Agents
                          </span>
                        </div>
                      )}
                      <AgentRow
                        agent={agent}
                        isLast={idx === pagination.paginatedItems.length - 1}
                        expanded={expandedId === agent.agent_id}
                        selected={isSelected(agent.agent_id)}
                        focused={focusedIndex === idx}
                        favorited={isFavorite(agent.agent_id)}
                        rowProps={getRowProps(idx, agentsTableId)}
                        onSelect={() => toggleOne(agent.agent_id)}
                        onToggle={() =>
                          setExpandedId((prev) => (prev === agent.agent_id ? null : agent.agent_id))
                        }
                        onDeregister={() => requestDeregister(agent.agent_id)}
                        onNavigateToDetail={() => navigate(`/agents/${agent.agent_id}`)}
                        onToggleFavorite={() => toggleFavorite(agent.agent_id)}
                        deregistering={deregistering === agent.agent_id}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })()}

          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            totalItems={sortedWithFavorites.length}
            startIndex={pagination.startIndex}
            endIndex={pagination.endIndex}
            hasNext={pagination.hasNext}
            hasPrev={pagination.hasPrev}
            onNextPage={handleNextPage}
            onPrevPage={handlePrevPage}
            onPageSizeChange={handlePageSizeChange}
          />

          {/* Bulk selection bar */}
          <SelectionBar
            testId="agents-selection-bar"
            selectedCount={selectedCount}
            itemNoun="agent"
            onClear={clearSelection}
            actions={[
              {
                label: 'Deregister Selected',
                variant: 'danger',
                disabled: bulkActionInProgress,
                testId: 'agents-bulk-deregister',
                onClick: () => setBulkConfirmOpen(true),
              },
            ]}
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

      <ConfirmDialog
        open={bulkConfirmOpen}
        title="Deregister Selected Agents"
        message={`Deregister ${selectedCount} agent${selectedCount === 1 ? '' : 's'}? This cannot be undone.`}
        confirmLabel={`Deregister ${selectedCount}`}
        variant="danger"
        onConfirm={handleBulkDeregister}
        onCancel={() => setBulkConfirmOpen(false)}
      />

      <AgentRegisterModal
        open={registerModalOpen}
        onClose={() => setRegisterModalOpen(false)}
        onRegistered={() => {
          // Refresh agent list in background; modal stays open to show success state
          void load();
        }}
      />
    </div>
  );
}

// ── Row component ────────────────────────────────────────────────────

interface AgentRowProps {
  agent: Agent;
  isLast: boolean;
  expanded: boolean;
  selected: boolean;
  focused: boolean;
  favorited: boolean;
  rowProps: {
    id: string;
    tabIndex: number;
    'aria-rowindex': number;
    'data-nav-index': number;
    onFocus: () => void;
  };
  onSelect: () => void;
  onToggle: () => void;
  onDeregister: () => void;
  onNavigateToDetail: () => void;
  onToggleFavorite: () => void;
  deregistering: boolean;
}

// Wrapped in React.memo — AgentsPanel re-renders on every 10s poll tick (setLoading, setAgents).
// Each AgentRow will skip re-render when its own props haven't changed.
// Note: onToggle/onDeregister/onNavigateToDetail are new arrow functions on every parent render;
// for full stability these would need useCallback in the parent. The memo still helps for
// rows that are not in the "active" slot (e.g., expanded row changes, others stay stable).
const AgentRow = memo(function AgentRow({ agent, isLast, expanded, selected, focused, favorited, rowProps, onSelect, onToggle, onDeregister, onNavigateToDetail, onToggleFavorite, deregistering }: AgentRowProps) {
  return (
    <div className={`${!isLast ? 'border-b border-[var(--color-border)]' : ''} ${selected ? 'bg-emerald-500/5' : ''}`}>
      {/* Main row */}
      <div
        {...rowProps}
        className={`grid grid-cols-[auto_auto_2fr_3fr_1fr_1fr_auto] gap-4 px-4 py-3 items-center bg-transparent hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors outline-none ${focused ? 'ring-2 ring-inset ring-emerald-500/60' : ''}`}
        onClick={onToggle}
        role="row"
      >
        {/* Row checkbox */}
        <div onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Select agent ${agent.agent_id}`}
            data-testid={`agent-checkbox-${agent.agent_id}`}
            checked={selected}
            onChange={onSelect}
            className="h-3.5 w-3.5 rounded border-[var(--color-border)] accent-emerald-500 cursor-pointer"
          />
        </div>

        {/* Favorite star toggle */}
        <div onClick={(e) => e.stopPropagation()}>
          <button
            aria-label={favorited ? `Unpin agent ${agent.agent_id}` : `Pin agent ${agent.agent_id}`}
            data-testid={`agent-favorite-${agent.agent_id}`}
            onClick={onToggleFavorite}
            className={`w-5 h-5 flex items-center justify-center rounded transition-colors hover:text-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/40 ${favorited ? 'text-amber-400' : 'text-[var(--color-text-muted)] hover:text-amber-300'}`}
          >
            {favorited ? '★' : '☆'}
          </button>
        </div>

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
            <DetailField label="agent_id" value={agent.agent_id} mono copyable />
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

function DetailField({ label, value, mono, copyable }: { label: string; value: string; mono?: boolean; copyable?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-0.5">{label}</p>
      <div className="flex items-center gap-1.5">
        <p className={`text-[var(--color-text-secondary)] ${mono ? 'font-mono-data' : ''} break-all`}>{value}</p>
        {copyable && (
          <CopyButton
            text={value}
            ariaLabel={`Copy ${label}`}
            testId={`copy-${label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`}
          />
        )}
      </div>
    </div>
  );
}
