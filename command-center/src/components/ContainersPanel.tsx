import { useState, useCallback, useMemo, memo } from 'react';
import type { Kubex } from '../types';
import { getKubexes, killKubex, startKubex } from '../api';
import StatusBadge from './StatusBadge';
import { usePolling } from '../hooks/usePolling';
import { useSearch } from '../hooks/useSearch';
import { useSort } from '../hooks/useSort';
import { usePagination } from '../hooks/usePagination';
import ConfirmDialog from './ConfirmDialog';
import SearchInput from './SearchInput';
import Pagination from './Pagination';
import { SkeletonTable } from './SkeletonLoader';
import EmptyState from './EmptyState';
import ExportMenu from './ExportMenu';
import { exportAsJSON } from '../utils/export';
import CopyButton from './CopyButton';

// Status filter options
type StatusFilter = 'all' | 'running' | 'created' | 'stopped' | 'error';

// Stable comparators defined at module level so their references don't change between renders
const sortComparators = {
  kubex_id: (a: Kubex, b: Kubex) => a.kubex_id.localeCompare(b.kubex_id),
  agent_id: (a: Kubex, b: Kubex) => (a.agent_id ?? '').localeCompare(b.agent_id ?? ''),
  status: (a: Kubex, b: Kubex) => a.status.localeCompare(b.status),
};

export default function ContainersPanel() {
  const [kubexes, setKubexes] = useState<Kubex[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionIn, setActionIn] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ kubexId: string; action: 'kill' } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getKubexes();
    if (res.ok && Array.isArray(res.data)) {
      setKubexes(res.data);
    } else {
      setError(res.error ?? `HTTP ${res.status}`);
    }
    setLoading(false);
  }, []);

  const { refresh } = usePolling(load, { interval: 10_000, immediate: true, pauseOnHidden: true, maxBackoff: 4 });

  // Status pre-filter — applied before search and sort
  const statusFiltered = useMemo(() => {
    if (statusFilter === 'all') return kubexes;
    return kubexes.filter((k) => k.status === statusFilter);
  }, [kubexes, statusFilter]);

  // Search — useSearch internally uses useMemo
  const { query, setQuery, filteredItems: searchedKubexes } = useSearch(statusFiltered, {
    fields: [
      (k) => k.kubex_id,
      (k) => k.agent_id ?? '',
      (k) => k.image ?? '',
      (k) => k.status,
    ],
  });

  // Sort — useSort internally uses useMemo
  const { sortedItems, requestSort, getSortIndicator } = useSort(searchedKubexes, sortComparators);

  // Paginate — usePagination internally uses useMemo for paginatedItems slice
  const pagination = usePagination(sortedItems, { initialPageSize: 10 });

  function requestKill(kubexId: string) {
    setConfirmTarget({ kubexId, action: 'kill' });
  }

  async function handleConfirmedKill() {
    if (!confirmTarget) return;
    const { kubexId } = confirmTarget;
    setConfirmTarget(null);
    setActionIn(kubexId);
    await killKubex(kubexId);
    setActionIn(null);
    await load();
  }

  async function handleStart(kubexId: string) {
    setActionIn(kubexId);
    await startKubex(kubexId);
    setActionIn(null);
    await load();
  }

  const running = kubexes.filter((k) => k.status === 'running').length;
  const stopped = kubexes.filter((k) => k.status === 'stopped' || k.status === 'error').length;

  // Subtitle reflects filtering state
  const subtitle = loading
    ? 'Loading…'
    : query || statusFilter !== 'all'
    ? `${sortedItems.length} of ${kubexes.length} kubexes`
    : `${running} running, ${stopped} stopped`;

  return (
    <div className="p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Docker Containers (Kubexes)</h2>
          <p className="text-xs text-[var(--color-text-dim)]">
            Managed by Kubex Manager — {subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            testId="containers-export-menu"
            disabled={kubexes.length === 0}
            onExportJSON={() => {
              exportAsJSON(kubexes, `kubexes-${new Date().toISOString().slice(0, 10)}`);
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

      {/* Search + filter bar */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex-1">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search kubexes by ID, agent, image, status…"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="Filter by status"
          className="px-3 py-2 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-dark)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 focus:ring-offset-[var(--color-bg)] transition-colors"
        >
          <option value="all">All statuses</option>
          <option value="running">Running</option>
          <option value="created">Created</option>
          <option value="stopped">Stopped</option>
          <option value="error">Error</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Manager unreachable: {error}
          <span className="block text-xs mt-0.5 text-red-400/70">
            Ensure the KUBEX_MGMT_TOKEN is set correctly.
          </span>
        </div>
      )}

      {loading && kubexes.length === 0 ? (
        <SkeletonTable rows={3} cols={5} />
      ) : kubexes.length === 0 ? (
        <EmptyState
          icon="⬡"
          title="No kubexes found"
          description="Kubexes appear here when spawned via Manager."
        />
      ) : sortedItems.length === 0 ? (
        <EmptyState
          icon="⬡"
          title="No matching kubexes"
          description={query ? `No kubexes match "${query}"` : `No kubexes with status "${statusFilter}"`}
        />
      ) : (
        <>
          <div className="rounded-xl border border-[var(--color-border)] overflow-hidden" role="table">
            {/* Table header */}
            <div
              className="grid grid-cols-[2fr_2fr_1fr_2fr_auto] gap-4 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-dark)]"
              role="row"
            >
              {[
                { label: 'Kubex ID', sortKey: 'kubex_id' as const },
                { label: 'Agent', sortKey: 'agent_id' as const },
                { label: 'Status', sortKey: 'status' as const },
                { label: 'Image', sortKey: null },
                { label: 'Actions', sortKey: null },
              ].map(({ label, sortKey }) => (
                <span
                  key={label}
                  className={`text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)] ${sortKey ? 'cursor-pointer hover:text-[var(--color-text-dim)] select-none' : ''}`}
                  onClick={sortKey ? () => requestSort(sortKey) : undefined}
                  role="columnheader"
                >
                  {label}{sortKey ? getSortIndicator(sortKey) : ''}
                </span>
              ))}
            </div>

            {pagination.paginatedItems.map((kubex, idx) => (
              <KubexRow
                key={kubex.kubex_id}
                kubex={kubex}
                isLast={idx === pagination.paginatedItems.length - 1}
                actionIn={actionIn === kubex.kubex_id}
                onKill={() => requestKill(kubex.kubex_id)}
                onStart={() => handleStart(kubex.kubex_id)}
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

      <ConfirmDialog
        open={confirmTarget !== null}
        title="Kill Kubex"
        message={`Are you sure you want to kill kubex "${confirmTarget?.kubexId}"?`}
        confirmLabel="Kill"
        variant="danger"
        onConfirm={handleConfirmedKill}
        onCancel={() => setConfirmTarget(null)}
      />

      {/* Summary footer */}
      {kubexes.length > 0 && (
        <div className="mt-4 flex items-center gap-4 text-xs text-[var(--color-text-dim)]">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {running} running
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            {kubexes.filter((k) => k.status === 'created').length} created
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
            {stopped} stopped/error
          </span>
          <span className="ml-auto font-mono-data">{kubexes.length} total</span>
        </div>
      )}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────

interface KubexRowProps {
  kubex: Kubex;
  isLast: boolean;
  actionIn: boolean;
  onKill: () => void;
  onStart: () => void;
}

// Wrapped in React.memo — ContainersPanel re-renders on every 10s poll tick.
// KubexRow skips re-render when its own props haven't changed.
const KubexRow = memo(function KubexRow({ kubex, isLast, actionIn, onKill, onStart }: KubexRowProps) {
  const isRunning = kubex.status === 'running';

  return (
    <div
      className={`
        grid grid-cols-[2fr_2fr_1fr_2fr_auto] gap-4 px-4 py-3 items-center
        bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors
        ${!isLast ? 'border-b border-[var(--color-border)]' : ''}
      `}
      role="row"
    >
      {/* Kubex ID */}
      <span className="flex items-center gap-1.5 min-w-0" role="cell">
        <span className="font-mono-data text-sm text-[var(--color-text)] truncate" title={kubex.kubex_id}>
          {kubex.kubex_id}
        </span>
        <CopyButton text={kubex.kubex_id} ariaLabel="Copy kubex ID" testId="copy-kubex-id" />
      </span>

      {/* Agent ID */}
      <span className="font-mono-data text-sm text-[var(--color-text-secondary)] truncate" title={kubex.agent_id ?? '—'} role="cell">
        {kubex.agent_id ?? <span className="text-[var(--color-text-muted)]">—</span>}
      </span>

      {/* Status */}
      <span role="cell">
        <StatusBadge status={kubex.status} />
      </span>

      {/* Image */}
      <span className="font-mono-data text-xs text-[var(--color-text-dim)] truncate" title={kubex.image ?? '—'} role="cell">
        {kubex.image ?? '—'}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-2" role="cell">
        {isRunning ? (
          <button
            onClick={onKill}
            disabled={actionIn}
            className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            {actionIn ? '…' : 'Kill'}
          </button>
        ) : (
          <button
            onClick={onStart}
            disabled={actionIn}
            className="px-2 py-1 text-[10px] rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
          >
            {actionIn ? '…' : 'Start'}
          </button>
        )}
      </div>
    </div>
  );
});
