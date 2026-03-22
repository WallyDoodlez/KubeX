/**
 * TaskHistoryPage — dedicated table view of all dispatched tasks extracted
 * from the traffic log (entries where action === 'dispatch_task').
 *
 * Columns: task_id, agent_id, capability, status, dispatched_at
 * Features: search, sort, pagination, status filter, expandable detail rows,
 *           URL-persisted state, export to JSON/CSV.
 */
import { useState, useMemo, memo } from 'react';
import type { TrafficEntry, ActionStatus } from '../types';
import { useSearch } from '../hooks/useSearch';
import { useSort } from '../hooks/useSort';
import { usePagination } from '../hooks/usePagination';
import { useQueryParams } from '../hooks/useQueryParams';
import SearchInput from './SearchInput';
import Pagination from './Pagination';
import StatusBadge from './StatusBadge';
import EmptyState from './EmptyState';
import ExportMenu from './ExportMenu';
import RelativeTime from './RelativeTime';
import CopyButton from './CopyButton';
import { exportAsJSON, exportAsCSV } from '../utils/export';

interface TaskHistoryPageProps {
  /** All traffic log entries — the page filters to dispatch_task entries. */
  entries: TrafficEntry[];
}

// ── Status filter values ────────────────────────────────────────────

const VALID_STATUSES = ['all', 'allowed', 'denied', 'escalated', 'pending'] as const;
type StatusFilter = (typeof VALID_STATUSES)[number];

// ── URL param defaults ───────────────────────────────────────────────

const PARAM_DEFAULTS = {
  status: 'all',
  search: '',
  sort: 'dispatched_at',
  dir: 'desc',
  page: '1',
};

type SortKey = 'task_id' | 'agent_id' | 'capability' | 'status' | 'dispatched_at';

// Stable comparators at module level to avoid recreating on every render
const sortComparators: Record<SortKey, (a: TrafficEntry, b: TrafficEntry) => number> = {
  task_id: (a, b) => (a.task_id ?? '').localeCompare(b.task_id ?? ''),
  agent_id: (a, b) => a.agent_id.localeCompare(b.agent_id),
  capability: (a, b) => (a.capability ?? '').localeCompare(b.capability ?? ''),
  status: (a, b) => a.status.localeCompare(b.status),
  dispatched_at: (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
};

// ── Sub-components ───────────────────────────────────────────────────

interface DetailRowProps {
  entry: TrafficEntry;
}

const DetailRow = memo(function DetailRow({ entry }: DetailRowProps) {
  const detailJson = entry.details
    ? JSON.stringify(entry.details, null, 2)
    : null;

  return (
    <tr
      data-testid={`task-detail-row-${entry.id}`}
      className="bg-[var(--color-surface-dark)]/50"
    >
      <td colSpan={6} className="px-4 py-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {/* Meta */}
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] font-semibold">
              Task metadata
            </p>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-text-muted)] w-24 flex-shrink-0">Task ID</span>
                <span className="font-mono-data text-[var(--color-text-secondary)] truncate">
                  {entry.task_id ?? '—'}
                </span>
                {entry.task_id && <CopyButton text={entry.task_id} ariaLabel="Copy task ID" />}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-text-muted)] w-24 flex-shrink-0">Agent</span>
                <span className="font-mono-data text-[var(--color-text-secondary)] truncate">
                  {entry.agent_id}
                </span>
                <CopyButton text={entry.agent_id} ariaLabel="Copy agent ID" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-text-muted)] w-24 flex-shrink-0">Capability</span>
                <span className="font-mono-data text-[var(--color-text-secondary)]">
                  {entry.capability ?? '—'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-text-muted)] w-24 flex-shrink-0">Policy rule</span>
                <span className="font-mono-data text-[var(--color-text-secondary)]">
                  {entry.policy_rule ?? '—'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-text-muted)] w-24 flex-shrink-0">Dispatched</span>
                <span className="font-mono-data text-[var(--color-text-secondary)]">
                  {entry.timestamp.toISOString()}
                </span>
              </div>
            </div>
          </div>

          {/* Details JSON */}
          {detailJson && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] font-semibold">
                Details
              </p>
              <pre
                data-testid={`task-detail-json-${entry.id}`}
                className="bg-[var(--color-bg)] rounded-lg p-3 text-[10px] font-mono-data text-[var(--color-text-secondary)] overflow-auto max-h-40 border border-[var(--color-border)]"
              >
                {detailJson}
              </pre>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
});

interface TaskRowProps {
  entry: TrafficEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

const TaskRow = memo(function TaskRow({ entry, isExpanded, onToggle }: TaskRowProps) {
  const taskId = entry.task_id ?? '—';
  const capability = entry.capability ?? '—';

  return (
    <tr
      data-testid={`task-row-${entry.id}`}
      onClick={onToggle}
      role="row"
      aria-expanded={isExpanded}
      className={[
        'border-b border-[var(--color-border)] transition-colors cursor-pointer',
        'hover:bg-[var(--color-surface)] focus-within:bg-[var(--color-surface)]',
        isExpanded ? 'bg-[var(--color-surface)]' : '',
      ].join(' ')}
    >
      {/* Expand toggle */}
      <td className="w-8 px-2 py-2.5 text-center">
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          aria-label={isExpanded ? 'Collapse task details' : 'Expand task details'}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
        >
          <span aria-hidden="true" className="text-xs font-mono">
            {isExpanded ? '▾' : '▸'}
          </span>
        </button>
      </td>

      {/* Task ID */}
      <td className="px-3 py-2.5 font-mono-data text-xs text-[var(--color-text-secondary)] truncate max-w-[160px]">
        <span title={taskId}>{taskId}</span>
      </td>

      {/* Agent ID */}
      <td className="px-3 py-2.5 font-mono-data text-xs text-[var(--color-text-secondary)] truncate max-w-[140px]">
        <span title={entry.agent_id}>{entry.agent_id}</span>
      </td>

      {/* Capability */}
      <td className="px-3 py-2.5">
        {capability !== '—' ? (
          <span className="inline-block text-xs font-mono-data bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-[var(--color-text-secondary)]">
            {capability}
          </span>
        ) : (
          <span className="text-xs text-[var(--color-text-muted)]">—</span>
        )}
      </td>

      {/* Status */}
      <td className="px-3 py-2.5">
        <StatusBadge status={entry.status} />
      </td>

      {/* Dispatched at */}
      <td className="px-3 py-2.5 text-xs text-[var(--color-text-muted)] font-mono-data whitespace-nowrap">
        <RelativeTime date={entry.timestamp} />
      </td>
    </tr>
  );
});

// ── Main component ───────────────────────────────────────────────────

export default function TaskHistoryPage({ entries }: TaskHistoryPageProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // URL query params
  const [qp, setQp] = useQueryParams(PARAM_DEFAULTS);

  // Extract dispatch_task entries from the traffic log
  const taskEntries = useMemo(
    () => entries.filter((e) => e.action === 'dispatch_task'),
    [entries],
  );

  // Status filter from URL
  const statusValue: StatusFilter = (VALID_STATUSES as readonly string[]).includes(qp.status)
    ? (qp.status as StatusFilter)
    : 'all';

  // Apply status filter
  const statusFiltered = useMemo(() => {
    if (statusValue === 'all') return taskEntries;
    return taskEntries.filter((e) => e.status === (statusValue as ActionStatus));
  }, [taskEntries, statusValue]);

  // Search — across task_id, agent_id, capability
  const { query, setQuery, filteredItems: searched } = useSearch(statusFiltered, {
    fields: [
      (e) => e.task_id ?? '',
      (e) => e.agent_id,
      (e) => e.capability ?? '',
    ],
    initialQuery: qp.search,
  });

  // Sort — derive initial config from URL
  const validSortKeys = Object.keys(sortComparators) as SortKey[];
  const urlSortKey = validSortKeys.includes(qp.sort as SortKey) ? (qp.sort as SortKey) : 'dispatched_at';
  const urlSortDir = qp.dir === 'asc' ? 'asc' as const : 'desc' as const;
  const initialSortConfig = { key: urlSortKey, direction: urlSortDir };

  const { sortedItems, requestSort, getSortIndicator } = useSort(
    searched,
    sortComparators,
    initialSortConfig,
  );

  // Pagination
  const {
    paginatedItems,
    page,
    totalPages,
    pageSize,
    setPageSize,
    hasNext,
    hasPrev,
    nextPage,
    prevPage,
    startIndex,
    endIndex,
  } = usePagination(sortedItems, { initialPage: Number(qp.page) || 1, initialPageSize: 20 });

  // Handler helpers
  function handleSearchChange(q: string) {
    setQuery(q);
    setQp({ search: q, page: '1' }, false);
  }

  function handleStatusChange(next: StatusFilter) {
    setQp({ status: next, page: '1' }, true);
  }

  function handleSortClick(key: SortKey) {
    requestSort(key);
    // Sync URL — determine next direction
    const current = qp.sort === key ? qp.dir : 'asc';
    const nextDir = current === 'asc' ? 'desc' : 'asc';
    setQp({ sort: key, dir: nextDir, page: '1' }, false);
  }

  function handlePageSizeChange(s: number) {
    setPageSize(s);
    setQp({ page: '1' }, false);
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  // Export helpers — row type for export
  type ExportRow = {
    task_id: string;
    agent_id: string;
    capability: string;
    status: string;
    dispatched_at: string;
    policy_rule: string;
  };

  function getExportRows(): ExportRow[] {
    return sortedItems.map((e) => ({
      task_id: e.task_id ?? '',
      agent_id: e.agent_id,
      capability: e.capability ?? '',
      status: e.status,
      dispatched_at: e.timestamp.toISOString(),
      policy_rule: e.policy_rule ?? '',
    }));
  }

  // Column header helper (defined as inner component for readability)
  function ColHeader({
    label,
    sortKey,
    className = '',
  }: {
    label: string;
    sortKey?: SortKey;
    className?: string;
  }) {
    if (!sortKey) {
      return (
        <th
          scope="col"
          className={`px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] ${className}`}
        >
          {label}
        </th>
      );
    }
    return (
      <th
        scope="col"
        className={`px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] ${className}`}
      >
        <button
          onClick={() => handleSortClick(sortKey)}
          aria-label={`Sort by ${label}`}
          className="flex items-center gap-1 hover:text-[var(--color-text-secondary)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 rounded"
        >
          {label}
          <span aria-hidden="true" className="font-mono text-[10px]">
            {getSortIndicator(sortKey)}
          </span>
        </button>
      </th>
    );
  }

  const totalTaskCount = taskEntries.length;
  const filteredCount = sortedItems.length;
  const hasFilter = statusValue !== 'all' || query.trim().length > 0;

  return (
    <div className="p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Task History</h2>
          <p className="text-xs text-[var(--color-text-dim)] mt-0.5">
            {hasFilter
              ? `${filteredCount} of ${totalTaskCount} tasks`
              : `${totalTaskCount} dispatched task${totalTaskCount !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            onExportJSON={() => exportAsJSON(getExportRows(), 'task-history')}
            onExportCSV={() =>
              exportAsCSV(
                getExportRows(),
                ['task_id', 'agent_id', 'capability', 'status', 'dispatched_at', 'policy_rule'],
                (row) => [row.task_id, row.agent_id, row.capability, row.status, row.dispatched_at, row.policy_rule],
                'task-history',
              )
            }
          />
        </div>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Status filter */}
        <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Filter by status">
          {VALID_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              aria-pressed={statusValue === s}
              className={[
                'px-2.5 py-1 text-xs rounded-full border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                statusValue === s
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-transparent text-[var(--color-text-dim)] border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-secondary)]',
              ].join(' ')}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex-1 min-w-[200px] max-w-xs ml-auto">
          <SearchInput
            value={query}
            onChange={handleSearchChange}
            placeholder="Search task ID, agent, capability…"
          />
        </div>
      </div>

      {/* Table / empty states */}
      {totalTaskCount === 0 ? (
        <EmptyState
          icon="✦"
          title="No dispatched tasks yet"
          description="Tasks appear here after you dispatch them via the Orchestrator."
        />
      ) : filteredCount === 0 ? (
        <EmptyState
          icon="⊘"
          title="No tasks match your filters"
          description="Try adjusting the status filter or search query."
        />
      ) : (
        <>
          <div
            data-testid="task-history-table"
            className="rounded-xl border border-[var(--color-border)] overflow-hidden"
          >
            <div className="overflow-x-auto">
              <table
                role="table"
                aria-label="Task history"
                className="w-full border-collapse text-sm"
              >
                <thead>
                  <tr className="bg-[var(--color-surface-dark)] border-b border-[var(--color-border)]">
                    {/* Expand column */}
                    <th scope="col" className="w-8 px-2 py-2.5" aria-label="Expand" />
                    <ColHeader label="Task ID" sortKey="task_id" />
                    <ColHeader label="Agent" sortKey="agent_id" />
                    <ColHeader label="Capability" sortKey="capability" />
                    <ColHeader label="Status" sortKey="status" />
                    <ColHeader label="Dispatched" sortKey="dispatched_at" />
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map((entry) => (
                    <>
                      <TaskRow
                        key={entry.id}
                        entry={entry}
                        isExpanded={expandedId === entry.id}
                        onToggle={() => toggleExpand(entry.id)}
                      />
                      {expandedId === entry.id && (
                        <DetailRow key={`detail-${entry.id}`} entry={entry} />
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <Pagination
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={filteredCount}
            startIndex={startIndex}
            endIndex={endIndex}
            hasNext={hasNext}
            hasPrev={hasPrev}
            onNextPage={nextPage}
            onPrevPage={prevPage}
            onPageSizeChange={handlePageSizeChange}
          />
        </>
      )}
    </div>
  );
}
