import React, { useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import type { TrafficEntry } from '../types';

interface AgentTaskMetricsProps {
  agentId: string;
}

// ── Status badge colours ──────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  allowed:   { bg: 'bg-emerald-500/15', text: 'text-emerald-400',                border: 'border-emerald-500/30' },
  denied:    { bg: 'bg-red-500/15',     text: 'text-red-400',                    border: 'border-red-500/30' },
  escalated: { bg: 'bg-yellow-500/15',  text: 'text-yellow-400',                 border: 'border-yellow-500/30' },
  pending:   { bg: 'bg-blue-500/15',    text: 'text-blue-400',                   border: 'border-blue-500/30' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { bg: 'bg-[var(--color-border)]', text: 'text-[var(--color-text-muted)]', border: 'border-[var(--color-border-strong)]' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border ${s.bg} ${s.text} ${s.border}`}>
      {status}
    </span>
  );
}

// ── Capability bar ────────────────────────────────────────────────────

function CapabilityBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3" data-testid="capability-bar">
      <span className="w-32 shrink-0 text-xs font-mono-data text-[var(--color-text-secondary)] truncate">
        {label}
      </span>
      <div className="flex-1 h-2 rounded-full bg-[var(--color-border)] overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-500/60 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-6 text-right text-[10px] text-[var(--color-text-muted)]">{count}</span>
    </div>
  );
}

// ── Recent failure row ────────────────────────────────────────────────

function FailureRow({ entry }: { entry: TrafficEntry }) {
  const ts = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp as unknown as string);
  return (
    <div
      className="flex items-start gap-3 py-2.5 border-b border-[var(--color-border)] last:border-0"
      data-testid="failure-row"
    >
      <StatusBadge status={entry.status} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono-data text-[var(--color-text-secondary)] truncate">
          {entry.capability ?? entry.action}
        </p>
        {entry.policy_rule && (
          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
            Rule: {entry.policy_rule}
          </p>
        )}
      </div>
      <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 whitespace-nowrap">
        {ts.toLocaleString()}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────

const AgentTaskMetrics = React.memo(function AgentTaskMetrics({ agentId }: AgentTaskMetricsProps) {
  const { trafficLog } = useAppContext();

  const agentEntries = useMemo(
    () => trafficLog.filter((e) => e.agent_id === agentId),
    [trafficLog, agentId],
  );

  const metrics = useMemo(() => {
    const total     = agentEntries.length;
    const allowed   = agentEntries.filter((e) => e.status === 'allowed').length;
    const denied    = agentEntries.filter((e) => e.status === 'denied').length;
    const escalated = agentEntries.filter((e) => e.status === 'escalated').length;
    const pending   = agentEntries.filter((e) => e.status === 'pending').length;
    const successPct = total > 0 ? Math.round((allowed / total) * 100) : 0;
    return { total, allowed, denied, escalated, pending, successPct };
  }, [agentEntries]);

  const capBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of agentEntries) {
      const key = e.capability ?? e.action ?? 'unknown';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8); // top 8
  }, [agentEntries]);

  const maxCapCount = capBreakdown.length > 0 ? capBreakdown[0][1] : 1;

  const recentFailures = useMemo(() => {
    return agentEntries
      .filter((e) => e.status === 'denied' || e.status === 'escalated')
      .sort((a, b) => {
        const ta = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp as unknown as string).getTime();
        const tb = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp as unknown as string).getTime();
        return tb - ta;
      })
      .slice(0, 5);
  }, [agentEntries]);

  // ── Empty state ────────────────────────────────────────────────────

  if (metrics.total === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]"
        data-testid="task-metrics-empty"
      >
        <p className="text-sm">No task history recorded for this agent.</p>
        <p className="text-[10px] mt-1">Task traffic will appear here once the agent processes requests.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="agent-task-metrics">

      {/* ── Hero stat card ─────────────────────────────────────────── */}
      <div
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        data-testid="task-metrics-hero"
      >
        <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-3">
          Task Summary
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[var(--color-text)]" data-testid="metric-total">
            {metrics.total} total
          </span>
          <span className="text-[var(--color-text-muted)]">·</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${STATUS_STYLES.allowed.bg} ${STATUS_STYLES.allowed.text} ${STATUS_STYLES.allowed.border}`} data-testid="metric-allowed">
            {metrics.allowed} allowed ({metrics.successPct}%)
          </span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${STATUS_STYLES.denied.bg} ${STATUS_STYLES.denied.text} ${STATUS_STYLES.denied.border}`} data-testid="metric-denied">
            {metrics.denied} denied
          </span>
          {metrics.escalated > 0 && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${STATUS_STYLES.escalated.bg} ${STATUS_STYLES.escalated.text} ${STATUS_STYLES.escalated.border}`} data-testid="metric-escalated">
              {metrics.escalated} escalated
            </span>
          )}
          {metrics.pending > 0 && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${STATUS_STYLES.pending.bg} ${STATUS_STYLES.pending.text} ${STATUS_STYLES.pending.border}`} data-testid="metric-pending">
              {metrics.pending} pending
            </span>
          )}
        </div>
      </div>

      {/* ── Capability breakdown ────────────────────────────────────── */}
      {capBreakdown.length > 0 && (
        <div
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          data-testid="capability-breakdown"
        >
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-3">
            Capability Breakdown
          </p>
          <div className="space-y-2.5">
            {capBreakdown.map(([cap, count]) => (
              <CapabilityBar key={cap} label={cap} count={count} max={maxCapCount} />
            ))}
          </div>
        </div>
      )}

      {/* ── Recent failures ─────────────────────────────────────────── */}
      {recentFailures.length > 0 && (
        <div
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          data-testid="recent-failures"
        >
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-3">
            Recent Failures
          </p>
          <div>
            {recentFailures.map((entry) => (
              <FailureRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export default AgentTaskMetrics;
