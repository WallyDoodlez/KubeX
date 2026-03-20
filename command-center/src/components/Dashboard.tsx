import { useEffect, useState, useCallback } from 'react';
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

const REFRESH_INTERVAL = 10_000;

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
    }
    setLoadingAgents(false);
  }, []);

  const loadKubexes = useCallback(async () => {
    const res = await getKubexes();
    if (res.ok && Array.isArray(res.data)) {
      setKubexCount(res.data.length);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    loadAgents();
    loadKubexes();
    const interval = setInterval(() => {
      checkHealth();
      loadAgents();
      loadKubexes();
    }, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [checkHealth, loadAgents, loadKubexes]);

  const servicesUp = services.filter((s) => s.status === 'healthy').length;
  const servicesDown = services.filter((s) => s.status === 'down').length;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
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
        />
        <StatCard
          label="Running Kubexes"
          value={kubexCount === null ? '…' : String(kubexCount)}
          accent="purple"
          icon="⬡"
        />
      </div>

      {/* Service health grid */}
      <section>
        <SectionHeader title="Service Health" subtitle={`Auto-refresh every ${REFRESH_INTERVAL / 1000}s`} />
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
          <div className="flex items-center gap-2 text-sm text-[#64748b] py-4">
            <span className="animate-pulse">Loading agents…</span>
          </div>
        ) : agents.length === 0 ? (
          <EmptyState message="No agents registered. Start agents with docker compose up." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {agents.map((agent) => (
              <AgentCard key={agent.agent_id} agent={agent} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent: 'emerald' | 'red' | 'blue' | 'purple' | 'slate';
  icon: string;
}) {
  const accentColors = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    red: 'text-red-400 bg-red-500/10 border-red-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    slate: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
  };

  return (
    <div className="rounded-xl border border-[#2a2f45] bg-[#1a1d27] p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[#64748b] font-medium uppercase tracking-wide">{label}</span>
        <span className={`text-xs rounded-full p-1 border ${accentColors[accent]}`}>{icon}</span>
      </div>
      <p className={`text-2xl font-bold font-mono-data ${accentColors[accent].split(' ')[0]}`}>
        {value}
      </p>
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
        <h2 className="text-sm font-semibold text-[#e2e8f0]">{title}</h2>
        {subtitle && <p className="text-xs text-[#64748b]">{subtitle}</p>}
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
    <div className="rounded-xl border border-[#2a2f45] bg-[#1a1d27] p-4 hover:border-[#3a3f5a] transition-colors">
      <div className="flex items-start justify-between mb-2">
        <p className="font-mono-data text-sm font-semibold text-[#e2e8f0] truncate mr-2">
          {agent.agent_id}
        </p>
        <StatusBadge status={agent.status} />
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        {agent.capabilities.map((cap) => (
          <span
            key={cap}
            className="text-[10px] font-mono-data px-1.5 py-0.5 rounded bg-[#2a2f45] text-[#94a3b8] border border-[#3a3f5a]"
          >
            {cap}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-[#3a3f5a]">
        boundary: <span className="text-[#64748b]">{agent.boundary}</span>
      </p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#2a2f45] bg-[#1a1d27] p-8 text-center">
      <p className="text-sm text-[#64748b]">{message}</p>
    </div>
  );
}
