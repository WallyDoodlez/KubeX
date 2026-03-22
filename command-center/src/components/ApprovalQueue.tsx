import { useState, useEffect } from 'react';
import type { ApprovalRequest, ApprovalDecision } from '../types';
import ConfirmDialog from './ConfirmDialog';

// Mock data since the Gateway doesn't have a dedicated escalations endpoint yet.
// In production, this would be fetched via getEscalations().
const MOCK_ESCALATIONS: ApprovalRequest[] = [];

export default function ApprovalQueue() {
  const [requests, setRequests] = useState<ApprovalRequest[]>(MOCK_ESCALATIONS);
  const [, setTick] = useState(0); // force re-render for time ticker
  const [confirmAction, setConfirmAction] = useState<{ id: string; decision: ApprovalDecision } | null>(null);

  // Tick every 10s to update "pending for Xs" timers
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(timer);
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
          <h2 className="text-sm font-semibold text-[#e2e8f0]">Approval Queue</h2>
          <p className="text-xs text-[#64748b]">
            {pending.length} pending · {resolved.length} resolved
          </p>
        </div>
      </div>

      {/* Pending approvals */}
      {pending.length === 0 && resolved.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#2a2f45] bg-[#1a1d27] p-12 text-center">
          <p className="text-3xl mb-3">✓</p>
          <p className="text-sm font-medium text-[#94a3b8]">No pending approvals</p>
          <p className="text-xs text-[#64748b] mt-1">
            Escalated actions from the policy engine will appear here for human review.
          </p>
        </div>
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
                <span className="text-[10px] uppercase tracking-widest text-[#3a3f5a] font-semibold">Resolved</span>
                <span className="flex-1 h-px bg-[#2a2f45]" />
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

function ApprovalCard({
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
  const pendingFor = Math.round((Date.now() - new Date(request.timestamp).getTime()) / 1000);
  const pendingText = pendingFor < 60 ? `${pendingFor}s` : `${Math.floor(pendingFor / 60)}m`;

  const statusColors = {
    pending: 'border-l-amber-500/60',
    approved: 'border-l-emerald-500/60',
    rejected: 'border-l-red-500/60',
  };

  return (
    <div className={`rounded-r-xl border border-[#2a2f45] border-l-2 ${statusColors[request.status]} bg-[#1a1d27] p-4 ${resolved ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono-data text-sm text-[#e2e8f0] truncate">{request.agent_id}</span>
            <span className="text-[10px] font-mono-data px-1.5 py-0.5 rounded bg-[#2a2f45] text-[#94a3b8] border border-[#3a3f5a]">
              {request.action}
            </span>
          </div>
          <p className="text-xs text-[#64748b] mb-1">{request.reason}</p>
          {request.capability && (
            <p className="text-[10px] text-[#3a3f5a]">
              capability: <span className="font-mono-data text-[#64748b]">{request.capability}</span>
            </p>
          )}
          {request.policy_rule && (
            <p className="text-[10px] text-[#3a3f5a]">
              policy: <span className="font-mono-data text-[#64748b]">{request.policy_rule}</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!resolved && (
            <>
              <span className="text-[10px] font-mono-data text-amber-400">{pendingText}</span>
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
}
