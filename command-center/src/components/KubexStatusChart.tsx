import { useMemo } from 'react';
import type { Kubex } from '../types';

interface KubexStatusChartProps {
  kubexes: Kubex[];
}

/** Color mapping for known kubex statuses */
const STATUS_COLORS: Record<string, string> = {
  running: '#34d399',  // emerald
  created: '#60a5fa',  // blue
  stopped: '#94a3b8',  // slate
  error: '#f87171',    // red
};

const STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  created: 'Created',
  stopped: 'Stopped',
  error: 'Error',
};

function colorForStatus(status: string): string {
  return STATUS_COLORS[status] ?? '#a78bfa'; // purple fallback for unknown
}

function labelForStatus(status: string): string {
  return STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * KubexStatusChart — SVG donut chart showing distribution of kubex states.
 *
 * Pure CSS/SVG, no chart library dependency.
 * Accessible: role="img" with descriptive aria-label on the SVG,
 * and a visible legend table that screen readers can navigate.
 */
export default function KubexStatusChart({ kubexes }: KubexStatusChartProps) {
  const buckets = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const k of kubexes) {
      const s = (k.status ?? 'unknown').toLowerCase();
      counts[s] = (counts[s] ?? 0) + 1;
    }
    // Sort by count descending for consistent rendering order
    return Object.entries(counts)
      .map(([status, count]) => ({ status, count, color: colorForStatus(status), label: labelForStatus(status) }))
      .sort((a, b) => b.count - a.count);
  }, [kubexes]);

  const total = kubexes.length;

  // Build SVG donut arcs
  const arcs = useMemo(() => {
    if (total === 0) return [];
    const cx = 50;
    const cy = 50;
    const r = 36;
    const stroke = 14;
    const circumference = 2 * Math.PI * r;

    let offset = 0; // Start from top (rotated -90deg via SVG transform)
    return buckets.map((b) => {
      const fraction = b.count / total;
      const dashArray = `${fraction * circumference} ${circumference}`;
      const dashOffset = -offset * circumference;
      offset += fraction;
      return { ...b, dashArray, dashOffset, cx, cy, r, stroke };
    });
  }, [buckets, total]);

  const ariaLabel = total === 0
    ? 'No kubexes to display'
    : `Kubex status distribution: ${buckets.map((b) => `${b.count} ${b.label}`).join(', ')}`;

  return (
    <div
      data-testid="kubex-status-chart"
      className="flex flex-col sm:flex-row items-center gap-6 py-2"
    >
      {/* Donut SVG */}
      <div className="flex-shrink-0 relative" style={{ width: 120, height: 120 }}>
        {total === 0 ? (
          <svg
            viewBox="0 0 100 100"
            width={120}
            height={120}
            role="img"
            aria-label="No kubexes to display"
          >
            <circle
              cx={50}
              cy={50}
              r={36}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth={14}
            />
          </svg>
        ) : (
          <svg
            viewBox="0 0 100 100"
            width={120}
            height={120}
            role="img"
            aria-label={ariaLabel}
            data-testid="kubex-donut-svg"
          >
            {/* Background ring */}
            <circle
              cx={50}
              cy={50}
              r={36}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth={14}
            />
            {/* Donut segments — each is a circle with dash-offset trick, rotated -90deg */}
            <g transform="rotate(-90 50 50)">
              {arcs.map((arc) => (
                <circle
                  key={arc.status}
                  cx={arc.cx}
                  cy={arc.cy}
                  r={arc.r}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={arc.stroke}
                  strokeDasharray={arc.dashArray}
                  strokeDashoffset={arc.dashOffset}
                  data-testid={`kubex-arc-${arc.status}`}
                  aria-label={`${arc.label}: ${arc.count}`}
                />
              ))}
            </g>
            {/* Center count */}
            <text
              x={50}
              y={50}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={18}
              fontWeight={700}
              fill="var(--color-text)"
              fontFamily="monospace"
              aria-hidden="true"
            >
              {total}
            </text>
            <text
              x={50}
              y={64}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={7}
              fill="var(--color-text-dim)"
              aria-hidden="true"
            >
              total
            </text>
          </svg>
        )}
      </div>

      {/* Legend */}
      {total === 0 ? (
        <p className="text-sm text-[var(--color-text-dim)]">No kubexes running.</p>
      ) : (
        <table
          className="text-xs w-full"
          aria-label="Kubex status breakdown"
          data-testid="kubex-status-legend"
        >
          <tbody>
            {buckets.map((b) => {
              const pct = Math.round((b.count / total) * 100);
              return (
                <tr key={b.status} data-testid={`kubex-legend-row-${b.status}`}>
                  <td className="py-1 pr-3 w-4">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: b.color }}
                      aria-hidden="true"
                    />
                  </td>
                  <td className="py-1 pr-4 text-[var(--color-text-secondary)] capitalize font-medium">
                    {b.label}
                  </td>
                  <td className="py-1 pr-3 text-right font-mono-data font-semibold text-[var(--color-text)]">
                    {b.count}
                  </td>
                  <td className="py-1 text-right text-[var(--color-text-dim)] w-10">
                    {pct}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
