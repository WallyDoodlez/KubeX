import { useEffect, useRef, useState, useCallback } from 'react';
import { TOUR_STEP_COUNT } from '../hooks/useOnboarding';

/**
 * OnboardingTour — first-run spotlight tour with dismissible tooltips.
 *
 * Shows a semi-transparent overlay with a "spotlight" cutout around the target
 * element. A tooltip card explains the highlighted feature. Users can advance
 * with Next, skip with Skip, or close with the × button.
 *
 * Targets are resolved by data-testid on each render so the tour adapts to
 * layout changes (e.g. responsive breakpoints).
 *
 * Steps:
 *  0 — Command Palette (Ctrl+K)
 *  1 — Quick Dispatch (Ctrl+D)
 *  2 — Keyboard Shortcuts Help (?)
 *  3 — Sidebar navigation
 *  4 — Connection Indicator + refresh countdown
 *  5 — Notification Center (bell icon)
 *  6 — Spawn Kubex Wizard (sidebar nav link)
 *  7 — Approval Queue (sidebar nav link + HITL badge)
 */

interface TourStep {
  targetTestId: string;
  title: string;
  description: string;
  placement: 'bottom' | 'bottom-left' | 'bottom-right' | 'right' | 'left';
}

const STEPS: TourStep[] = [
  {
    targetTestId: 'command-palette-trigger',
    title: 'Command Palette',
    description:
      'Press Ctrl+K (or click here) to open the command palette. Search pages, dispatch tasks, and run actions — all from the keyboard.',
    placement: 'bottom-left',
  },
  {
    targetTestId: 'quick-dispatch-trigger',
    title: 'Quick Dispatch',
    description:
      'Press Ctrl+D (or click ⚡ Dispatch) to instantly send a task to any agent — choose capability, message, and priority without leaving your current page.',
    placement: 'bottom-left',
  },
  {
    targetTestId: 'shortcuts-help-trigger',
    title: 'Keyboard Shortcuts',
    description:
      'Press ? at any time to see all keyboard shortcuts. Navigate pages with G+D/A/T/C/K/P and never take your hands off the keyboard.',
    placement: 'bottom-left',
  },
  {
    targetTestId: 'sidebar',
    title: 'Navigation Sidebar',
    description:
      'All 8 sections are one click away. Pin favourite agents with ★, monitor pending approvals (shown as a badge), and jump straight to Task History.',
    placement: 'right',
  },
  {
    targetTestId: 'connection-indicator',
    title: 'Live Health Monitor',
    description:
      'The status indicator polls Gateway, Registry, Manager, Broker, and Redis every 15 seconds. The ring counts down to the next refresh — click it to see service details.',
    placement: 'bottom-left',
  },
  {
    targetTestId: 'notification-bell',
    title: 'Notification Center',
    description:
      'The bell icon collects system alerts, task completions, and escalation notices. Click it to view or clear notifications — a badge shows unread count. Toast pop-ups appear for real-time events.',
    placement: 'bottom-left',
  },
  {
    targetTestId: 'nav-spawn-kubex',
    title: 'Spawn Kubex Wizard',
    description:
      'Use the Spawn Kubex wizard to launch a new worker container. The three-step wizard sets the agent identity, capabilities, and image — no manual Dockerfiles required.',
    placement: 'right',
  },
  {
    targetTestId: 'nav-approvals',
    title: 'Approval Queue & HITL',
    description:
      'High-risk agent actions require human sign-off before execution. The Approvals page lists pending escalations — a badge on this link shows the count of actions waiting for your review.',
    placement: 'right',
  },
];

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TooltipPos {
  top: number;
  left: number;
}

const PAD = 8; // spotlight padding in px

function resolveSpotlight(el: Element): SpotlightRect {
  const r = el.getBoundingClientRect();
  return {
    top: r.top - PAD,
    left: r.left - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
  };
}

function resolveTooltipPos(
  spot: SpotlightRect,
  placement: TourStep['placement'],
  tooltipWidth: number,
  tooltipHeight: number,
): TooltipPos {
  const GAP = 12;
  switch (placement) {
    case 'bottom':
      return {
        top: spot.top + spot.height + GAP,
        left: spot.left + spot.width / 2 - tooltipWidth / 2,
      };
    case 'bottom-left':
      return {
        top: spot.top + spot.height + GAP,
        left: Math.max(8, spot.left + spot.width - tooltipWidth),
      };
    case 'bottom-right':
      return {
        top: spot.top + spot.height + GAP,
        left: spot.left,
      };
    case 'right':
      return {
        top: spot.top + spot.height / 2 - tooltipHeight / 2,
        left: spot.left + spot.width + GAP,
      };
    case 'left':
      return {
        top: spot.top + spot.height / 2 - tooltipHeight / 2,
        left: spot.left - tooltipWidth - GAP,
      };
  }
}

interface OnboardingTourProps {
  /** Whether the tour is currently active */
  active: boolean;
  /** 0-based index of the current step */
  currentStep: number;
  onNext: () => void;
  onSkip: () => void;
}

export default function OnboardingTour({
  active,
  currentStep,
  onNext,
  onSkip,
}: OnboardingTourProps) {
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPos>({ top: 0, left: 0 });
  const step = STEPS[currentStep] ?? STEPS[0];
  const isLast = currentStep === TOUR_STEP_COUNT - 1;

  const updatePositions = useCallback(() => {
    const el = document.querySelector(`[data-testid="${step.targetTestId}"]`);
    if (!el) return;
    const spot = resolveSpotlight(el);
    setSpotlight(spot);
    const tw = tooltipRef.current?.offsetWidth ?? 300;
    const th = tooltipRef.current?.offsetHeight ?? 160;
    setTooltipPos(resolveTooltipPos(spot, step.placement, tw, th));
  }, [step]);

  // Recalculate on step change and on resize
  useEffect(() => {
    if (!active) return;
    // Small delay lets layout settle after navigation
    const id = setTimeout(updatePositions, 80);
    window.addEventListener('resize', updatePositions);
    return () => {
      clearTimeout(id);
      window.removeEventListener('resize', updatePositions);
    };
  }, [active, updatePositions]);

  if (!active || !spotlight) return null;

  const { top: sTop, left: sLeft, width: sW, height: sH } = spotlight;

  return (
    <>
      {/* Overlay with spotlight cutout via clip-path */}
      <div
        data-testid="onboarding-overlay"
        aria-hidden="true"
        onClick={onSkip}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9000,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(2px)',
          clipPath: `polygon(
            0% 0%, 100% 0%, 100% 100%, 0% 100%,
            0% ${sTop}px,
            ${sLeft}px ${sTop}px,
            ${sLeft}px ${sTop + sH}px,
            ${sLeft + sW}px ${sTop + sH}px,
            ${sLeft + sW}px ${sTop}px,
            0% ${sTop}px,
            0% 0%
          )`,
        }}
      />

      {/* Spotlight ring */}
      <div
        data-testid="onboarding-spotlight"
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: sTop,
          left: sLeft,
          width: sW,
          height: sH,
          zIndex: 9001,
          borderRadius: 10,
          boxShadow: '0 0 0 3px rgba(52, 211, 153, 0.8)',
          pointerEvents: 'none',
        }}
      />

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="false"
        aria-label={`Onboarding step ${currentStep + 1} of ${TOUR_STEP_COUNT}: ${step.title}`}
        data-testid="onboarding-tooltip"
        style={{
          position: 'fixed',
          top: tooltipPos.top,
          left: Math.max(8, Math.min(tooltipPos.left, window.innerWidth - 320)),
          zIndex: 9002,
          width: 300,
        }}
        className="rounded-xl border border-emerald-500/40 bg-[var(--color-surface)] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-emerald-500/10">
          <div className="flex items-center gap-2">
            {/* Step dots */}
            <div className="flex items-center gap-1" aria-hidden="true">
              {Array.from({ length: TOUR_STEP_COUNT }).map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i === currentStep
                      ? 'bg-emerald-400'
                      : i < currentStep
                      ? 'bg-emerald-600'
                      : 'bg-[var(--color-border)]'
                  }`}
                />
              ))}
            </div>
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {currentStep + 1} / {TOUR_STEP_COUNT}
            </span>
          </div>
          <button
            onClick={onSkip}
            data-testid="onboarding-skip"
            aria-label="Skip onboarding tour"
            className="text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3">
          <h3
            data-testid="onboarding-step-title"
            className="text-sm font-semibold text-[var(--color-text)] mb-1"
          >
            {step.title}
          </h3>
          <p
            data-testid="onboarding-step-description"
            className="text-xs text-[var(--color-text-dim)] leading-relaxed"
          >
            {step.description}
          </p>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
          <button
            onClick={onSkip}
            data-testid="onboarding-skip-link"
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-dim)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
          >
            Skip tour
          </button>
          <button
            onClick={onNext}
            data-testid="onboarding-next"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface)]"
          >
            {isLast ? 'Done' : 'Next'}
            {!isLast && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
