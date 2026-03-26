import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import type { ApprovalRequest, ApprovalDecision } from '../types';
import { getEscalations } from '../api';
import ConfirmDialog from './ConfirmDialog';
import { SkeletonCard } from './SkeletonLoader';
import EmptyState from './EmptyState';
import RelativeTime from './RelativeTime';

type StatusFilter = 'all' | 'pending' | 'approved' | 'denied';
type SortOrder = 'newest' | 'oldest' | 'agent';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'denied', label: 'Denied' },
];

export default function ApprovalQueue() {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmAction, setConfirmAction] = useState<{ id: string; decision: ApprovalDecision } | null>(null);

  // Search / filter / sort state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortOrder>('newest');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getEscalations();
    if (res.ok && Array.isArray(res.data)) {
      // Map raw API objects to ApprovalRequest — Gateway may return ISO strings for timestamp
      const mapped: ApprovalRequest[] = res.data.map((item: unknown) => {
        const r = item as Record<string, unknown>;
        return {
          id: String(r['id'] ?? ''),
          task_id: String(r['task_id'] ?? ''),
          agent_id: String(r['agent_id'] ?? ''),
          action: String(r['action'] ?? ''),
          capability: r['capability'] != null ? String(r['capability']) : undefined,
          reason: String(r['reason'] ?? ''),
          policy_rule: r['policy_rule'] != null ? String(r['policy_rule']) : undefined,
          timestamp: r['timestamp'] instanceof Date
            ? r['timestamp']
            : new Date(String(r['timestamp'] ?? Date.now())),
          status: (r['status'] as ApprovalRequest['status']) ?? 'pending',
        };
      });
      setRequests(mapped);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleResolve() {
    if (!confirmAction) return;
    setRequests((prev) =>
      prev.map((r) =>
        r.id === confirmAction.id
          ? { ...r, status: confirmAction.decision === 'approve' ? 'approved' : 'rejected' as const }
          : r
      )
    );
    setConfirmAction(null);
  }

  // Filtering + sorting pipeline (derived, not state)
  const { sorted, isFiltered } = useMemo(() => {
    // 1. Status filter ('denied' maps to status === 'rejected')
    const statusFiltered =
      statusFilter === 'all'
        ? requests
        : statusFilter === 'denied'
          ? requests.filter((r) => r.status === 'rejected')
          : requests.filter((r) => r.status === statusFilter);

    // 2. Search filter
    const q = search.trim().toLowerCase();
    const searched = q
      ? statusFiltered.filter(
          (r) =>
            r.agent_id.toLowerCase().includes(q) ||
            r.action.toLowerCase().includes(q) ||
            (r.capability ?? '').toLowerCase().includes(q) ||
            (r.policy_rule ?? '').toLowerCase().includes(q),
        )
      : statusFiltered;

    // 3. Sort
    const result = [...searched].sort((a, b) => {
      if (sort === 'oldest')
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (sort === 'agent') return a.agent_id.localeCompare(b.agent_id);
      // newest first (default)
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    return {
      sorted: result,
      isFiltered: q !== '' || statusFilter !== 'all',
    };
  }, [requests, search, statusFilter, sort]);

  const countText =
    isFiltered
      ? `${sorted.length} of ${requests.length} shown`
      : `${requests.length} escalation${requests.length !== 1 ? 's' : ''}`;

  return (
    <div className="p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Approval Queue</h2>
        </div>
      </div>

      {/* Search + Sort row */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by agent, action, capability, policy…"
            data-testid="approval-search"
            className="w-full pl-8 pr-8 py-1.5 rounded-lg text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] text-sm pointer-events-none">
            ⌕
          </span>
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-dim)] hover:text-[var(--color-text)] text-sm transition-colors"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOrder)}
          data-testid="approval-sort"
          className="py-1.5 px-2 rounded-lg text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:border-emerald-500/50 transition-colors"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="agent">By agent</option>
        </select>
      </div>

      {/* Filter tabs + result count */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          {STATUS_TABS.map(({ key, label }) => (
            <button
              key={key}
              data-testid={`approval-filter-${key}`}
              onClick={() => setStatusFilter(key)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                statusFilter === key
                  ? 'bg-[var(--color-border)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {!loading && (
          <span
            data-testid="approval-count"
            className="text-xs text-[var(--color-text-dim)] font-mono-data"
          >
            {countText}
          </span>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          icon="✓"
          title="No pending approvals"
          description="Escalated actions from the policy engine will appear here."
        />
      ) : sorted.length === 0 ? (
        <div
          data-testid="approval-empty-filtered"
          className="flex flex-col items-center justify-center py-16 text-center"
        >
          <span className="text-2xl mb-3 opacity-40">⌕</span>
          <p className="text-sm font-medium text-[var(--color-text-dim)]">No matching escalations</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">Try adjusting your search or filter</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((req) => {
            const isResolved = req.status !== 'pending';
            return (
              <ApprovalCard
                key={req.id}
                request={req}
                resolved={isResolved}
                onApprove={isResolved ? undefined : () => setConfirmAction({ id: req.id, decision: 'approve' })}
                onReject={isResolved ? undefined : () => setConfirmAction({ id: req.id, decision: 'reject' })}
              />
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction?.decision === 'approve' ? 'Approve Action' : 'Reject Action'}
        message={`Are you sure you want to ${confirmAction?.decision} this escalated action?`}
        confirmLabel={confirmAction?.decision === 'approve' ? 'Approve' : 'Reject'}
        variant={confirmAction?.decision === 'reject' ? 'danger' : 'default'}
        onConfirm={handleResolve}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}

// Wrapped in React.memo — resolved cards don't need to re-render on data changes.
// Pending timers are handled by the shared RelativeTime interval (no parent tick needed).
const ApprovalCard = memo(function ApprovalCard({
  request,
  onApprove,
  onReject,
  resolved,
}: {
  request: ApprovalRequest;
  onApprove?: () => void;
  onReject?: () => void;
  resolved?: boolean;
}) {
  const statusColors: Record<string, string> = {
    pending: 'border-l-amber-500/60',
    approved: 'border-l-emerald-500/60',
    rejected: 'border-l-red-500/60',
  };

  return (
    <div
      className={`rounded-r-xl border border-[var(--color-border)] border-l-2 ${statusColors[request.status] ?? 'border-l-[var(--color-border)]'} bg-[var(--color-surface)] p-4 ${resolved ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono-data text-sm text-[var(--color-text)] truncate">{request.agent_id}</span>
            <span className="text-[10px] font-mono-data px-1.5 py-0.5 rounded bg-[var(--color-border)] text-[var(--color-text-secondary)] border border-[var(--color-border-strong)]">
              {request.action}
            </span>
          </div>
          <p className="text-xs text-[var(--color-text-dim)] mb-1">{request.reason}</p>
          {request.capability && (
            <p className="text-[10px] text-[var(--color-text-muted)]">
              capability: <span className="font-mono-data text-[var(--color-text-dim)]">{request.capability}</span>
            </p>
          )}
          {request.policy_rule && (
            <p className="text-[10px] text-[var(--color-text-muted)]">
              policy: <span className="font-mono-data text-[var(--color-text-dim)]">{request.policy_rule}</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!resolved && (
            <>
              <RelativeTime
                date={new Date(request.timestamp)}
                className="text-[10px] font-mono-data text-amber-400"
                data-testid="approval-card-timestamp"
              />
              <button
                onClick={onApprove}
                className="px-2.5 py-1 text-[10px] rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
              >
                Approve
              </button>
              <button
                onClick={onReject}
                className="px-2.5 py-1 text-[10px] rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Reject
              </button>
            </>
          )}
          {resolved && (
            <span
              className={`text-[10px] font-semibold uppercase ${request.status === 'approved' ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {request.status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
