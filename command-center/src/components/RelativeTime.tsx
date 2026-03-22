/**
 * RelativeTime — displays a human-friendly relative timestamp ("just now", "5m ago",
 * "2h ago", "3d ago") with a tooltip showing the full ISO-8601 date/time.
 *
 * Auto-updates every 30 s via a shared singleton interval so all instances on the
 * page tick together without each creating its own timer.
 */

import { useState, useEffect, useCallback, memo } from 'react';

// ── Shared singleton interval ──────────────────────────────────────────────────
// All mounted RelativeTime instances register a callback here; a single 30 s
// interval fires them all. This avoids N separate setInterval calls when many
// timestamps are on screen at once.

type Listener = () => void;

const listeners = new Set<Listener>();
let sharedTimerId: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  if (!sharedTimerId) {
    sharedTimerId = setInterval(() => {
      listeners.forEach((l) => l());
    }, 30_000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && sharedTimerId !== null) {
      clearInterval(sharedTimerId);
      sharedTimerId = null;
    }
  };
}

// ── Formatting ─────────────────────────────────────────────────────────────────

export function formatRelative(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.round(diffMs / 1000);

  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;

  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface RelativeTimeProps {
  /** The date to display. Accepts a Date, ISO string, or unix timestamp (ms). */
  date: Date | string | number;
  /** Extra CSS class names applied to the wrapping <time> element. */
  className?: string;
  /** data-testid forwarded to the <time> element. */
  'data-testid'?: string;
}

const RelativeTime = memo(function RelativeTime({
  date,
  className,
  'data-testid': testId,
}: RelativeTimeProps) {
  const d = date instanceof Date ? date : new Date(date);
  const isoString = d.toISOString();

  const [label, setLabel] = useState(() => formatRelative(d));

  const refresh = useCallback(() => {
    setLabel(formatRelative(d));
  }, [d]);

  useEffect(() => {
    // Re-derive immediately on mount (handles cases where the component mounts
    // mid-interval cycle).
    refresh();
    return subscribe(refresh);
  }, [refresh]);

  return (
    <time
      dateTime={isoString}
      title={isoString}
      className={className}
      data-testid={testId}
    >
      {label}
    </time>
  );
});

export default RelativeTime;
