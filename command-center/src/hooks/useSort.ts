import { useState, useMemo } from 'react';

type SortDirection = 'asc' | 'desc';

interface SortConfig<K extends string> {
  key: K;
  direction: SortDirection;
}

interface UseSortResult<T, K extends string> {
  sortedItems: T[];
  sortConfig: SortConfig<K> | null;
  requestSort: (key: K) => void;
  getSortIndicator: (key: K) => string;
  clearSort: () => void;
}

export function useSort<T, K extends string>(
  items: T[],
  comparators: Record<K, (a: T, b: T) => number>,
): UseSortResult<T, K> {
  const [sortConfig, setSortConfig] = useState<SortConfig<K> | null>(null);

  const sortedItems = useMemo(() => {
    if (!sortConfig) return items;
    const comparator = comparators[sortConfig.key];
    if (!comparator) return items;

    const sorted = [...items].sort(comparator);
    return sortConfig.direction === 'desc' ? sorted.reverse() : sorted;
  }, [items, sortConfig, comparators]);

  function requestSort(key: K) {
    setSortConfig((prev) => {
      if (prev?.key === key) {
        // Toggle direction, or clear if already desc
        if (prev.direction === 'asc') return { key, direction: 'desc' };
        return null; // Clear sort
      }
      return { key, direction: 'asc' };
    });
  }

  function getSortIndicator(key: K): string {
    if (sortConfig?.key !== key) return '';
    return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
  }

  return { sortedItems, sortConfig, requestSort, getSortIndicator, clearSort: () => setSortConfig(null) };
}
