import { memo, useEffect, useState, useRef } from 'react';
import type { ServiceHealth } from '../types';
import StatusBadge from './StatusBadge';
import { useTimeSeries } from '../hooks/useTimeSeries';
import Sparkline from './Sparkline';

interface ServiceCardProps {
  service: ServiceHealth;
}

const SERVICE_ICONS: Record<string, string> = {
  Gateway: '⛩',
  Registry: '📋',
  Manager: '🎛',
  Broker: '📨',
  Redis: '🗄',
};

interface ServiceInfo {
  description: string;
  port?: string;
  endpoints?: string[];
}

const SERVICE_INFO: Record<string, ServiceInfo> = {
  Gateway: {
    description: 'Routes tasks to agents, enforces policies, streams results via SSE',
    port: '8080',
    endpoints: [
      'POST /actions',
      'GET /tasks/{id}/stream',
      'GET /tasks/{id}/result',
      'GET /tasks/{id}/audit',
    ],
  },
  Registry: {
    description: 'Tracks registered agents and their capabilities',
    port: '8070',
    endpoints: [
      'GET /agents',
      'POST /agents',
      'GET /capabilities/{cap}',
    ],
  },
  Manager: {
    description: 'Spawns, manages, and monitors Kubex containers',
    port: '8090',
    endpoints: [
      'POST /kubexes',
      'GET /kubexes',
      'POST /kubexes/{id}/start|stop|kill|restart',
    ],
  },
  Broker: {
    description: 'Distributes tasks to available agents based on capability matching',
    endpoints: [],
  },
};

function InfoTooltip({ name, info }: { name: string; info: ServiceInfo }) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(true);
  };

  const hide = () => {
    timeoutRef.current = setTimeout(() => setVisible(false), 100);
  };

  return (
    <div className="relative inline-flex items-center">
      <button
        data-testid={`service-info-${name}`}
        aria-label={`Info about ${name}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => setVisible((v) => !v)}
        className="text-[var(--color-text-dim)] hover:text-emerald-400 transition-colors focus:outline-none"
        style={{ fontSize: 14, lineHeight: 1 }}
      >
        ℹ
      </button>
      {visible && (
        <div
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-dark)] shadow-lg p-3 text-xs pointer-events-none"
          role="tooltip"
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          <p className="text-[var(--color-text)] font-medium mb-1.5">{name}</p>
          <p className="text-[var(--color-text-dim)] mb-2 leading-relaxed">{info.description}</p>
          {info.port && (
            <p className="text-[var(--color-text-muted)] mb-1.5">
              Port: <span className="font-mono-data text-emerald-400">{info.port}</span>
            </p>
          )}
          {info.endpoints && info.endpoints.length > 0 && (
            <div>
              <p className="text-[var(--color-text-muted)] mb-1">Endpoints:</p>
              <ul className="space-y-0.5">
                {info.endpoints.map((ep) => (
                  <li key={ep} className="font-mono-data text-[10px] text-[var(--color-text-dim)] truncate">
                    {ep}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(!info.port) && (
            <p className="text-[var(--color-text-muted)] italic">Internal service — no direct external port</p>
          )}
          {/* Tooltip arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-0 h-0"
            style={{
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid var(--color-border)',
            }}
          />
        </div>
      )}
    </div>
  );
}

// Wrapped in React.memo — Dashboard re-renders every 10s poll tick; memo prevents
// ServiceCard from re-rendering when the service object props are unchanged.
const ServiceCard = memo(function ServiceCard({ service }: ServiceCardProps) {
  const rtSeries = useTimeSeries({ maxPoints: 20 });

  useEffect(() => {
    if (service.responseTime !== null) {
      rtSeries.push(service.responseTime);
    }
  }, [service.responseTime, service.lastChecked]); // Push when check happens

  const icon = SERVICE_ICONS[service.name] ?? '⚙';
  const info = SERVICE_INFO[service.name] ?? null;
  const rtText =
    service.responseTime !== null
      ? `${Math.round(service.responseTime)}ms`
      : '—';
  const checkedText = service.lastChecked
    ? service.lastChecked.toLocaleTimeString()
    : '—';

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3 hover:border-[var(--color-border-strong)] transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-0.5 min-w-0 mr-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">{icon}</span>
            <span className="font-semibold text-[var(--color-text)]">{service.name}</span>
            {info && <InfoTooltip name={service.name} info={info} />}
          </div>
        </div>
        <StatusBadge status={service.status} />
      </div>

      {rtSeries.values.length > 1 && (
        <div className="w-full">
          <Sparkline
            values={rtSeries.values}
            width={180}
            height={28}
            color={service.status === 'healthy' ? '#34d399' : service.status === 'degraded' ? '#fbbf24' : '#f87171'}
          />
          <p className="text-[10px] text-[var(--color-text-dim)] mt-0.5" data-testid="sparkline-label">Response time (ms)</p>
        </div>
      )}

      <div className="flex flex-col gap-1 text-xs text-[var(--color-text-dim)]">
        <div className="flex justify-between">
          <span>Response</span>
          <span className="font-mono-data text-[var(--color-text-secondary)]">{rtText}</span>
        </div>
        <div className="flex justify-between">
          <span>Last check</span>
          <span className="font-mono-data text-[var(--color-text-secondary)]">{checkedText}</span>
        </div>
        {service.url && (
          <div className="flex justify-between">
            <span>Endpoint</span>
            <span className="font-mono-data text-[var(--color-text-secondary)] truncate max-w-[120px]">{service.url}</span>
          </div>
        )}
      </div>

      {service.detail && (
        <p className="text-xs text-[var(--color-text-dim)] border-t border-[var(--color-border)] pt-2 truncate" title={service.detail}>
          {service.detail}
        </p>
      )}
    </div>
  );
});

export default ServiceCard;
