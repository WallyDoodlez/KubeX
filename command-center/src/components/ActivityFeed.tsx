import { memo } from 'react';
import type { TrafficEntry, ActionStatus } from '../types';
import StatusBadge from './StatusBadge';

const ACTIVITY_LIMIT = 10;

const STATUS_ROW_ACCENT: Record<ActionStatus, string> = {
  allowed: 'border-l-emerald-500/50',
  denied: 'border-l-red-500/50',
  escalated: 'border-l-amber-500/50',
  pending: 'border-l-blue-500/50',
};

interface ActivityFeedProps {
  entries: TrafficEntry[];
  onViewAll: () => void;
}

function formatTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  return `${diffH}h ago`;
}

const ActivityRow = memo(function ActivityRow({ entry }: { entry: TrafficEntry }) {
  const accent = STATUS_ROW_ACCENT[entry.status] ?? 'border-l-slate-500/30';
  return (
    <li
      className={`flex items-center gap-3 px-3 py-2 border-l-2 ${accent} bg-[var(--color-surface)] rounded-r-lg hover:bg-[var(--color-surface-hover,var(--color-border))] transition-colors`}
      data-testid="activity-feed-row"
    >
      {/* Timestamp */}
      <span
        className="text-[10px] font-mono-data text-[var(--color-text-muted)] shrink-0 w-14 text-right"
        title={entry.timestamp.toISOString()}
      >
        {formatTime(entry.timestamp)}
      </span>

      {/* Agent */}
      <span className="text-xs font-mono-data text-[var(--color-text-secondary)] truncate max-w-[120px] shrink-0">
        {entry.agent_id}
      </span>

      {/* Action */}
      <span className="text-xs text-[var(--color-text-dim)] truncate flex-1 min-w-0">
        {entry.action}
        {entry.capability && (
          <span className="ml-1 text-[10px] text-[var(--color-text-muted)]">({entry.capability})</span>
        )}
      </span>

      {/* Status badge */}
      <div className="shrink-0">
        <StatusBadge status={entry.status} size="sm" />
      </div>
    </li>
  );
});

const ActivityFeed = memo(function ActivityFeed({ entries, onViewAll }: ActivityFeedProps) {
  const recent = entries.slice(0, ACTIVITY_LIMIT);

  return (
    <section data-testid="activity-feed">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Recent Activity</h2>
          <p className="text-xs text-[var(--color-text-dim)]">
            Last {Math.min(ACTIVITY_LIMIT, entries.length)} of {entries.length} traffic event
            {entries.length !== 1 ? 's' : ''}
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

      {/* Feed list */}
      {recent.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center"
          data-testid="activity-feed-empty"
        >
          <p className="text-xs text-[var(--color-text-muted)]">No traffic events yet.</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Dispatch a task via Chat to see activity here.
          </p>
        </div>
      ) : (
        <ul className="space-y-1" aria-label="Recent traffic events">
          {recent.map((entry) => (
            <ActivityRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
});

export default ActivityFeed;
