import { memo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TrafficEntry, ActionStatus } from '../types';
import StatusBadge from './StatusBadge';
import RelativeTime from './RelativeTime';

const ACTIVITY_DEFAULT_LIMIT = 10;
const ACTIVITY_EXPANDED_LIMIT = 50;

const STATUS_ROW_ACCENT: Record<ActionStatus, string> = {
  allowed: 'border-l-emerald-500/50',
  denied: 'border-l-red-500/50',
  escalated: 'border-l-amber-500/50',
  pending: 'border-l-blue-500/50',
};

type FilterStatus = 'all' | ActionStatus;

const FILTER_TABS: { value: FilterStatus; label: string; testId: string }[] = [
  { value: 'all',       label: 'All',       testId: 'activity-filter-all'       },
  { value: 'allowed',   label: 'Allowed',   testId: 'activity-filter-allowed'   },
  { value: 'denied',    label: 'Denied',    testId: 'activity-filter-denied'    },
  { value: 'escalated', label: 'Escalated', testId: 'activity-filter-escalated' },
  { value: 'pending',   label: 'Pending',   testId: 'activity-filter-pending'   },
];

interface ActivityFeedProps {
  entries: TrafficEntry[];
  onViewAll: () => void;
  /** When true, suppresses the built-in section header (e.g. when wrapped in CollapsibleSection) */
  hideHeader?: boolean;
}

interface ActivityRowProps {
  entry: TrafficEntry;
  onAgentClick: (agentId: string) => void;
}

const ActivityRow = memo(function ActivityRow({ entry, onAgentClick }: ActivityRowProps) {
  const accent = STATUS_ROW_ACCENT[entry.status] ?? 'border-l-slate-500/30';
  return (
    <li
      className={`flex items-start gap-3 px-3 py-2 border-l-2 ${accent} bg-[var(--color-surface)] rounded-r-lg hover:bg-[var(--color-surface-hover,var(--color-border))] transition-colors`}
      data-testid="activity-feed-row"
    >
      {/* Timestamp */}
      <RelativeTime
        date={entry.timestamp}
        className="text-[10px] font-mono-data text-[var(--color-text-muted)] shrink-0 w-14 text-right mt-0.5"
        data-testid="activity-row-timestamp"
      />

      {/* Agent — clickable link to agent detail */}
      <button
        type="button"
        onClick={() => onAgentClick(entry.agent_id)}
        data-testid="activity-row-agent-link"
        className="text-xs font-mono-data text-emerald-400 hover:text-emerald-300 underline-offset-2 hover:underline truncate max-w-[120px] shrink-0 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 rounded-sm transition-colors"
        title={`View agent ${entry.agent_id}`}
        aria-label={`Navigate to agent ${entry.agent_id}`}
      >
        {entry.agent_id}
      </button>

      {/* Action + optional task ID */}
      <span className="text-xs text-[var(--color-text-dim)] truncate flex-1 min-w-0">
        <span className="block truncate">
          {entry.action}
          {entry.capability && (
            <span className="ml-1 text-[10px] text-[var(--color-text-muted)]">({entry.capability})</span>
          )}
        </span>
        {entry.task_id && (
          <span
            className="block text-[10px] font-mono-data text-[var(--color-text-muted)] truncate mt-0.5"
            data-testid="activity-row-task-id"
          >
            task:{entry.task_id}
          </span>
        )}
      </span>

      {/* Status badge */}
      <div className="shrink-0 mt-0.5">
        <StatusBadge status={entry.status} size="sm" />
      </div>
    </li>
  );
});

const ActivityFeed = memo(function ActivityFeed({ entries, onViewAll, hideHeader = false }: ActivityFeedProps) {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<FilterStatus>('all');
  const [expanded, setExpanded] = useState(false);

  const handleAgentClick = useCallback((agentId: string) => {
    navigate(`/agents/${agentId}`);
  }, [navigate]);

  // Apply status filter
  const filtered = activeFilter === 'all'
    ? entries
    : entries.filter((e) => e.status === activeFilter);

  const limit = expanded ? ACTIVITY_EXPANDED_LIMIT : ACTIVITY_DEFAULT_LIMIT;
  const visible = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;
  const canCollapse = expanded && filtered.length > ACTIVITY_DEFAULT_LIMIT;

  return (
    <section data-testid="activity-feed">
      {/* Header — suppressed when wrapped in a CollapsibleSection that provides its own header */}
      {!hideHeader && (
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Recent Activity</h2>
            <p className="text-xs text-[var(--color-text-dim)]">
              Showing {visible.length} of {filtered.length} event
              {filtered.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={onViewAll}
            className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
            data-testid="activity-feed-view-all"
          >
            View all →
          </button>
        </div>
      )}

      {/* Status filter tabs */}
      <div
        className="flex gap-1 mb-3 flex-wrap"
        role="tablist"
        aria-label="Filter activity by status"
        data-testid="activity-filter-tabs"
      >
        {FILTER_TABS.map((tab) => {
          const count = tab.value === 'all'
            ? entries.length
            : entries.filter((e) => e.status === tab.value).length;
          const isActive = activeFilter === tab.value;
          return (
            <button
              key={tab.value}
              role="tab"
              aria-selected={isActive}
              data-testid={tab.testId}
              onClick={() => {
                setActiveFilter(tab.value);
                setExpanded(false);
              }}
              className={`
                text-[10px] font-medium px-2 py-1 rounded-md border transition-colors
                ${isActive
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                  : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]'
                }
              `}
            >
              {tab.label}
              {count > 0 && (
                <span className={`ml-1 font-mono-data ${isActive ? 'text-emerald-300' : 'text-[var(--color-text-muted)]'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Feed list */}
      {visible.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center"
          data-testid="activity-feed-empty"
        >
          {entries.length === 0 ? (
            <>
              <p className="text-xs text-[var(--color-text-muted)]">No traffic events yet.</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Dispatch a task via Chat to see activity here.
              </p>
            </>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)]">
              No {activeFilter} events.
            </p>
          )}
        </div>
      ) : (
        <>
          <ul className="space-y-1" aria-label="Recent traffic events">
            {visible.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} onAgentClick={handleAgentClick} />
            ))}
          </ul>

          {/* Show more / show less */}
          {(hasMore || canCollapse) && (
            <div className="mt-2 text-center">
              <button
                type="button"
                data-testid={hasMore ? 'activity-feed-show-more' : 'activity-feed-show-less'}
                onClick={() => setExpanded((prev) => !prev)}
                className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 rounded px-2 py-1"
              >
                {hasMore
                  ? `Show ${Math.min(filtered.length - limit, ACTIVITY_EXPANDED_LIMIT - limit)} more…`
                  : 'Show less'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
});

export default ActivityFeed;
