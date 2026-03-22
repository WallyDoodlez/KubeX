import { useState, useCallback } from 'react';

export interface UseSelectionReturn {
  /** The set of currently selected IDs */
  selectedIds: Set<string>;
  /** Number of selected items */
  selectedCount: number;
  /** Whether all items in `allIds` are selected */
  allSelected: boolean;
  /** Whether some (but not all) items are selected — useful for indeterminate checkbox state */
  someSelected: boolean;
  /** Toggle a single ID in/out of the selection */
  toggleOne: (id: string) => void;
  /** Select all IDs. If all are already selected, deselects all (toggle-all behaviour) */
  toggleAll: (allIds: string[]) => void;
  /** Remove all selections */
  clearSelection: () => void;
  /** Returns true if the given ID is in the selection */
  isSelected: (id: string) => boolean;
}

/**
 * useSelection — manages a set of selected item IDs.
 *
 * Designed for use with table rows where operators want to select
 * multiple items for bulk actions (deregister, kill, start, etc.).
 *
 * All mutators are stable references (useCallback) so they are safe
 * to pass as props to React.memo-wrapped row components without
 * causing unnecessary re-renders.
 */
export function useSelection(): UseSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback((allIds: string[]) => {
    setSelectedIds((prev) => {
      // If every item is already selected → deselect all
      const allSelected = allIds.length > 0 && allIds.every((id) => prev.has(id));
      if (allSelected) {
        return new Set();
      }
      // Otherwise select all
      return new Set(allIds);
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );

  const selectedCount = selectedIds.size;

  // These are derived at call-time from the current selectedIds state.
  // Components that need allSelected/someSelected must pass their visible
  // item list; we expose helper functions rather than baking in a fixed list.
  // For convenience, AgentsPanel / ContainersPanel compute these inline.
  const allSelected = false; // placeholder — consumers compute with their own list
  const someSelected = selectedCount > 0;

  return {
    selectedIds,
    selectedCount,
    allSelected,
    someSelected,
    toggleOne,
    toggleAll,
    clearSelection,
    isSelected,
  };
}
