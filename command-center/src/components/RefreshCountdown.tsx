import { useState, useEffect, useRef } from 'react';

interface RefreshCountdownProps {
  /** Total polling interval in milliseconds (e.g. 15000 for 15 s) */
  interval: number;
  /** Timestamp of the last completed poll; null before first poll */
  lastPolledAt: Date | null;
  /** Size of the SVG ring in pixels (default: 16) */
  size?: number;
  /** Stroke width of the ring (default: 2) */
  strokeWidth?: number;
  /** Additional class names for the wrapper span */
  className?: string;
}

/**
 * RefreshCountdown
 *
 * A small circular SVG ring that visually counts down the time until the next
 * health poll. The ring drains clockwise from full → empty over the polling
 * interval, then resets when `lastPolledAt` changes.
 *
 * Intended to sit next to the ConnectionIndicator status dot so operators
 * can see at a glance how stale the current health data is.
 */
export default function RefreshCountdown({
  interval,
  lastPolledAt,
  size = 16,
  strokeWidth = 2,
  className = '',
}: RefreshCountdownProps) {
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const animFrameRef = useRef<number | null>(null);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    if (!lastPolledAt) {
      setSecondsLeft(0);
      return;
    }

    function tick() {
      const now = Date.now();
      const elapsed = now - lastPolledAt!.getTime();
      const remaining = Math.max(0, interval - elapsed);
      setSecondsLeft(Math.ceil(remaining / 1000));

      if (remaining > 0) {
        animFrameRef.current = requestAnimationFrame(tick);
      }
    }

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [interval, lastPolledAt]);

  // Progress 0→1 representing how far through the interval we are.
  // When secondsLeft is 0 or lastPolledAt is null, ring is fully drained.
  const progress = lastPolledAt
    ? Math.min(1, secondsLeft / Math.ceil(interval / 1000))
    : 0;

  // strokeDashoffset: full circumference = empty ring, 0 = full ring
  const dashOffset = circumference * (1 - progress);

  const intervalSeconds = Math.round(interval / 1000);
  const ariaLabel = lastPolledAt
    ? `Next health check in ${secondsLeft}s (every ${intervalSeconds}s)`
    : `Waiting for first health check`;

  return (
    <span
      data-testid="refresh-countdown"
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`inline-flex items-center justify-center flex-shrink-0 ${className}`}
      aria-hidden="false"
    >
      <svg
        data-testid="refresh-countdown-ring"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaLabel}
        style={{ transform: 'rotate(-90deg)' }}
      >
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          opacity={0.15}
        />
        {/* Countdown arc */}
        <circle
          data-testid="refresh-countdown-arc"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.25s linear' }}
          opacity={0.55}
        />
      </svg>
    </span>
  );
}
