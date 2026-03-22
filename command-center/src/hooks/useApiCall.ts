import { useState, useCallback } from 'react';

interface UseApiCallResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  execute: (...args: unknown[]) => Promise<T | null>;
  reset: () => void;
}

export function useApiCall<T>(
  apiFn: (
    ...args: unknown[]
  ) => Promise<{ ok: boolean; data: T | null; error: string | null; status: number }>,
): UseApiCallResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (...args: unknown[]): Promise<T | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await apiFn(...args);

        if (result.ok) {
          setData(result.data);
          setLoading(false);
          return result.data;
        } else {
          const errMsg = result.error ?? `Request failed with status ${result.status}`;
          setError(errMsg);
          setLoading(false);
          return null;
        }
      } catch (err: unknown) {
        const errMsg =
          err instanceof Error ? err.message : 'An unexpected error occurred';
        setError(errMsg);
        setLoading(false);
        return null;
      }
    },
    [apiFn],
  );

  const reset = useCallback(() => {
    setData(null);
    setLoading(false);
    setError(null);
  }, []);

  return { data, loading, error, execute, reset };
}
