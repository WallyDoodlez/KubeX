import { useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';

/**
 * Manages collapse state for named dashboard sections, persisted in localStorage.
 * State is stored as a record of sectionId -> boolean (true = collapsed).
 */
export function useCollapsible(storageKey: string) {
  const [state, setState] = useLocalStorage<Record<string, boolean>>(storageKey, {});

  const isCollapsed = useCallback(
    (sectionId: string): boolean => {
      return state[sectionId] ?? false;
    },
    [state]
  );

  const toggle = useCallback(
    (sectionId: string) => {
      setState((prev) => ({
        ...prev,
        [sectionId]: !(prev[sectionId] ?? false),
      }));
    },
    [setState]
  );

  const setCollapsed = useCallback(
    (sectionId: string, collapsed: boolean) => {
      setState((prev) => ({
        ...prev,
        [sectionId]: collapsed,
      }));
    },
    [setState]
  );

  return { isCollapsed, toggle, setCollapsed };
}
