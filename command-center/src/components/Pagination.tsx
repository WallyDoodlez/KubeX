import { memo } from 'react';

interface PaginationProps {
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
  hasNext: boolean;
  hasPrev: boolean;
  onNextPage: () => void;
  onPrevPage: () => void;
  onPageSizeChange: (size: number) => void;
}

const PAGE_SIZES = [5, 10, 20, 50];

// Wrapped in React.memo — Pagination is rendered inside AgentsPanel and TrafficLog which
// re-render on every poll tick. Memo prevents re-rendering when pagination state is unchanged.
const Pagination = memo(function Pagination({
  page, totalPages, pageSize, totalItems, startIndex, endIndex,
  hasNext, hasPrev, onNextPage, onPrevPage, onPageSizeChange,
}: PaginationProps) {
  if (totalItems === 0) return null;

  return (
    <div className="flex items-center justify-between mt-4 text-xs text-[var(--color-text-dim)]">
      {/* Item range */}
      <span className="font-mono-data">
        {startIndex + 1}–{endIndex} of {totalItems}
      </span>

      {/* Controls */}
      <div className="flex items-center gap-3">
        {/* Page size */}
        <div className="flex items-center gap-1.5">
          <span>Per page:</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-[var(--color-text)] text-xs focus:outline-none focus:border-emerald-500/50"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Page indicator */}
        <span className="font-mono-data">
          Page {page} / {totalPages}
        </span>

        {/* Prev / Next */}
        <div className="flex items-center gap-1">
          <button
            onClick={onPrevPage}
            disabled={!hasPrev}
            className="px-2 py-1 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous page"
          >
            ←
          </button>
          <button
            onClick={onNextPage}
            disabled={!hasNext}
            className="px-2 py-1 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Next page"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
});

export default Pagination;
