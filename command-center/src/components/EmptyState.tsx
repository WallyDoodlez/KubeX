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
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[#2a2f45] bg-[#12151f] text-2xl text-[#3a3f5a]"
        >
          {icon}
        </div>
      )}

      <p className="text-sm font-semibold text-[#94a3b8]">{title}</p>

      {description && (
        <p className="mt-1.5 max-w-xs text-xs text-[#3a3f5a] leading-relaxed">{description}</p>
      )}

      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 rounded-lg border border-[#2a2f45] bg-[#1a1d27] px-4 py-2 text-xs font-medium text-[#94a3b8] transition-all hover:border-emerald-500/40 hover:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1117]"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
