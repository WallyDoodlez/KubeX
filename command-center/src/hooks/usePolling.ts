import { useEffect, useRef, useCallback } from 'react';

interface UsePollingOptions {
  /** Polling interval in ms */
  interval: number;
  /** Whether polling is enabled (default true) */
  enabled?: boolean;
  /** Whether to call immediately on mount (default true) */
  immediate?: boolean;
  /** Max backoff multiplier for exponential backoff on error (default 1 = no backoff) */
  maxBackoff?: number;
  /** Pause polling when tab is hidden (default true) */
  pauseOnHidden?: boolean;
}

export function usePolling(
  callback: () => void | Promise<void>,
  options: UsePollingOptions,
): { refresh: () => void } {
  const {
    interval,
    enabled = true,
    immediate = true,
    maxBackoff = 1,
    pauseOnHidden = true,
  } = options;

  // Keep callback ref current so the interval closure always calls the latest version
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Tracks consecutive error count for exponential backoff
  const errorCountRef = useRef(0);
  // Tracks the current timeout id so we can clear it on unmount or reset
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Prevent calling the callback after unmount
  const mountedRef = useRef(false);

  const clearCurrentTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const scheduleNext = useCallback(
    (delay: number) => {
      clearCurrentTimeout();
      timeoutRef.current = setTimeout(() => {
        if (!mountedRef.current) return;

        // Skip tick when tab is hidden
        if (pauseOnHidden && document.visibilityState === 'hidden') {
          scheduleNext(interval);
          return;
        }

        const result = callbackRef.current();

        if (result instanceof Promise) {
          result
            .then(() => {
              if (!mountedRef.current) return;
              errorCountRef.current = 0;
              scheduleNext(interval);
            })
            .catch(() => {
              if (!mountedRef.current) return;
              errorCountRef.current += 1;
              const backoffDelay =
                interval * Math.min(2 ** errorCountRef.current, maxBackoff);
              scheduleNext(backoffDelay);
            });
        } else {
          // Synchronous callback — treat as success (errors bubble as exceptions)
          errorCountRef.current = 0;
          scheduleNext(interval);
        }
      }, delay);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [interval, maxBackoff, pauseOnHidden],
  );

  const runCallback = useCallback(async () => {
    try {
      await callbackRef.current();
      errorCountRef.current = 0;
    } catch {
      errorCountRef.current += 1;
    }
  }, []);

  // Manual refresh — calls the callback immediately without affecting the schedule
  const refresh = useCallback(() => {
    void runCallback();
  }, [runCallback]);

  useEffect(() => {
    if (!enabled) return;

    mountedRef.current = true;
    errorCountRef.current = 0;

    const handleVisibilityChange = () => {
      // Nothing to do here — the scheduled tick itself checks visibility
    };

    if (pauseOnHidden) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    if (immediate) {
      // Call immediately, then schedule subsequent ticks
      const result = callbackRef.current();
      if (result instanceof Promise) {
        result
          .then(() => {
            if (!mountedRef.current) return;
            errorCountRef.current = 0;
            scheduleNext(interval);
          })
          .catch(() => {
            if (!mountedRef.current) return;
            errorCountRef.current += 1;
            const backoffDelay =
              interval * Math.min(2 ** errorCountRef.current, maxBackoff);
            scheduleNext(backoffDelay);
          });
      } else {
        scheduleNext(interval);
      }
    } else {
      scheduleNext(interval);
    }

    return () => {
      mountedRef.current = false;
      clearCurrentTimeout();
      if (pauseOnHidden) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [enabled, immediate, interval, maxBackoff, pauseOnHidden, scheduleNext, clearCurrentTimeout]);

  return { refresh };
}
