import { useState, useMemo } from 'react';

interface UseSearchOptions<T> {
  /** Fields to search in. Each function extracts searchable text from an item. */
  fields: ((item: T) => string)[];
  /** Case sensitive (default false) */
  caseSensitive?: boolean;
  /** Initial query value (e.g. read from URL params). Default: '' */
  initialQuery?: string;
}

interface UseSearchResult<T> {
  query: string;
  setQuery: (q: string) => void;
  filteredItems: T[];
  hasQuery: boolean;
}

export function useSearch<T>(items: T[], options: UseSearchOptions<T>): UseSearchResult<T> {
  const { fields, caseSensitive = false, initialQuery = '' } = options;
  const [query, setQuery] = useState(initialQuery);

  const filteredItems = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return items;

    const needle = caseSensitive ? trimmed : trimmed.toLowerCase();

    return items.filter((item) =>
      fields.some((fn) => {
        const text = fn(item);
        const haystack = caseSensitive ? text : text.toLowerCase();
        return haystack.includes(needle);
      })
    );
  }, [items, query, fields, caseSensitive]);

  return {
    query,
    setQuery,
    filteredItems,
    hasQuery: query.trim().length > 0,
  };
}
