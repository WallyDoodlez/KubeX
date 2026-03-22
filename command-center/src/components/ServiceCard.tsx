import { memo, useEffect } from 'react';
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
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          <span className="font-semibold text-[var(--color-text)]">{service.name}</span>
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
