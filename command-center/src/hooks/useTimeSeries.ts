import { useState, useCallback } from 'react';

interface DataPoint {
  timestamp: number;
  value: number;
}

interface UseTimeSeriesOptions {
  /** Max number of points to keep (default 30) */
  maxPoints?: number;
  /** Max age of points in ms (default 5 minutes) */
  maxAge?: number;
}

interface UseTimeSeriesResult {
  /** Current data points */
  points: DataPoint[];
  /** Add a new data point */
  push: (value: number) => void;
  /** Get values only (for sparkline) */
  values: number[];
  /** Latest value */
  latest: number | null;
  /** Clear all data */
  clear: () => void;
}

export function useTimeSeries(options?: UseTimeSeriesOptions): UseTimeSeriesResult {
  const { maxPoints = 30, maxAge = 5 * 60 * 1000 } = options ?? {};

  const [points, setPoints] = useState<DataPoint[]>([]);

  const push = useCallback(
    (value: number) => {
      const now = Date.now();
      setPoints((prev) => {
        const cutoff = now - maxAge;
        const pruned = prev.filter((p) => p.timestamp >= cutoff);
        const next = [...pruned, { timestamp: now, value }];
        return next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
      });
    },
    [maxPoints, maxAge],
  );

  const clear = useCallback(() => {
    setPoints([]);
  }, []);

  return {
    points,
    push,
    values: points.map((p) => p.value),
    latest: points.length > 0 ? points[points.length - 1].value : null,
    clear,
  };
}
