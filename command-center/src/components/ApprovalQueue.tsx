import { useState, useEffect, memo } from 'react';
import type { ApprovalRequest, ApprovalDecision } from '../types';
import ConfirmDialog from './ConfirmDialog';
import { SkeletonCard } from './SkeletonLoader';
import EmptyState from './EmptyState';
import RelativeTime from './RelativeTime';

// Mock data since the Gateway doesn't have a dedicated escalations endpoint yet.
// In production, this would be fetched via getEscalations().
const MOCK_ESCALATIONS: ApprovalRequest[] = [];

export default function ApprovalQueue() {
  const [requests, setRequests] = useState<ApprovalRequest[]>(MOCK_ESCALATIONS);
  const [loading, setLoading] = useState(true);
  const [confirmAction, setConfirmAction] = useState<{ id: string; decision: ApprovalDecision } | null>(null);

  // Simulate initial load — in production this would call getEscalations()
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 0);
    return () => clearTimeout(t);
  }, []);

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

  const pending = requests.filter((r) => r.status === 'pending');
  const resolved = requests.filter((r) => r.status !== 'pending');

  return (
    <div className="p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Approval Queue</h2>
          <p className="text-xs text-[var(--color-text-dim)]">
            {pending.length} pending · {resolved.length} resolved
          </p>
        </div>
      </div>

      {/* Pending approvals */}
      {loading ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : pending.length === 0 && resolved.length === 0 ? (
        <EmptyState
          icon="✓"
          title="No pending approvals"
          description="Escalated actions from the policy engine will appear here."
        />
      ) : (
        <div className="space-y-3">
          {pending.map((req) => (
            <ApprovalCard
              key={req.id}
              request={req}
              onApprove={() => setConfirmAction({ id: req.id, decision: 'approve' })}
              onReject={() => setConfirmAction({ id: req.id, decision: 'reject' })}
            />
          ))}

          {resolved.length > 0 && (
            <>
              <div className="flex items-center gap-2 mt-6 mb-2">
                <span className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] font-semibold">Resolved</span>
                <span className="flex-1 h-px bg-[var(--color-border)]" />
              </div>
              {resolved.map((req) => (
                <ApprovalCard key={req.id} request={req} resolved />
              ))}
            </>
          )}
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
  const statusColors = {
    pending: 'border-l-amber-500/60',
    approved: 'border-l-emerald-500/60',
    rejected: 'border-l-red-500/60',
  };

  return (
    <div className={`rounded-r-xl border border-[var(--color-border)] border-l-2 ${statusColors[request.status]} bg-[var(--color-surface)] p-4 ${resolved ? 'opacity-60' : ''}`}>
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
            <span className={`text-[10px] font-semibold uppercase ${request.status === 'approved' ? 'text-emerald-400' : 'text-red-400'}`}>
              {request.status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
