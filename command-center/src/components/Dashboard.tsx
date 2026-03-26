import { useState, useCallback } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useTimeSeries } from '../hooks/useTimeSeries';
import { useCollapsible } from '../hooks/useCollapsible';
import { useFavorites } from '../hooks/useFavorites';
import type { Agent, Kubex, NavPage, TrafficEntry } from '../types';
import { getAgents, getKubexes } from '../api';
import { useAppContext } from '../context/AppContext';
import ServiceCard from './ServiceCard';
import StatusBadge from './StatusBadge';
import Sparkline from './Sparkline';
import { SkeletonCard } from './SkeletonLoader';
import EmptyState from './EmptyState';
import SystemStatusBanner from './SystemStatusBanner';
import ActivityFeed from './ActivityFeed';
import CollapsibleSection from './CollapsibleSection';
import KubexStatusChart from './KubexStatusChart';

const REFRESH_INTERVAL = 15_000; // Match global health check interval
const AGENT_DISPLAY_LIMIT = 6;

interface DashboardProps {
  onNavigate: (page: NavPage) => void;
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  // Read service health and traffic log from context — health managed globally by useHealthCheck in Layout
  const { services, trafficLog } = useAppContext();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [kubexes, setKubexes] = useState<Kubex[]>([]);
  const [kubexCount, setKubexCount] = useState<number | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const agentSeries = useTimeSeries({ maxPoints: 20 });
  const kubexSeries = useTimeSeries({ maxPoints: 20 });

  const { isCollapsed, toggle } = useCollapsible('kubex-dashboard-sections');
  const { favoritesSet } = useFavorites();

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
      setKubexes(res.data);
      setKubexCount(res.data.length);
      // kubexSeries.push is intentionally omitted from deps — same reason as agentSeries.push above.
      kubexSeries.push(res.data.length);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pollAll = useCallback(() => {
    loadAgents();
    loadKubexes();
    setLastUpdated(new Date());
  }, [loadAgents, loadKubexes]);

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
          sparklineLabel="Agent count"
        />
        <StatCard
          label="Running Kubexes"
          value={kubexCount === null ? '…' : String(kubexCount)}
          accent="purple"
          icon="⬡"
          onClick={() => onNavigate('containers')}
          sparklineValues={kubexSeries.values}
          sparklineLabel="Kubex count"
        />
      </div>

      {/* Kubex status chart */}
      <CollapsibleSection
        sectionId="kubex-status"
        title="Kubex Status"
        subtitle={kubexCount === null ? 'Loading…' : `${kubexCount} kubexes total`}
        action={{ label: 'View all →', onClick: () => onNavigate('containers') }}
        collapsed={isCollapsed('kubex-status')}
        onToggle={() => toggle('kubex-status')}
      >
        <KubexStatusChart kubexes={kubexes} />
      </CollapsibleSection>

      {/* Service health grid */}
      <CollapsibleSection
        sectionId="service-health"
        title="Service Health"
        subtitle={`Last updated ${timeAgo(lastUpdated)} · Auto-refresh every ${REFRESH_INTERVAL / 1000}s`}
        collapsed={isCollapsed('service-health')}
        onToggle={() => toggle('service-health')}
      >
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {services.map((s) => (
            <ServiceCard key={s.name} service={s} />
          ))}
        </div>
      </CollapsibleSection>

      {/* Agent overview */}
      <CollapsibleSection
        sectionId="registered-agents"
        title="Registered Agents"
        subtitle={`${agents.length} agents in registry`}
        action={{ label: 'View all →', onClick: () => onNavigate('agents') }}
        collapsed={isCollapsed('registered-agents')}
        onToggle={() => toggle('registered-agents')}
      >
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
          (() => {
            // Sort pinned agents to the top of the dashboard grid
            const sortedForDashboard = agents.slice().sort((a, b) => {
              const aFav = favoritesSet.has(a.agent_id) ? 0 : 1;
              const bFav = favoritesSet.has(b.agent_id) ? 0 : 1;
              return aFav - bFav;
            });
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {sortedForDashboard.slice(0, AGENT_DISPLAY_LIMIT).map((agent) => (
                  <AgentCard
                    key={agent.agent_id}
                    agent={agent}
                    pinned={favoritesSet.has(agent.agent_id)}
                  />
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
            );
          })()
        )}
      </CollapsibleSection>

      {/* Recent Tasks */}
      <RecentTasksCard trafficLog={trafficLog} onNavigate={onNavigate} />

      {/* Recent Activity Feed */}
      <CollapsibleSection
        sectionId="activity-feed"
        title="Recent Activity"
        subtitle={`${trafficLog.length} events`}
        action={{ label: 'View all →', onClick: () => onNavigate('traffic') }}
        collapsed={isCollapsed('activity-feed')}
        onToggle={() => toggle('activity-feed')}
      >
        <ActivityFeed
          entries={trafficLog}
          onViewAll={() => onNavigate('traffic')}
          hideHeader
        />
      </CollapsibleSection>
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
  sparklineLabel,
}: {
  label: string;
  value: string;
  accent: 'emerald' | 'red' | 'blue' | 'purple' | 'slate';
  icon: string;
  onClick?: () => void;
  sparklineValues?: number[];
  sparklineLabel?: string;
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
          {sparklineLabel && (
            <p className="text-[10px] text-[var(--color-text-dim)] mt-0.5" data-testid="sparkline-label">{sparklineLabel}</p>
          )}
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

// ── Recent Tasks Card ─────────────────────────────────────────────────

const RECENT_TASKS_LIMIT = 5;

const STATUS_BADGE_CLASSES: Record<string, string> = {
  allowed:   'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  denied:    'bg-red-500/15 text-red-400 border-red-500/30',
  escalated: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  pending:   'bg-slate-500/15 text-slate-400 border-slate-500/30',
};

function relativeTime(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function RecentTasksCard({
  trafficLog,
  onNavigate,
}: {
  trafficLog: TrafficEntry[];
  onNavigate: (page: NavPage) => void;
}) {
  // Most-recent first, take up to 5
  const recentTasks = trafficLog.slice().sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, RECENT_TASKS_LIMIT);

  return (
    <div
      data-testid="recent-tasks-card"
      className="rounded-xl border border-[var(--color-border)] bg-gray-800 p-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Recent Tasks</h2>
          <p className="text-xs text-[var(--color-text-dim)]">Last {RECENT_TASKS_LIMIT} dispatched tasks</p>
        </div>
        <button
          onClick={() => onNavigate('tasks')}
          className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
          data-testid="recent-tasks-view-all"
        >
          View all →
        </button>
      </div>

      {recentTasks.length === 0 ? (
        <p
          data-testid="recent-tasks-empty"
          className="text-xs text-[var(--color-text-muted)] py-4 text-center"
        >
          No tasks dispatched yet.
        </p>
      ) : (
        <div className="space-y-2">
          {recentTasks.map((entry) => (
            <div
              key={entry.id}
              data-testid="recent-task-row"
              className="flex items-center gap-2 py-1.5 border-b border-[var(--color-border)] last:border-0"
            >
              {/* Task ID */}
              <span className="font-mono-data text-[11px] text-[var(--color-text-dim)] truncate w-28 flex-shrink-0">
                {entry.id.length > 12 ? `${entry.id.slice(0, 12)}…` : entry.id}
              </span>

              {/* Capability badge */}
              {entry.capability && (
                <span className="text-[10px] font-mono-data px-1.5 py-0.5 rounded bg-[var(--color-border)] text-[var(--color-text-secondary)] border border-[var(--color-border-strong)] flex-shrink-0">
                  {entry.capability}
                </span>
              )}

              {/* Status badge */}
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${STATUS_BADGE_CLASSES[entry.status] ?? STATUS_BADGE_CLASSES['pending']}`}
              >
                {entry.status}
              </span>

              {/* Timestamp — push to right */}
              <span className="ml-auto text-[10px] text-[var(--color-text-muted)] whitespace-nowrap flex-shrink-0">
                {relativeTime(entry.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent, pinned }: { agent: Agent; pinned?: boolean }) {
  return (
    <div className={`rounded-xl border bg-[var(--color-surface)] p-4 hover:border-[var(--color-border-strong)] transition-colors ${pinned ? 'border-amber-500/30' : 'border-[var(--color-border)]'}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0 mr-2">
          {pinned && <span className="text-amber-400 text-xs flex-shrink-0" aria-label="Pinned">★</span>}
          <p className="font-mono-data text-sm font-semibold text-[var(--color-text)] truncate">
            {agent.agent_id}
          </p>
        </div>
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
