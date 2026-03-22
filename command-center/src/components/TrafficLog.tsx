import { useState, useMemo } from 'react';
import type { TrafficEntry, ActionStatus, TrafficFilter } from '../types';
import { usePagination } from '../hooks/usePagination';
import TrafficFilterBar from './TrafficFilterBar';
import Pagination from './Pagination';

interface TrafficLogProps {
  entries: TrafficEntry[];
  onClear?: () => void;
}

const STATUS_COLORS: Record<ActionStatus, string> = {
  allowed: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  denied: 'text-red-400 bg-red-500/10 border-red-500/30',
  escalated: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  pending: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
};

const STATUS_ROW_BG: Record<ActionStatus, string> = {
  allowed: 'border-l-emerald-500/40',
  denied: 'border-l-red-500/40',
  escalated: 'border-l-amber-500/40',
  pending: 'border-l-blue-500/40',
};

export default function TrafficLog({ entries, onClear }: TrafficLogProps) {
  const [filter, setFilter] = useState<TrafficFilter>({
    status: 'all',
    agentId: '',
    search: '',
  });

  // Get unique agent IDs for the filter dropdown
  const agentIds = useMemo(() => {
    const ids = new Set(entries.map((e) => e.agent_id));
    return [...ids].sort();
  }, [entries]);

  // Apply filters
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (filter.status !== 'all' && entry.status !== filter.status) return false;
      if (filter.agentId && entry.agent_id !== filter.agentId) return false;
      if (filter.search) {
        const needle = filter.search.toLowerCase();
        const haystack = [entry.action, entry.capability, entry.task_id, entry.agent_id, entry.policy_rule]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [entries, filter]);

  // Paginate
  const pagination = usePagination(filteredEntries, { initialPageSize: 20 });

  return (
    <div className="p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-[#e2e8f0]">Traffic / Actions Log</h2>
          <p className="text-xs text-[#64748b]">
            Actions dispatched through the Gateway — {entries.length} entries
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#64748b]">
          <LegendDot color="emerald" label="allowed" />
          <LegendDot color="red" label="denied" />
          <LegendDot color="amber" label="escalated" />
          <LegendDot color="blue" label="pending" />
        </div>
      </div>

      {/* Filter bar */}
      <TrafficFilterBar
        filter={filter}
        onFilterChange={setFilter}
        agentIds={agentIds}
        totalCount={entries.length}
        filteredCount={filteredEntries.length}
        onClear={onClear ?? (() => {})}
      />

      {/* Content */}
      {filteredEntries.length === 0 ? (
        entries.length === 0 ? <EmptyTraffic /> : (
          <div className="rounded-xl border border-dashed border-[#2a2f45] bg-[#1a1d27] p-8 text-center">
            <p className="text-sm text-[#64748b]">No entries match the current filters.</p>
          </div>
        )
      ) : (
        <>
          <div className="space-y-1.5">
            {pagination.paginatedItems.map((entry) => (
              <TrafficRow key={entry.id} entry={entry} />
            ))}
          </div>

          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            totalItems={filteredEntries.length}
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
    </div>
  );
}

function TrafficRow({ entry }: { entry: TrafficEntry }) {
  const statusStyle = STATUS_COLORS[entry.status] ?? 'text-slate-400 bg-slate-500/10 border-slate-500/30';
  const rowBorder = STATUS_ROW_BG[entry.status] ?? 'border-l-slate-500/40';

  return (
    <div
      className={`
        rounded-r-xl border border-[#2a2f45] border-l-2 ${rowBorder}
        bg-[#1a1d27] px-4 py-3
        grid grid-cols-[160px_140px_120px_1fr_120px_140px] gap-3 items-center
        hover:bg-[#20243a] transition-colors text-xs
      `}
    >
      {/* Timestamp */}
      <span className="font-mono-data text-[#64748b]">
        {entry.timestamp.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })}
      </span>

      {/* Agent ID */}
      <span className="font-mono-data text-[#94a3b8] truncate" title={entry.agent_id}>
        {entry.agent_id}
      </span>

      {/* Action */}
      <span className="font-mono-data text-[#e2e8f0] truncate" title={entry.action}>
        {entry.action}
      </span>

      {/* Capability / target */}
      <span className="text-[#64748b] truncate" title={entry.capability ?? entry.target ?? '—'}>
        {entry.capability ?? entry.target ?? '—'}
      </span>

      {/* Status */}
      <span
        className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full border font-medium ${statusStyle}`}
      >
        {entry.status}
      </span>

      {/* Task ID / policy */}
      <span
        className="font-mono-data text-[#3a3f5a] truncate"
        title={entry.task_id ?? entry.policy_rule ?? '—'}
      >
        {entry.task_id ?? entry.policy_rule ?? '—'}
      </span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  const dots: Record<string, string> = {
    emerald: 'bg-emerald-400',
    red: 'bg-red-400',
    amber: 'bg-amber-400',
    blue: 'bg-blue-400',
  };
  return (
    <span className="flex items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-full ${dots[color]}`} />
      {label}
    </span>
  );
}

function EmptyTraffic() {
  return (
    <div className="rounded-xl border border-dashed border-[#2a2f45] bg-[#1a1d27] p-12 text-center">
      <p className="text-3xl mb-3">⇌</p>
      <p className="text-sm font-medium text-[#94a3b8]">No traffic yet</p>
      <p className="text-xs text-[#64748b] mt-1">
        Dispatch tasks via the Orchestrator tab to see entries here.
      </p>
    </div>
  );
}
