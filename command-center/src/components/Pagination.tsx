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
    <div className="flex items-center justify-between mt-4 text-xs text-[#64748b]">
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
            className="bg-[#1a1d27] border border-[#2a2f45] rounded px-1.5 py-0.5 text-[#e2e8f0] text-xs focus:outline-none focus:border-emerald-500/50"
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
            className="px-2 py-1 rounded border border-[#2a2f45] text-[#94a3b8] hover:border-[#3a3f5a] hover:text-[#e2e8f0] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous page"
          >
            ←
          </button>
          <button
            onClick={onNextPage}
            disabled={!hasNext}
            className="px-2 py-1 rounded border border-[#2a2f45] text-[#94a3b8] hover:border-[#3a3f5a] hover:text-[#e2e8f0] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
