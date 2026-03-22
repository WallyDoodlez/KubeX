/**
 * SkeletonLoader — reusable loading skeleton components.
 *
 * Usage:
 *   <SkeletonText lines={3} />
 *   <SkeletonCard />
 *   <SkeletonTable rows={5} cols={4} />
 */

interface SkeletonTextProps {
  /** Number of text lines to render (default 1). */
  lines?: number;
  /** Additional className override. */
  className?: string;
}

/** Animated shimmer text placeholder lines. */
export function SkeletonText({ lines = 1, className = '' }: SkeletonTextProps) {
  return (
    <div
      role="status"
      aria-label="Loading…"
      aria-busy="true"
      className={`space-y-2 ${className}`}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`h-3 rounded bg-[#2a2f45] animate-pulse ${
            i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full'
          }`}
        />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

interface SkeletonCardProps {
  className?: string;
}

/** Animated shimmer card placeholder. */
export function SkeletonCard({ className = '' }: SkeletonCardProps) {
  return (
    <div
      role="status"
      aria-label="Loading card…"
      aria-busy="true"
      className={`rounded-xl border border-[#2a2f45] bg-[#12151f] p-4 space-y-3 ${className}`}
    >
      {/* Header row */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#2a2f45] animate-pulse flex-shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 bg-[#2a2f45] rounded animate-pulse w-2/5" />
          <div className="h-2.5 bg-[#2a2f45] rounded animate-pulse w-1/4" />
        </div>
      </div>
      {/* Body lines */}
      <div className="space-y-2">
        <div className="h-2.5 bg-[#2a2f45] rounded animate-pulse w-full" />
        <div className="h-2.5 bg-[#2a2f45] rounded animate-pulse w-5/6" />
        <div className="h-2.5 bg-[#2a2f45] rounded animate-pulse w-3/4" />
      </div>
      {/* Footer */}
      <div className="flex items-center gap-2 pt-1">
        <div className="h-5 w-16 bg-[#2a2f45] rounded-full animate-pulse" />
        <div className="h-5 w-20 bg-[#2a2f45] rounded-full animate-pulse" />
      </div>
      <span className="sr-only">Loading card…</span>
    </div>
  );
}

interface SkeletonTableProps {
  /** Number of data rows to render (default 5). */
  rows?: number;
  /** Number of columns to render (default 4). */
  cols?: number;
  className?: string;
}

/** Animated shimmer table placeholder. */
export function SkeletonTable({ rows = 5, cols = 4, className = '' }: SkeletonTableProps) {
  return (
    <div
      role="status"
      aria-label="Loading table…"
      aria-busy="true"
      className={`w-full overflow-hidden rounded-xl border border-[#2a2f45] ${className}`}
    >
      {/* Header row */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-b border-[#2a2f45] bg-[#12151f]">
        {Array.from({ length: cols }).map((_, i) => (
          <div
            key={i}
            className={`h-2.5 bg-[#2a2f45] rounded animate-pulse ${
              i === 0 ? 'w-1/4' : i === cols - 1 ? 'w-1/6 ml-auto' : 'w-1/5'
            }`}
          />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, row) => (
        <div
          key={row}
          className="flex items-center gap-4 px-4 py-3 border-b border-[#2a2f45]/50 last:border-0"
        >
          {Array.from({ length: cols }).map((_, col) => (
            <div
              key={col}
              style={{ animationDelay: `${(row * cols + col) * 40}ms` }}
              className={`h-3 bg-[#2a2f45] rounded animate-pulse ${
                col === 0 ? 'w-1/4' : col === cols - 1 ? 'w-1/6 ml-auto' : 'w-1/5'
              }`}
            />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading table…</span>
    </div>
  );
}
