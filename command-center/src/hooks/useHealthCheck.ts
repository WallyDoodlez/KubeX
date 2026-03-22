import { useCallback } from 'react';
import {
  getGatewayHealth,
  getRegistryHealth,
  getManagerHealth,
  getBrokerHealth,
} from '../api';
import type { ServiceHealth } from '../types';
import { useAppContext } from '../context/AppContext';
import { usePolling } from './usePolling';

const HEALTH_INTERVAL = 15_000; // 15 s — slightly less aggressive than Dashboard's 10 s

/**
 * useHealthCheck
 *
 * Runs health checks for all four services on a 15-second interval and writes
 * results into AppContext.services. The hook is designed to be mounted once at
 * the top of the component tree (Layout) so that system health is always
 * available globally, regardless of which page the operator is viewing.
 *
 * Dashboard reads from AppContext.services instead of managing its own state,
 * which means both the top-bar indicator and the Dashboard ServiceCard grid
 * always reflect the same data without duplicating API calls.
 */
export function useHealthCheck(): void {
  const { setServices } = useAppContext();

  const checkHealth = useCallback(async () => {
    const checks = [
      { name: 'Gateway',  fn: getGatewayHealth  },
      { name: 'Registry', fn: getRegistryHealth },
      { name: 'Manager',  fn: getManagerHealth  },
      { name: 'Broker',   fn: getBrokerHealth   },
    ] as const;

    const results = await Promise.all(
      checks.map(async ({ name, fn }) => {
        const res = await fn();
        return {
          name,
          status: (res.ok
            ? 'healthy'
            : res.status === 0
              ? 'down'
              : 'degraded') as ServiceHealth['status'],
          responseTime: res.responseTime,
          lastChecked: new Date(),
          detail: res.error ?? (res.data as { status?: string } | null)?.status ?? undefined,
        };
      }),
    );

    // Redis — inferred from Gateway (no direct browser endpoint)
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
  }, [setServices]);

  usePolling(checkHealth, {
    interval: HEALTH_INTERVAL,
    immediate: true,
    pauseOnHidden: true,
    maxBackoff: 4,
  });
}
