/**
 * useQueryParams — sync React state with URL search parameters via React Router.
 *
 * Wraps React Router's `useSearchParams` to provide a typed, default-aware
 * API. Keys not in `defaults` are left untouched in the URL.
 *
 * - Values equal to their default are omitted from the URL to keep links clean.
 * - Browser back/forward is handled natively by React Router.
 * - Use `push: true` when changing filters that should be navigable (default).
 *   Use `push: false` (replaceState) for incremental updates like search keystrokes.
 *
 * Usage:
 *   const [params, setParams] = useQueryParams({ search: '', page: '1' });
 *   // Read: params.search, params.page (always strings)
 *   // Write: setParams({ search: 'alpha' })         — pushState (navigable)
 *   //        setParams({ search: 'alpha' }, false)   — replaceState (no history entry)
 */
import { useSearchParams } from 'react-router-dom';

type ParamDefaults = Record<string, string>;
type ParamValues<D extends ParamDefaults> = { [K in keyof D]: string };

export function useQueryParams<D extends ParamDefaults>(
  defaults: D,
): [ParamValues<D>, (updates: Partial<ParamValues<D>>, push?: boolean) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read current values, falling back to defaults for missing keys
  const params = {} as ParamValues<D>;
  for (const key of Object.keys(defaults) as Array<keyof D>) {
    const val = searchParams.get(key as string);
    params[key] = (val !== null ? val : defaults[key]) as ParamValues<D>[typeof key];
  }

  function setParams(updates: Partial<ParamValues<D>>, push = true): void {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updates)) {
          const defaultVal = defaults[key];
          if (value === defaultVal || value === undefined) {
            next.delete(key);
          } else {
            next.set(key, value as string);
          }
        }
        return next;
      },
      { replace: !push },
    );
  }

  return [params, setParams];
}
