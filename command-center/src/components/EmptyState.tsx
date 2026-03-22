/**
 * EmptyState — reusable empty state component for panels and lists.
 *
 * Usage:
 *   <EmptyState
 *     icon="◎"
 *     title="No agents registered"
 *     description="Agents will appear here once they connect to the registry."
 *     action={{ label: 'Refresh', onClick: handleRefresh }}
 *   />
 */

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  /** Optional icon character or emoji. */
  icon?: string;
  /** Primary heading. */
  title: string;
  /** Optional supporting description text. */
  description?: string;
  /** Optional call-to-action button. */
  action?: EmptyStateAction;
  /** Additional className override for the container. */
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-label={title}
      className={`flex flex-col items-center justify-center py-16 px-6 text-center ${className}`}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-dark)] text-2xl text-[var(--color-text-muted)]"
        >
          {icon}
        </div>
      )}

      <p className="text-sm font-semibold text-[var(--color-text-secondary)]">{title}</p>

      {description && (
        <p className="mt-1.5 max-w-xs text-xs text-[var(--color-text-muted)] leading-relaxed">{description}</p>
      )}

      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)] transition-all hover:border-emerald-500/40 hover:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
