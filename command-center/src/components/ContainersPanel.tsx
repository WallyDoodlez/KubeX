import { useState, useCallback, useMemo, memo } from 'react';
import type { Kubex } from '../types';
import { getKubexes, killKubex, startKubex, stopKubex, restartKubex, respawnKubex, deleteKubex } from '../api';
import StatusBadge from './StatusBadge';
import { usePolling } from '../hooks/usePolling';
import { useSearch } from '../hooks/useSearch';
import { useSort } from '../hooks/useSort';
import { usePagination } from '../hooks/usePagination';
import { useQueryParams } from '../hooks/useQueryParams';
import { useSelection } from '../hooks/useSelection';
import { useTableKeyboardNav } from '../hooks/useTableKeyboardNav';
import ConfirmDialog from './ConfirmDialog';
import SearchInput from './SearchInput';
import Pagination from './Pagination';
import { SkeletonTable } from './SkeletonLoader';
import EmptyState from './EmptyState';
import ExportMenu from './ExportMenu';
import SelectionBar from './SelectionBar';
import { exportAsJSON } from '../utils/export';
import CopyButton from './CopyButton';
import KubexConfigPanel from './KubexConfigPanel';
import KubexInstallDepPanel from './KubexInstallDepPanel';
import KubexCredentialPanel from './KubexCredentialPanel';

// Status filter options
type StatusFilter = 'all' | 'running' | 'created' | 'stopped' | 'error';

// Stable comparators defined at module level so their references don't change between renders
const sortComparators = {
  kubex_id: (a: Kubex, b: Kubex) => a.kubex_id.localeCompare(b.kubex_id),
  agent_id: (a: Kubex, b: Kubex) => (a.agent_id ?? '').localeCompare(b.agent_id ?? ''),
  status: (a: Kubex, b: Kubex) => a.status.localeCompare(b.status),
};

type KubexSortKey = keyof typeof sortComparators;

const VALID_STATUS_FILTERS: StatusFilter[] = ['all', 'running', 'created', 'stopped', 'error'];

// URL param defaults for ContainersPanel
const CONTAINERS_PARAM_DEFAULTS = {
  search: '',
  status: 'all',
  sort: '',
  dir: '',
  page: '1',
};

export default function ContainersPanel() {
  const [kubexes, setKubexes] = useState<Kubex[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionIn, setActionIn] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ kubexId: string; action: 'kill' | 'restart' | 'respawn' | 'delete' } | null>(null);
  // Bulk selection
  const [bulkKillConfirmOpen, setBulkKillConfirmOpen] = useState(false);
  const [bulkActionInProgress, setBulkActionInProgress] = useState(false);
  const { selectedIds, selectedCount, toggleOne, toggleAll, clearSelection, isSelected } = useSelection();

  // URL query params — search, status filter, sort key/direction, page
  const [qp, setQp] = useQueryParams(CONTAINERS_PARAM_DEFAULTS);

  // Derive typed values from URL params
  const statusFilter: StatusFilter = VALID_STATUS_FILTERS.includes(qp.status as StatusFilter)
    ? (qp.status as StatusFilter)
    : 'all';

  const validSortKeys = Object.keys(sortComparators) as KubexSortKey[];
  const urlSortKey = validSortKeys.includes(qp.sort as KubexSortKey) ? (qp.sort as KubexSortKey) : null;
  const urlSortDir = qp.dir === 'desc' ? 'desc' as const : (qp.dir === 'asc' ? 'asc' as const : null);
  const initialSortConfig = urlSortKey && urlSortDir ? { key: urlSortKey, direction: urlSortDir } : null;

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
    initialQuery: qp.search,
  });

  // When search changes, update URL (replaceState)
  function handleSearchChange(q: string) {
    setQuery(q);
    setQp({ search: q, page: '1' }, false);
  }

  // When status filter changes, update URL (pushState for navigable filter)
  function handleStatusFilterChange(val: StatusFilter) {
    setQp({ status: val, page: '1' }, true);
  }

  // Sort — useSort internally uses useMemo
  const { sortedItems, sortConfig, requestSort, getSortIndicator } = useSort(
    searchedKubexes,
    sortComparators,
    initialSortConfig,
  );

  // When sort changes, update URL
  function handleRequestSort(key: KubexSortKey) {
    requestSort(key);
    let newKey = key;
    let newDir: 'asc' | 'desc' | '' = 'asc';
    if (sortConfig?.key === key) {
      if (sortConfig.direction === 'asc') {
        newDir = 'desc';
      } else {
        newKey = '' as KubexSortKey;
        newDir = '';
      }
    }
    setQp({ sort: newKey, dir: newDir, page: '1' }, false);
  }

  // Paginate — usePagination internally uses useMemo for paginatedItems slice
  const initialPage = Math.max(1, parseInt(qp.page, 10) || 1);
  const pagination = usePagination(sortedItems, { initialPageSize: 10, initialPage });

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
  const containersTableId = 'containers-table';
  const { focusedIndex, handleKeyDown: handleTableKeyDown, getRowProps } = useTableKeyboardNav({
    rowCount: pagination.paginatedItems.length,
    onSpace: useCallback((idx: number) => {
      const kubex = pagination.paginatedItems[idx];
      if (kubex) toggleOne(kubex.kubex_id);
    }, [pagination.paginatedItems, toggleOne]),
  });

  function requestKill(kubexId: string) {
    setConfirmTarget({ kubexId, action: 'kill' });
  }

  function requestRestart(kubexId: string) {
    setConfirmTarget({ kubexId, action: 'restart' });
  }

  function requestRespawn(kubexId: string) {
    setConfirmTarget({ kubexId, action: 'respawn' });
  }

  function requestDelete(kubexId: string) {
    setConfirmTarget({ kubexId, action: 'delete' });
  }

  async function handleConfirmedAction() {
    if (!confirmTarget) return;
    const { kubexId, action } = confirmTarget;
    setConfirmTarget(null);
    setActionIn(kubexId);
    if (action === 'kill') await killKubex(kubexId);
    else if (action === 'restart') await restartKubex(kubexId);
    else if (action === 'respawn') await respawnKubex(kubexId);
    else if (action === 'delete') await deleteKubex(kubexId);
    setActionIn(null);
    await load();
  }

  async function handleStart(kubexId: string) {
    setActionIn(kubexId);
    await startKubex(kubexId);
    setActionIn(null);
    await load();
  }

  async function handleStop(kubexId: string) {
    setActionIn(kubexId);
    await stopKubex(kubexId);
    setActionIn(null);
    await load();
  }

  async function handleBulkKill() {
    setBulkKillConfirmOpen(false);
    setBulkActionInProgress(true);
    const ids = Array.from(selectedIds);
    await Promise.allSettled(ids.map((id) => killKubex(id)));
    clearSelection();
    setBulkActionInProgress(false);
    await load();
  }

  async function handleBulkStart() {
    setBulkActionInProgress(true);
    const ids = Array.from(selectedIds);
    await Promise.allSettled(ids.map((id) => startKubex(id)));
    clearSelection();
    setBulkActionInProgress(false);
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
            onChange={handleSearchChange}
            placeholder="Search kubexes by ID, agent, image, status…"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => handleStatusFilterChange(e.target.value as StatusFilter)}
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
          {/* Compute allSelected / someSelected from full filtered list */}
          {(() => {
            const allIds = sortedItems.map((k) => k.kubex_id);
            const allSelected = allIds.length > 0 && allIds.every((id) => isSelected(id));
            const someSelected = selectedCount > 0 && !allSelected;

            // Determine which bulk actions are relevant based on current selection
            const selectedKubexes = sortedItems.filter((k) => isSelected(k.kubex_id));
            const hasRunningSelected = selectedKubexes.some((k) => k.status === 'running');
            const hasStoppedSelected = selectedKubexes.some(
              (k) => k.status !== 'running' && k.status !== 'created',
            );
            const hasCreatedSelected = selectedKubexes.some((k) => k.status === 'created');

            return (
              <>
                <div
                  id={containersTableId}
                  className="rounded-xl border border-[var(--color-border)] overflow-hidden outline-none"
                  role="grid"
                  aria-label="Docker containers"
                  aria-activedescendant={focusedIndex >= 0 ? `${containersTableId}-row-${focusedIndex}` : undefined}
                  tabIndex={0}
                  onKeyDown={handleTableKeyDown}
                  data-testid="containers-table"
                >
                  {/* Table header */}
                  <div
                    className="grid grid-cols-[auto_2fr_2fr_1fr_2fr_auto] gap-4 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-dark)]"
                    role="row"
                  >
                    {/* Select-all checkbox */}
                    <span role="columnheader" className="flex items-center">
                      <input
                        type="checkbox"
                        aria-label="Select all kubexes"
                        data-testid="containers-select-all"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={() => toggleAll(allIds)}
                        className="h-3.5 w-3.5 rounded border-[var(--color-border)] accent-emerald-500 cursor-pointer"
                      />
                    </span>
                    {[
                      { label: 'Kubex ID', sortKey: 'kubex_id' as KubexSortKey },
                      { label: 'Agent', sortKey: 'agent_id' as KubexSortKey },
                      { label: 'Status', sortKey: 'status' as KubexSortKey },
                      { label: 'Image', sortKey: null },
                      { label: 'Actions', sortKey: null },
                    ].map(({ label, sortKey }) => (
                      <span
                        key={label}
                        className={`text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)] ${sortKey ? 'cursor-pointer hover:text-[var(--color-text-dim)] select-none' : ''}`}
                        onClick={sortKey ? () => handleRequestSort(sortKey) : undefined}
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
                      selected={isSelected(kubex.kubex_id)}
                      focused={focusedIndex === idx}
                      rowProps={getRowProps(idx, containersTableId)}
                      onSelect={() => toggleOne(kubex.kubex_id)}
                      onKill={() => requestKill(kubex.kubex_id)}
                      onStart={() => handleStart(kubex.kubex_id)}
                      onStop={() => handleStop(kubex.kubex_id)}
                      onRestart={() => requestRestart(kubex.kubex_id)}
                      onRespawn={() => requestRespawn(kubex.kubex_id)}
                      onDelete={() => requestDelete(kubex.kubex_id)}
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
                  onNextPage={handleNextPage}
                  onPrevPage={handlePrevPage}
                  onPageSizeChange={handlePageSizeChange}
                />

                {/* Bulk selection bar */}
                <SelectionBar
                  testId="containers-selection-bar"
                  selectedCount={selectedCount}
                  itemNoun="kubex"
                  onClear={clearSelection}
                  actions={[
                    ...(hasRunningSelected
                      ? [
                          {
                            label: 'Kill Selected',
                            variant: 'danger' as const,
                            disabled: bulkActionInProgress,
                            testId: 'containers-bulk-kill',
                            onClick: () => setBulkKillConfirmOpen(true),
                          },
                        ]
                      : []),
                    ...((hasStoppedSelected || hasCreatedSelected)
                      ? [
                          {
                            label: 'Start Selected',
                            variant: 'success' as const,
                            disabled: bulkActionInProgress,
                            testId: 'containers-bulk-start',
                            onClick: handleBulkStart,
                          },
                        ]
                      : []),
                  ]}
                />
              </>
            );
          })()}
        </>
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        title={
          confirmTarget?.action === 'kill'
            ? 'Kill Kubex'
            : confirmTarget?.action === 'restart'
            ? 'Restart Kubex'
            : confirmTarget?.action === 'delete'
            ? 'Delete Kubex'
            : 'Respawn Kubex'
        }
        message={
          confirmTarget?.action === 'kill'
            ? `Are you sure you want to kill kubex "${confirmTarget?.kubexId}"?`
            : confirmTarget?.action === 'restart'
            ? `Restart kubex "${confirmTarget?.kubexId}"? The container will be stopped and restarted.`
            : confirmTarget?.action === 'delete'
            ? `Permanently delete kubex "${confirmTarget?.kubexId}"? This removes the record from Manager. The container is not stopped — kill it first if still running.`
            : `Respawn kubex "${confirmTarget?.kubexId}"? The container will be killed and a new one created from the persisted config.`
        }
        confirmLabel={
          confirmTarget?.action === 'kill' ? 'Kill' :
          confirmTarget?.action === 'restart' ? 'Restart' :
          confirmTarget?.action === 'delete' ? 'Delete' :
          'Respawn'
        }
        variant={confirmTarget?.action === 'kill' || confirmTarget?.action === 'delete' ? 'danger' : 'warning'}
        onConfirm={handleConfirmedAction}
        onCancel={() => setConfirmTarget(null)}
      />

      <ConfirmDialog
        open={bulkKillConfirmOpen}
        title="Kill Selected Kubexes"
        message={`Kill ${selectedCount} kubex${selectedCount === 1 ? '' : 'es'}? Running containers will be stopped.`}
        confirmLabel={`Kill ${selectedCount}`}
        variant="danger"
        onConfirm={handleBulkKill}
        onCancel={() => setBulkKillConfirmOpen(false)}
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
  selected: boolean;
  focused: boolean;
  rowProps: {
    id: string;
    tabIndex: number;
    'aria-rowindex': number;
    'data-nav-index': number;
    onFocus: () => void;
  };
  onSelect: () => void;
  onKill: () => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onRespawn: () => void;
  onDelete: () => void;
}

// Wrapped in React.memo — ContainersPanel re-renders on every 10s poll tick.
// KubexRow skips re-render when its own props haven't changed.
const KubexRow = memo(function KubexRow({ kubex, isLast, actionIn, selected, focused, rowProps, onSelect, onKill, onStart, onStop, onRestart, onRespawn, onDelete }: KubexRowProps) {
  const isRunning = kubex.status === 'running';
  const isStopped = kubex.status === 'stopped' || kubex.status === 'error';
  const isCreated = kubex.status === 'created';
  const [configOpen, setConfigOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [credOpen, setCredOpen] = useState(false);

  return (
    <div
      className={`
        transition-colors
        ${!isLast ? 'border-b border-[var(--color-border)]' : ''}
      `}
    >
      {/* Main row */}
      <div
        {...rowProps}
        className={`
          grid grid-cols-[auto_2fr_2fr_1fr_2fr_auto] gap-4 px-4 py-3 items-center
          outline-none
          ${selected ? 'bg-emerald-500/5' : 'bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'}
          ${focused ? 'ring-2 ring-inset ring-emerald-500/60' : ''}
        `}
        role="row"
      >
        {/* Row checkbox */}
        <span role="cell">
          <input
            type="checkbox"
            aria-label={`Select kubex ${kubex.kubex_id}`}
            data-testid={`kubex-checkbox-${kubex.kubex_id}`}
            checked={selected}
            onChange={onSelect}
            className="h-3.5 w-3.5 rounded border-[var(--color-border)] accent-emerald-500 cursor-pointer"
          />
        </span>

        {/* Kubex ID */}
        <span className="flex items-center gap-1.5 min-w-0" role="cell">
          <button
            onClick={() => setConfigOpen((v) => !v)}
            data-testid={`kubex-expand-${kubex.kubex_id}`}
            title={configOpen ? 'Collapse config' : 'Expand config'}
            aria-expanded={configOpen}
            className="flex items-center gap-1 min-w-0 text-left focus:outline-none group"
          >
            <span
              className="text-[var(--color-text-muted)] group-hover:text-[var(--color-text-dim)] transition-transform duration-150 flex-shrink-0"
              style={{ display: 'inline-block', transform: configOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
              aria-hidden="true"
            >
              ›
            </span>
            <span className="font-mono-data text-sm text-[var(--color-text)] truncate" title={kubex.kubex_id}>
              {kubex.kubex_id}
            </span>
          </button>
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
        <div className="flex items-center gap-1.5" role="cell" data-testid={`kubex-actions-${kubex.kubex_id}`}>
          {/* Start — shown when created or stopped/error */}
          {(isCreated || isStopped) && (
            <button
              onClick={onStart}
              disabled={actionIn}
              data-testid={`kubex-start-${kubex.kubex_id}`}
              title="Start container"
              className="px-2 py-1 text-[10px] rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
            >
              {actionIn ? '…' : 'Start'}
            </button>
          )}

          {/* Stop — shown when running */}
          {isRunning && (
            <button
              onClick={onStop}
              disabled={actionIn}
              data-testid={`kubex-stop-${kubex.kubex_id}`}
              title="Gracefully stop container"
              className="px-2 py-1 text-[10px] rounded border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
            >
              {actionIn ? '…' : 'Stop'}
            </button>
          )}

          {/* Restart — shown when running */}
          {isRunning && (
            <button
              onClick={onRestart}
              disabled={actionIn}
              data-testid={`kubex-restart-${kubex.kubex_id}`}
              title="Restart container"
              className="px-2 py-1 text-[10px] rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
            >
              {actionIn ? '…' : 'Restart'}
            </button>
          )}

          {/* Respawn — shown for all non-running states */}
          {!isRunning && (
            <button
              onClick={onRespawn}
              disabled={actionIn}
              data-testid={`kubex-respawn-${kubex.kubex_id}`}
              title="Kill and recreate container from persisted config"
              className="px-2 py-1 text-[10px] rounded border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-50"
            >
              {actionIn ? '…' : 'Respawn'}
            </button>
          )}

          {/* Kill — shown when running */}
          {isRunning && (
            <button
              onClick={onKill}
              disabled={actionIn}
              data-testid={`kubex-kill-${kubex.kubex_id}`}
              title="Force-kill container"
              className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              {actionIn ? '…' : 'Kill'}
            </button>
          )}

          {/* Install Pkg — shown only when running */}
          {isRunning && (
            <button
              onClick={() => setInstallOpen((v) => !v)}
              data-testid={`kubex-install-dep-btn-${kubex.kubex_id}`}
              title={installOpen ? 'Close package installer' : 'Install a runtime package into this container'}
              aria-expanded={installOpen}
              className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                installOpen
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                  : 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
              }`}
            >
              + Pkg
            </button>
          )}

          {/* Credentials — shown only when running */}
          {isRunning && (
            <button
              onClick={() => setCredOpen((v) => !v)}
              data-testid={`kubex-credentials-btn-${kubex.kubex_id}`}
              title={credOpen ? 'Close credential injector' : 'Inject OAuth credentials into this container'}
              aria-expanded={credOpen}
              className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                credOpen
                  ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-300'
                  : 'border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10'
              }`}
            >
              Creds
            </button>
          )}

          {/* Delete — shown for all kubexes; removes the Manager record */}
          <button
            onClick={onDelete}
            disabled={actionIn}
            data-testid={`kubex-delete-${kubex.kubex_id}`}
            title="Delete kubex record from Manager"
            className="px-2 py-1 text-[10px] rounded border border-red-500/20 text-red-500/70 hover:border-red-500/50 hover:text-red-400 hover:bg-red-500/5 transition-colors disabled:opacity-50"
          >
            {actionIn ? '…' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Expandable config panel */}
      {configOpen && (
        <KubexConfigPanel kubexId={kubex.kubex_id} />
      )}

      {/* Expandable install-dep panel — only when running */}
      {installOpen && isRunning && (
        <KubexInstallDepPanel kubexId={kubex.kubex_id} />
      )}

      {/* Expandable credential panel — only when running */}
      {credOpen && isRunning && (
        <KubexCredentialPanel kubexId={kubex.kubex_id} />
      )}
    </div>
  );
});
