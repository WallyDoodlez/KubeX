import { useEffect } from 'react';
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

export default function ServiceCard({ service }: ServiceCardProps) {
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
    <div className="rounded-xl border border-[#2a2f45] bg-[#1a1d27] p-4 flex flex-col gap-3 hover:border-[#3a3f5a] transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          <span className="font-semibold text-[#e2e8f0]">{service.name}</span>
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

      <div className="flex flex-col gap-1 text-xs text-[#64748b]">
        <div className="flex justify-between">
          <span>Response</span>
          <span className="font-mono-data text-[#94a3b8]">{rtText}</span>
        </div>
        <div className="flex justify-between">
          <span>Last check</span>
          <span className="font-mono-data text-[#94a3b8]">{checkedText}</span>
        </div>
        {service.url && (
          <div className="flex justify-between">
            <span>Endpoint</span>
            <span className="font-mono-data text-[#94a3b8] truncate max-w-[120px]">{service.url}</span>
          </div>
        )}
      </div>

      {service.detail && (
        <p className="text-xs text-[#64748b] border-t border-[#2a2f45] pt-2 truncate" title={service.detail}>
          {service.detail}
        </p>
      )}
    </div>
  );
}
