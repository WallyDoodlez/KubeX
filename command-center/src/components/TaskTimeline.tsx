/**
 * TaskTimeline — compact horizontal stepper that shows the lifecycle
 * phases of a task (Dispatched → Connecting → Streaming → Completed/Failed).
 *
 * Used in two places:
 *   1. Inline during active streaming, next to the typing indicator.
 *   2. Attached to result/error bubbles as a collapsed mini-timeline.
 */

import type { TaskPhaseEntry, TaskPhaseStatus } from '../types';

interface TaskTimelineProps {
  phases: TaskPhaseEntry[];
  /** When true, show the timeline expanded with timestamps. Default: false (compact). */
  expanded?: boolean;
  'data-testid'?: string;
}

/** Icon/colour per phase status */
function PhaseIcon({ status }: { status: TaskPhaseStatus }) {
  if (status === 'done') {
    return (
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '1rem',
          height: '1rem',
          borderRadius: '50%',
          background: 'var(--color-emerald, #10b981)',
          color: '#fff',
          fontSize: '0.55rem',
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        ✓
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '1rem',
          height: '1rem',
          borderRadius: '50%',
          background: 'var(--color-red, #ef4444)',
          color: '#fff',
          fontSize: '0.55rem',
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        ✕
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '1rem',
          height: '1rem',
          borderRadius: '50%',
          border: '2px solid var(--color-emerald, #10b981)',
          background: 'transparent',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: '0.4rem',
            height: '0.4rem',
            borderRadius: '50%',
            background: 'var(--color-emerald, #10b981)',
            animation: 'pulse 1.2s ease-in-out infinite',
          }}
        />
      </span>
    );
  }
  // pending
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1rem',
        height: '1rem',
        borderRadius: '50%',
        border: '2px solid var(--color-border)',
        background: 'transparent',
        flexShrink: 0,
      }}
    />
  );
}

/** Connector line between phases */
function Connector({ status }: { status: 'done' | 'pending' | 'active' | 'failed' }) {
  const isDone = status === 'done';
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '1.5rem',
        height: '2px',
        background: isDone
          ? 'var(--color-emerald, #10b981)'
          : 'var(--color-border)',
        flexShrink: 0,
        transition: 'background 0.3s ease',
      }}
    />
  );
}

export default function TaskTimeline({ phases, expanded = false, 'data-testid': testId }: TaskTimelineProps) {
  if (!phases || phases.length === 0) return null;

  return (
    <div
      data-testid={testId ?? 'task-timeline'}
      role="list"
      aria-label="Task progress timeline"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        flexWrap: expanded ? 'wrap' : 'nowrap',
        rowGap: expanded ? '0.5rem' : 0,
      }}
    >
      {phases.map((phase, i) => {
        const isLast = i === phases.length - 1;
        // Connector gets the status of the phase to its left
        const connectorStatus = phase.status === 'done' ? 'done' : 'pending';
        return (
          <span
            key={phase.label}
            role="listitem"
            data-testid={`timeline-phase-${phase.label.toLowerCase().replace(/\s+/g, '-')}`}
            data-phase-status={phase.status}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <PhaseIcon status={phase.status} />
              <span
                style={{
                  fontSize: '0.65rem',
                  color:
                    phase.status === 'done'
                      ? 'var(--color-emerald, #10b981)'
                      : phase.status === 'failed'
                      ? 'var(--color-red, #ef4444)'
                      : phase.status === 'active'
                      ? 'var(--color-text-secondary, #e2e8f0)'
                      : 'var(--color-text-muted)',
                  fontWeight: phase.status === 'active' ? 600 : 400,
                  whiteSpace: 'nowrap',
                  transition: 'color 0.3s ease',
                }}
              >
                {phase.label}
              </span>
              {expanded && phase.timestamp && (
                <span
                  style={{
                    fontSize: '0.55rem',
                    color: 'var(--color-text-muted)',
                    fontFamily: 'monospace',
                    marginLeft: '0.15rem',
                  }}
                >
                  {phase.timestamp}
                </span>
              )}
            </span>
            {!isLast && <Connector status={connectorStatus} />}
          </span>
        );
      })}
    </div>
  );
}
