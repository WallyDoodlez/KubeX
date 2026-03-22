import { memo } from 'react';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

const STATUS_STYLES: Record<string, string> = {
  // Agent statuses
  running: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  busy: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  idle: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  stopped: 'bg-red-500/20 text-red-400 border-red-500/30',
  booting: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  credential_wait: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  ready: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  // Service health
  healthy: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  degraded: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  down: 'bg-red-500/20 text-red-400 border-red-500/30',
  loading: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  // Action statuses
  allowed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  denied: 'bg-red-500/20 text-red-400 border-red-500/30',
  escalated: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  pending: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  // Container statuses
  created: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  error: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const STATUS_DOT: Record<string, string> = {
  running: 'bg-emerald-400',
  healthy: 'bg-emerald-400',
  allowed: 'bg-emerald-400',
  busy: 'bg-amber-400',
  degraded: 'bg-amber-400',
  escalated: 'bg-amber-400',
  idle: 'bg-slate-400',
  loading: 'bg-slate-400',
  stopped: 'bg-red-400',
  booting: 'bg-cyan-400',
  credential_wait: 'bg-amber-400',
  ready: 'bg-emerald-400',
  down: 'bg-red-400',
  denied: 'bg-red-400',
  error: 'bg-red-400',
  created: 'bg-blue-400',
  pending: 'bg-blue-400',
};

// Wrapped in React.memo — StatusBadge is used in every row/card and re-renders
// on every poll tick (every 10s). Memo prevents re-renders when status+size are unchanged.
const StatusBadge = memo(function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const key = status.toLowerCase();
  const style = STATUS_STYLES[key] ?? 'bg-slate-500/20 text-slate-400 border-slate-500/30';
  const dot = STATUS_DOT[key] ?? 'bg-slate-400';
  const sizeClass = size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-xs';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-mono-data font-medium ${sizeClass} ${style}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${key === 'loading' ? 'animate-pulse' : ''}`} />
      {status}
    </span>
  );
});

export default StatusBadge;
