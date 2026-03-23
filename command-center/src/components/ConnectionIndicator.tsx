import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import type { SystemStatus } from '../context/AppContext';
import RefreshCountdown from './RefreshCountdown';

// ── Helpers ──────────────────────────────────────────────────────────

function statusColor(status: SystemStatus): string {
  switch (status) {
    case 'operational': return 'bg-emerald-400';
    case 'degraded':    return 'bg-amber-400';
    case 'critical':    return 'bg-red-400';
    default:            return 'bg-slate-400 animate-pulse';
  }
}

function statusLabel(status: SystemStatus): string {
  switch (status) {
    case 'operational': return 'All systems operational';
    case 'degraded':    return 'System degraded';
    case 'critical':    return 'System critical';
    default:            return 'Checking…';
  }
}

function statusTextColor(status: SystemStatus): string {
  switch (status) {
    case 'operational': return 'text-emerald-400';
    case 'degraded':    return 'text-amber-400';
    case 'critical':    return 'text-red-400';
    default:            return 'text-slate-400';
  }
}

function serviceStatusIcon(s: string): string {
  switch (s) {
    case 'healthy':  return '●';
    case 'degraded': return '◐';
    case 'down':     return '○';
    default:         return '◌';
  }
}

function serviceStatusColor(s: string): string {
  switch (s) {
    case 'healthy':  return 'text-emerald-400';
    case 'degraded': return 'text-amber-400';
    case 'down':     return 'text-red-400';
    default:         return 'text-slate-400';
  }
}

// ── Component ────────────────────────────────────────────────────────

/**
 * ConnectionIndicator
 *
 * A persistent top-bar widget that shows aggregate system health as a
 * colored dot + short label. On hover/click it opens a popover listing
 * each service's individual status so operators can see which services
 * are up/down without navigating to the Dashboard.
 */
/** 15 s — must stay in sync with HEALTH_INTERVAL in useHealthCheck.ts */
const HEALTH_INTERVAL = 15_000;

export default function ConnectionIndicator() {
  const { services, systemStatus, lastHealthPollAt } = useAppContext();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
    } else {
      document.removeEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open, handleOutsideClick]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const dotClass = statusColor(systemStatus);
  const label = statusLabel(systemStatus);
  const textClass = statusTextColor(systemStatus);

  const downCount = services.filter((s) => s.status === 'down').length;
  const degradedCount = services.filter((s) => s.status === 'degraded').length;

  return (
    <div ref={containerRef} className="relative">
      <button
        data-testid="connection-indicator"
        aria-label={`System health: ${label}. Click for details.`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 text-xs font-mono-data ${textClass} hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-dark)] rounded px-1 py-0.5`}
      >
        {/* Status dot with countdown ring overlay */}
        <span className="relative inline-flex items-center justify-center flex-shrink-0" style={{ width: 16, height: 16 }}>
          {/* Countdown ring — sits behind the dot */}
          <RefreshCountdown
            interval={HEALTH_INTERVAL}
            lastPolledAt={lastHealthPollAt}
            size={16}
            strokeWidth={2}
            className={`absolute inset-0 ${textClass}`}
          />
          {/* Status dot — centered on top of ring */}
          <span
            data-testid="connection-indicator-dot"
            aria-hidden="true"
            className={`h-2 w-2 rounded-full flex-shrink-0 ${dotClass}`}
            data-status={systemStatus}
          />
        </span>
        <span className="hidden sm:inline" data-testid="connection-indicator-label">
          {systemStatus === 'loading'
            ? 'checking'
            : systemStatus === 'operational'
              ? 'live'
              : downCount > 0
                ? `${downCount} down`
                : degradedCount > 0
                  ? `${degradedCount} degraded`
                  : label}
        </span>
      </button>

      {/* Popover */}
      {open && (
        <div
          role="tooltip"
          data-testid="connection-indicator-popover"
          className="absolute right-0 top-full mt-2 z-50 w-64 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-dark)] shadow-xl shadow-black/40 overflow-hidden"
        >
          {/* Header */}
          <div className={`px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2`}>
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full flex-shrink-0 ${dotClass}`}
            />
            <p className={`text-sm font-semibold ${textClass}`}>{label}</p>
          </div>

          {/* Service list */}
          <ul role="list" className="py-2" aria-label="Individual service statuses">
            {services.map((svc) => (
              <li
                key={svc.name}
                data-testid={`service-status-row-${svc.name.toLowerCase()}`}
                className="flex items-center justify-between px-4 py-1.5 hover:bg-[var(--color-surface)] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`text-xs ${serviceStatusColor(svc.status)}`}
                  >
                    {serviceStatusIcon(svc.status)}
                  </span>
                  <span className="text-xs text-[var(--color-text-secondary)] font-medium">
                    {svc.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-right">
                  <span className={`text-xs font-mono-data capitalize ${serviceStatusColor(svc.status)}`}>
                    {svc.status}
                  </span>
                  {svc.responseTime !== null && (
                    <span className="text-[10px] text-[var(--color-text-muted)] font-mono-data">
                      {Math.round(svc.responseTime)}ms
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-[var(--color-border)]">
            <p className="text-[10px] text-[var(--color-text-muted)]">
              Refreshes every 15s · See Dashboard for full details
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
