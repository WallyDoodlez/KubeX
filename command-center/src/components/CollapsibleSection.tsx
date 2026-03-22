import { useRef, useEffect, useState } from 'react';

interface CollapsibleSectionProps {
  /** Unique identifier for this section (used as data-testid and aria labels) */
  sectionId: string;
  /** Section header title */
  title: string;
  /** Optional subtitle shown next to the title */
  subtitle?: string;
  /** Optional action button in the header */
  action?: { label: string; onClick: () => void };
  /** Whether the section is currently collapsed */
  collapsed: boolean;
  /** Callback to toggle collapse state */
  onToggle: () => void;
  /** Section content */
  children: React.ReactNode;
}

/**
 * A section wrapper with a clickable header that toggles content visibility.
 * Supports smooth height transition and a chevron indicator.
 * Collapse state is managed externally (typically via useCollapsible).
 */
export default function CollapsibleSection({
  sectionId,
  title,
  subtitle,
  action,
  collapsed,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<string | number>(collapsed ? 0 : 'auto');
  const [isAnimating, setIsAnimating] = useState(false);

  // Handle height transitions when collapsed state changes
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    if (collapsed) {
      // Collapse: set explicit pixel height first (for transition start), then animate to 0
      const scrollH = el.scrollHeight;
      el.style.height = `${scrollH}px`;
      // Force reflow so the browser registers the starting height
      void el.offsetHeight;
      setIsAnimating(true);
      setHeight(0);
    } else {
      // Expand: animate from 0 to scrollHeight, then release to 'auto'
      setIsAnimating(true);
      setHeight(el.scrollHeight);
    }
  }, [collapsed]);

  // When expand animation ends, release height to 'auto' so content can grow freely
  const handleTransitionEnd = () => {
    if (!collapsed) {
      setHeight('auto');
    }
    setIsAnimating(false);
  };

  const headerId = `collapsible-header-${sectionId}`;
  const panelId = `collapsible-panel-${sectionId}`;

  return (
    <section data-testid={`collapsible-section-${sectionId}`}>
      {/* Clickable header */}
      <div className="flex items-center justify-between mb-3">
        <button
          id={headerId}
          aria-expanded={!collapsed}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex items-center gap-2 group focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
          data-testid={`collapsible-toggle-${sectionId}`}
        >
          {/* Chevron indicator */}
          <span
            className={`text-[var(--color-text-dim)] transition-transform duration-200 select-none ${
              collapsed ? '-rotate-90' : 'rotate-0'
            }`}
            aria-hidden="true"
          >
            ▾
          </span>
          <div className="text-left">
            <h2 className="text-sm font-semibold text-[var(--color-text)] group-hover:text-emerald-400 transition-colors">
              {title}
            </h2>
            {subtitle && !collapsed && (
              <p className="text-xs text-[var(--color-text-dim)]">{subtitle}</p>
            )}
          </div>
        </button>

        {/* Right-side action button — only shown when expanded */}
        {action && !collapsed && (
          <button
            onClick={action.onClick}
            className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            {action.label}
          </button>
        )}
      </div>

      {/* Collapsible content panel */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        ref={contentRef}
        style={{
          height: height === 'auto' ? undefined : height,
          overflow: isAnimating || collapsed ? 'hidden' : undefined,
          transition: 'height 200ms ease-in-out',
        }}
        onTransitionEnd={handleTransitionEnd}
        data-testid={`collapsible-content-${sectionId}`}
      >
        {children}
      </div>
    </section>
  );
}
