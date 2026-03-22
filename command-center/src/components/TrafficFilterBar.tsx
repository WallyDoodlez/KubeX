import type { ActionStatus, TrafficFilter } from '../types';

interface TrafficFilterBarProps {
  filter: TrafficFilter;
  onFilterChange: (filter: TrafficFilter) => void;
  agentIds: string[];
  totalCount: number;
  filteredCount: number;
  onClear: () => void;
}

const STATUS_OPTIONS: { value: ActionStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'allowed', label: 'Allowed' },
  { value: 'denied', label: 'Denied' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'pending', label: 'Pending' },
];

export default function TrafficFilterBar({
  filter, onFilterChange, agentIds, totalCount, filteredCount, onClear,
}: TrafficFilterBarProps) {
  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      {/* Status filter */}
      <select
        value={filter.status}
        onChange={(e) => onFilterChange({ ...filter, status: e.target.value as ActionStatus | 'all' })}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--color-text)] focus:outline-none focus:border-emerald-500/50"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Agent filter */}
      <select
        value={filter.agentId}
        onChange={(e) => onFilterChange({ ...filter, agentId: e.target.value })}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--color-text)] focus:outline-none focus:border-emerald-500/50"
      >
        <option value="">All agents</option>
        {agentIds.map((id) => (
          <option key={id} value={id}>{id}</option>
        ))}
      </select>

      {/* Search */}
      <input
        type="text"
        value={filter.search}
        onChange={(e) => onFilterChange({ ...filter, search: e.target.value })}
        placeholder="Search actions…"
        className="flex-1 min-w-[150px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-emerald-500/50"
      />

      {/* Count */}
      <span className="text-xs font-mono-data text-[var(--color-text-dim)]">
        {filteredCount === totalCount ? totalCount : `${filteredCount} / ${totalCount}`}
      </span>

      {/* Clear */}
      {totalCount > 0 && (
        <button
          onClick={onClear}
          className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
        >
          Clear log
        </button>
      )}
    </div>
  );
}
