import { useState, useCallback } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useTimeSeries } from '../hooks/useTimeSeries';
import type { ServiceHealth, Agent, NavPage } from '../types';
import {
  getGatewayHealth,
  getRegistryHealth,
  getManagerHealth,
  getBrokerHealth,
  getAgents,
  getKubexes,
} from '../api';
import ServiceCard from './ServiceCard';
import StatusBadge from './StatusBadge';
import Sparkline from './Sparkline';
import { SkeletonCard } from './SkeletonLoader';
import EmptyState from './EmptyState';
import SystemStatusBanner from './SystemStatusBanner';

const REFRESH_INTERVAL = 10_000;
const AGENT_DISPLAY_LIMIT = 6;

interface DashboardProps {
  onNavigate: (page: NavPage) => void;
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const [services, setServices] = useState<ServiceHealth[]>([
    { name: 'Gateway', url: 'localhost:8080', status: 'loading', responseTime: null, lastChecked: null },
    { name: 'Registry', url: 'localhost:8070', status: 'loading', responseTime: null, lastChecked: null },
    { name: 'Manager', url: 'localhost:8090', status: 'loading', responseTime: null, lastChecked: null },
    { name: 'Broker', url: 'internal', status: 'loading', responseTime: null, lastChecked: null },
    { name: 'Redis', url: 'localhost:6379', status: 'loading', responseTime: null, lastChecked: null },
  ]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [kubexCount, setKubexCount] = useState<number | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const agentSeries = useTimeSeries({ maxPoints: 20 });
  const kubexSeries = useTimeSeries({ maxPoints: 20 });

  const checkHealth = useCallback(async () => {
    const checks = [
      { name: 'Gateway', fn: getGatewayHealth },
      { name: 'Registry', fn: getRegistryHealth },
      { name: 'Manager', fn: getManagerHealth },
      { name: 'Broker', fn: getBrokerHealth },
    ];

    const results = await Promise.all(checks.map(async ({ name, fn }) => {
      const res = await fn();
      return {
        name,
        status: (res.ok ? 'healthy' : res.status === 0 ? 'down' : 'degraded') as ServiceHealth['status'],
        responseTime: res.responseTime,
        lastChecked: new Date(),
        detail: res.error ?? (res.data as { status?: string } | null)?.status ?? undefined,
      };
    }));

    // Redis — infer from Gateway health (if gateway is up, redis is probably up too)
    // We don't have a direct Redis endpoint from the browser, so we mark it based on gateway
    const gatewayUp = results[0].status === 'healthy';
    const redisEntry: Partial<ServiceHealth> = {
      name: 'Redis',
      status: gatewayUp ? 'healthy' : 'down',
      responseTime: null,
      lastChecked: new Date(),
      detail: 'inferred from Gateway',
    };

    setServices((prev) =>
      prev.map((s) => {
        const found = results.find((r) => r.name === s.name);
        if (found) return { ...s, ...found };
        if (s.name === 'Redis') return { ...s, ...redisEntry };
        return s;
      }),
    );
  }, []);

  const loadAgents = useCallback(async () => {
    setLoadingAgents(true);
    const res = await getAgents();
    if (res.ok && Array.isArray(res.data)) {
      setAgents(res.data);
      // agentSeries.push is intentionally omitted from deps: useTimeSeries returns a
      // ref-based push function whose identity is stable across renders (never changes),
      // so including it would not affect correctness and would add unnecessary noise.
      agentSeries.push(res.data.length);
    }
    setLoadingAgents(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadKubexes = useCallback(async () => {
    const res = await getKubexes();
    if (res.ok && Array.isArray(res.data)) {
      setKubexCount(res.data.length);
      // kubexSeries.push is intentionally omitted from deps — same reason as agentSeries.push above.
      kubexSeries.push(res.data.length);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pollAll = useCallback(() => {
    checkHealth();
    loadAgents();
    loadKubexes();
    setLastUpdated(new Date());
  }, [checkHealth, loadAgents, loadKubexes]);

  usePolling(pollAll, { interval: REFRESH_INTERVAL, immediate: true, pauseOnHidden: true, maxBackoff: 4 });

  const servicesUp = services.filter((s) => s.status === 'healthy').length;
  const servicesDown = services.filter((s) => s.status === 'down').length;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* System Status Banner */}
      <SystemStatusBanner
        services={services}
        agentCount={agents.length}
        kubexCount={kubexCount}
        loadingAgents={loadingAgents}
      />

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Services Up"
          value={`${servicesUp} / ${services.length}`}
          accent="emerald"
          icon="◈"
        />
        <StatCard
          label="Services Down"
          value={String(servicesDown)}
          accent={servicesDown > 0 ? 'red' : 'slate'}
          icon="⚠"
        />
        <StatCard
          label="Registered Agents"
          value={loadingAgents ? '…' : String(agents.length)}
          accent="blue"
          icon="◎"
          onClick={() => onNavigate('agents')}
          sparklineValues={agentSeries.values}
        />
        <StatCard
          label="Running Kubexes"
          value={kubexCount === null ? '…' : String(kubexCount)}
          accent="purple"
          icon="⬡"
          onClick={() => onNavigate('containers')}
          sparklineValues={kubexSeries.values}
        />
      </div>

      {/* Service health grid */}
      <section>
        <SectionHeader
          title="Service Health"
          subtitle={`Last updated ${timeAgo(lastUpdated)} · Auto-refresh every ${REFRESH_INTERVAL / 1000}s`}
        />
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {services.map((s) => (
            <ServiceCard key={s.name} service={s} />
          ))}
        </div>
      </section>

      {/* Agent overview */}
      <section>
        <SectionHeader
          title="Registered Agents"
          subtitle={`${agents.length} agents in registry`}
          action={{ label: 'View all →', onClick: () => onNavigate('agents') }}
        />
        {loadingAgents ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : agents.length === 0 ? (
          <EmptyState
            icon="◎"
            title="No agents registered"
            description="No agents registered. Start agents with docker compose up."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {agents.slice(0, AGENT_DISPLAY_LIMIT).map((agent) => (
              <AgentCard key={agent.agent_id} agent={agent} />
            ))}
            {agents.length > AGENT_DISPLAY_LIMIT && (
              <button
                onClick={() => onNavigate('agents')}
                className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex items-center justify-center text-sm text-emerald-400 hover:text-emerald-300 hover:border-[var(--color-border-strong)] transition-colors"
              >
                +{agents.length - AGENT_DISPLAY_LIMIT} more →
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function timeAgo(date: Date | null): string {
  if (!date) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

// ── Sub-components ───────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
  icon,
  onClick,
  sparklineValues,
}: {
  label: string;
  value: string;
  accent: 'emerald' | 'red' | 'blue' | 'purple' | 'slate';
  icon: string;
  onClick?: () => void;
  sparklineValues?: number[];
}) {
  const accentColors = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    red: 'text-red-400 bg-red-500/10 border-red-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    slate: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
  };
  const sparklineColorMap = {
    emerald: '#34d399',
    red: '#f87171',
    blue: '#60a5fa',
    purple: '#a78bfa',
    slate: '#94a3b8',
  };

  return (
    <div
      className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 ${onClick ? 'cursor-pointer hover:border-[var(--color-border-strong)] transition-colors' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--color-text-dim)] font-medium uppercase tracking-wide">{label}</span>
        <span className={`text-xs rounded-full p-1 border ${accentColors[accent]}`}>{icon}</span>
      </div>
      <p className={`text-2xl font-bold font-mono-data ${accentColors[accent].split(' ')[0]}`}>
        {value}
      </p>
      {sparklineValues && sparklineValues.length > 1 && (
        <div className="mt-2">
          <Sparkline values={sparklineValues} width={160} height={24} color={sparklineColorMap[accent]} />
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text)]">{title}</h2>
        {subtitle && <p className="text-xs text-[var(--color-text-dim)]">{subtitle}</p>}
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-border-strong)] transition-colors">
      <div className="flex items-start justify-between mb-2">
        <p className="font-mono-data text-sm font-semibold text-[var(--color-text)] truncate mr-2">
          {agent.agent_id}
        </p>
        <StatusBadge status={agent.status} />
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        {agent.capabilities.map((cap) => (
          <span
            key={cap}
            className="text-[10px] font-mono-data px-1.5 py-0.5 rounded bg-[var(--color-border)] text-[var(--color-text-secondary)] border border-[var(--color-border-strong)]"
          >
            {cap}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-[var(--color-text-muted)]">
        boundary: <span className="text-[var(--color-text-dim)]">{agent.boundary}</span>
      </p>
    </div>
  );
}
