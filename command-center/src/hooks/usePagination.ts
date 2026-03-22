import { useState, useMemo } from 'react';

interface UsePaginationOptions {
  initialPage?: number;
  initialPageSize?: number;
}

interface UsePaginationResult<T> {
  /** Current page (1-indexed) */
  page: number;
  /** Items per page */
  pageSize: number;
  /** Total number of pages */
  totalPages: number;
  /** Items for the current page */
  paginatedItems: T[];
  /** Go to specific page */
  setPage: (page: number) => void;
  /** Change page size (resets to page 1) */
  setPageSize: (size: number) => void;
  /** Go to next page */
  nextPage: () => void;
  /** Go to previous page */
  prevPage: () => void;
  /** Whether there's a next page */
  hasNext: boolean;
  /** Whether there's a previous page */
  hasPrev: boolean;
  /** Start index (0-based) of current page in the full list */
  startIndex: number;
  /** End index (exclusive) of current page in the full list */
  endIndex: number;
}

export function usePagination<T>(items: T[], options?: UsePaginationOptions): UsePaginationResult<T> {
  const { initialPage = 1, initialPageSize = 10 } = options ?? {};
  const [page, setPageState] = useState(initialPage);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  // Clamp page to valid range
  const clampedPage = Math.min(page, totalPages);

  const startIndex = (clampedPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, items.length);
  const paginatedItems = useMemo(() => items.slice(startIndex, endIndex), [items, startIndex, endIndex]);

  return {
    page: clampedPage,
    pageSize,
    totalPages,
    paginatedItems,
    setPage: (p) => setPageState(Math.max(1, Math.min(p, totalPages))),
    setPageSize: (s) => { setPageSizeState(s); setPageState(1); },
    nextPage: () => setPageState((p) => Math.min(p + 1, totalPages)),
    prevPage: () => setPageState((p) => Math.max(p - 1, 1)),
    hasNext: clampedPage < totalPages,
    hasPrev: clampedPage > 1,
    startIndex,
    endIndex,
  };
}
