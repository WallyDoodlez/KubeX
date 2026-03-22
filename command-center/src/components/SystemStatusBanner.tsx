import { useMemo } from 'react';
import type { ServiceHealth } from '../types';

interface SystemStatusBannerProps {
  services: ServiceHealth[];
  agentCount: number | null;
  kubexCount: number | null;
  loadingAgents: boolean;
}

type SystemState = 'loading' | 'operational' | 'degraded' | 'critical';

interface StatusConfig {
  state: SystemState;
  label: string;
  description: string;
  /** Tailwind classes for the banner background + border */
  bannerClass: string;
  /** Tailwind classes for the dot indicator */
  dotClass: string;
  /** Tailwind classes for the label text */
  textClass: string;
  /** Tailwind classes for the description text */
  descClass: string;
}

function deriveSystemState(services: ServiceHealth[]): SystemState {
  const nonLoading = services.filter((s) => s.status !== 'loading');
  if (nonLoading.length === 0) return 'loading';

  const downCount = nonLoading.filter((s) => s.status === 'down').length;
  const degradedCount = nonLoading.filter((s) => s.status === 'degraded').length;

  if (downCount >= 2) return 'critical';
  if (downCount === 1) return 'degraded';
  if (degradedCount > 0) return 'degraded';
  return 'operational';
}

function buildStatusConfig(state: SystemState, services: ServiceHealth[]): StatusConfig {
  const downServices = services.filter((s) => s.status === 'down').map((s) => s.name);
  const degradedServices = services.filter((s) => s.status === 'degraded').map((s) => s.name);

  switch (state) {
    case 'loading':
      return {
        state,
        label: 'Checking…',
        description: 'Running health checks on all services',
        bannerClass: 'bg-slate-500/8 border-slate-500/20',
        dotClass: 'bg-slate-400 animate-pulse',
        textClass: 'text-slate-300',
        descClass: 'text-slate-500',
      };
    case 'operational':
      return {
        state,
        label: 'All Systems Operational',
        description: `${services.filter((s) => s.status === 'healthy').length} of ${services.length} services healthy`,
        bannerClass: 'bg-emerald-500/8 border-emerald-500/20',
        dotClass: 'bg-emerald-400 animate-pulse',
        textClass: 'text-emerald-300',
        descClass: 'text-emerald-600',
      };
    case 'degraded': {
      const parts: string[] = [];
      if (downServices.length > 0) parts.push(`${downServices.join(', ')} down`);
      if (degradedServices.length > 0) parts.push(`${degradedServices.join(', ')} degraded`);
      return {
        state,
        label: `${downServices.length + degradedServices.length} Service${downServices.length + degradedServices.length > 1 ? 's' : ''} Degraded`,
        description: parts.join(' · '),
        bannerClass: 'bg-amber-500/8 border-amber-500/20',
        dotClass: 'bg-amber-400 animate-pulse',
        textClass: 'text-amber-300',
        descClass: 'text-amber-600',
      };
    }
    case 'critical': {
      const parts: string[] = [];
      if (downServices.length > 0) parts.push(`${downServices.join(', ')} down`);
      if (degradedServices.length > 0) parts.push(`${degradedServices.join(', ')} degraded`);
      return {
        state,
        label: 'System Critical',
        description: parts.join(' · ') || `${downServices.length} services down`,
        bannerClass: 'bg-red-500/10 border-red-500/25',
        dotClass: 'bg-red-400 animate-pulse',
        textClass: 'text-red-300',
        descClass: 'text-red-600',
      };
    }
  }
}

export default function SystemStatusBanner({
  services,
  agentCount,
  kubexCount,
  loadingAgents,
}: SystemStatusBannerProps) {
  const state = useMemo(() => deriveSystemState(services), [services]);
  const config = useMemo(() => buildStatusConfig(state, services), [state, services]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="System status"
      data-testid="system-status-banner"
      data-status={state}
      className={`
        flex items-center justify-between gap-4
        px-5 py-3 rounded-xl border mb-6
        ${config.bannerClass}
      `}
    >
      {/* Left: status indicator + label */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Animated status dot */}
        <span
          aria-hidden="true"
          className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${config.dotClass}`}
        />

        <div className="min-w-0">
          <span
            className={`text-sm font-semibold leading-none ${config.textClass}`}
          >
            {config.label}
          </span>
          {config.description && (
            <span className={`ml-2 text-xs ${config.descClass}`}>
              {config.description}
            </span>
          )}
        </div>
      </div>

      {/* Right: compact summary row — agents + kubexes */}
      <div
        className="flex items-center gap-4 flex-shrink-0 text-xs text-[var(--color-text-muted)]"
        aria-label="System summary"
      >
        <SummaryPill
          icon="◎"
          label="Agents"
          value={loadingAgents ? '…' : agentCount === null ? '—' : String(agentCount)}
          testId="status-banner-agent-count"
        />
        <SummaryPill
          icon="⬡"
          label="Kubexes"
          value={kubexCount === null ? '…' : String(kubexCount)}
          testId="status-banner-kubex-count"
        />
        <SummaryPill
          icon="◈"
          label="Services"
          value={`${services.filter((s) => s.status === 'healthy').length}/${services.length}`}
          testId="status-banner-service-count"
        />
      </div>
    </div>
  );
}

function SummaryPill({
  icon,
  label,
  value,
  testId,
}: {
  icon: string;
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5"
      aria-label={`${label}: ${value}`}
      data-testid={testId}
    >
      <span aria-hidden="true" className="text-[var(--color-text-dim)] text-xs">{icon}</span>
      <span className="text-[var(--color-text-dim)] font-medium">{label}</span>
      <span className="font-mono-data text-[var(--color-text-secondary)] font-semibold">{value}</span>
    </div>
  );
}
