interface BulkAction {
  /** Button label */
  label: string;
  /** Called when the action button is clicked */
  onClick: () => void;
  /** Visual variant — affects button colour */
  variant?: 'danger' | 'warning' | 'success' | 'default';
  /** Disable the action button (e.g. while a previous action is in progress) */
  disabled?: boolean;
  /** data-testid for the action button */
  testId?: string;
}

interface SelectionBarProps {
  /** Number of currently selected items */
  selectedCount: number;
  /** Noun used in the label — e.g. "agent" → "3 agents selected" */
  itemNoun?: string;
  /** List of bulk actions to show as buttons */
  actions: BulkAction[];
  /** Called when the "✕ Clear" button is clicked */
  onClear: () => void;
  /** data-testid for the bar root */
  testId?: string;
}

const variantClasses: Record<NonNullable<BulkAction['variant']>, string> = {
  danger:
    'border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50',
  warning:
    'border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 disabled:opacity-50',
  success:
    'border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50',
  default:
    'border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] disabled:opacity-50',
};

/**
 * SelectionBar — floating action bar that appears when one or more table rows
 * are selected. Shows the selected count and renders bulk-action buttons.
 *
 * Rendered at the bottom of the panel, above the Pagination row, so it
 * doesn't interrupt the table layout.
 */
export default function SelectionBar({
  selectedCount,
  itemNoun = 'item',
  actions,
  onClear,
  testId = 'selection-bar',
}: SelectionBarProps) {
  if (selectedCount === 0) return null;

  const noun = selectedCount === 1 ? itemNoun : `${itemNoun}s`;

  return (
    <div
      data-testid={testId}
      role="toolbar"
      aria-label={`${selectedCount} ${noun} selected — bulk actions`}
      className="
        mt-3 flex items-center gap-3 rounded-xl
        border border-[var(--color-border-strong)]
        bg-[var(--color-surface-dark)] px-4 py-2.5
        shadow-lg ring-1 ring-emerald-500/20
        animate-fade-in
      "
    >
      {/* Count badge */}
      <span
        className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text)]"
        data-testid={`${testId}-count`}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
          {selectedCount}
        </span>
        {noun} selected
      </span>

      {/* Divider */}
      <div className="h-4 w-px bg-[var(--color-border)]" />

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            data-testid={action.testId}
            className={`
              px-3 py-1 text-[11px] font-medium rounded-lg transition-colors
              ${variantClasses[action.variant ?? 'default']}
            `}
          >
            {action.label}
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div className="ml-auto" />

      {/* Clear selection */}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        data-testid={`${testId}-clear`}
        className="
          flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg
          text-[var(--color-text-dim)] hover:text-[var(--color-text)]
          hover:bg-[var(--color-surface-hover)] transition-colors
        "
      >
        <svg
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        Clear
      </button>
    </div>
  );
}
