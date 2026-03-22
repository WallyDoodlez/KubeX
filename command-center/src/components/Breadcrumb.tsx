import { useNavigate } from 'react-router-dom';

export interface BreadcrumbItem {
  label: string;
  path?: string;
  /** aria-label override for screen readers */
  ariaLabel?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  /** Extra class names for the nav wrapper */
  className?: string;
}

/**
 * Breadcrumb navigation component.
 *
 * Renders a structured breadcrumb trail with:
 * - Semantic <nav aria-label="Breadcrumb"> wrapping an <ol>
 * - aria-current="page" on the last (active) item
 * - Clickable intermediate items that navigate to their path
 * - Keyboard-accessible with focus-visible rings
 *
 * Usage:
 *   <Breadcrumb items={[
 *     { label: 'Agents', path: '/agents' },
 *     { label: 'agent-alpha-001' },
 *   ]} />
 */
export default function Breadcrumb({ items, className = '' }: BreadcrumbProps) {
  const navigate = useNavigate();

  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="breadcrumb"
      className={`flex items-center ${className}`}
    >
      <ol
        role="list"
        className="flex items-center gap-0 flex-wrap"
        aria-label="You are here:"
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isFirst = index === 0;

          return (
            <li
              key={`${item.path ?? 'leaf'}-${index}`}
              className="flex items-center"
            >
              {/* Separator (shown before every item except the first) */}
              {!isFirst && (
                <span
                  aria-hidden="true"
                  className="mx-1.5 text-[var(--color-text-muted)] text-xs select-none"
                >
                  /
                </span>
              )}

              {/* Item — last item is non-interactive, others are buttons */}
              {isLast || !item.path ? (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  aria-label={item.ariaLabel}
                  className={`
                    text-xs font-medium
                    ${isLast
                      ? 'text-[var(--color-text-secondary)] max-w-[200px] truncate'
                      : 'text-[var(--color-text-dim)]'
                    }
                  `}
                  title={isLast && item.label.length > 24 ? item.label : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <button
                  onClick={() => item.path && navigate(item.path)}
                  aria-label={item.ariaLabel ?? `Go to ${item.label}`}
                  className="
                    text-xs font-medium text-emerald-400 hover:text-emerald-300
                    transition-colors underline-offset-2 hover:underline
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
                    focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-dark)]
                    rounded-sm px-0.5
                  "
                >
                  {item.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
