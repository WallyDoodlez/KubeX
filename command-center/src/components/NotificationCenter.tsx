import { useState, useRef, useEffect, useCallback } from 'react';
import { useNotifications } from '../context/NotificationContext';
import type { NotificationEntry } from '../context/NotificationContext';

// ── Helpers ───────────────────────────────────────────────────────────

const TYPE_STYLES: Record<NotificationEntry['type'], { icon: string; iconColor: string; bar: string }> = {
  success: { icon: '✓', iconColor: 'text-emerald-400', bar: 'bg-emerald-500' },
  error:   { icon: '✕', iconColor: 'text-red-400',     bar: 'bg-red-500'     },
  warning: { icon: '⚠', iconColor: 'text-amber-400',   bar: 'bg-amber-500'   },
  info:    { icon: 'ℹ', iconColor: 'text-blue-400',    bar: 'bg-blue-500'    },
};

function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffSec < 5)  return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24)  return `${diffHr}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Sub-components ────────────────────────────────────────────────────

function NotificationItem({ notification }: { notification: NotificationEntry }) {
  const styles = TYPE_STYLES[notification.type];
  return (
    <li
      data-testid="notification-item"
      data-read={notification.read ? 'true' : 'false'}
      className={`relative flex items-start gap-3 px-4 py-3 border-b border-[var(--color-border)] transition-colors
        ${notification.read ? 'opacity-60' : 'bg-[var(--color-surface)]/30'}`}
    >
      {/* Type accent bar */}
      <div
        aria-hidden="true"
        className={`absolute left-0 top-0 bottom-0 w-0.5 ${styles.bar}`}
      />

      {/* Icon */}
      <span
        aria-hidden="true"
        className={`flex-shrink-0 font-bold text-sm mt-0.5 ${styles.iconColor}`}
      >
        {styles.icon}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[var(--color-text)] leading-snug break-words">
          {notification.message}
        </p>
        <time
          dateTime={notification.timestamp.toISOString()}
          className="text-[10px] text-[var(--color-text-muted)] mt-1 block"
        >
          {formatTimestamp(notification.timestamp)}
        </time>
      </div>

      {/* Unread indicator dot */}
      {!notification.read && (
        <span
          aria-hidden="true"
          className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5"
        />
      )}
    </li>
  );
}

// ── Main Component ────────────────────────────────────────────────────

/**
 * NotificationCenter
 *
 * Bell icon button in the top bar that shows unread count badge.
 * Clicking opens a dropdown with scrollable notification history.
 * All toasts added via ToastContext are mirrored here via addNotification.
 */
export default function NotificationCenter() {
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
    } else {
      document.removeEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open, handleOutsideClick]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Mark all as read when dropdown is opened
  const handleToggle = useCallback(() => {
    setOpen((o) => {
      if (!o && unreadCount > 0) {
        // Mark all read after a short delay so the badges animate out visibly
        setTimeout(markAllRead, 300);
      }
      return !o;
    });
  }, [unreadCount, markAllRead]);

  return (
    <div ref={containerRef} className="relative">
      {/* Bell button */}
      <button
        data-testid="notification-bell"
        onClick={handleToggle}
        aria-label={
          unreadCount > 0
            ? `Notifications — ${unreadCount} unread`
            : 'Notifications'
        }
        aria-expanded={open}
        aria-haspopup="true"
        className="relative flex items-center justify-center w-7 h-7 text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded-lg hover:border-[var(--color-border-hover)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-dark)]"
      >
        {/* Bell icon */}
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span
            data-testid="notification-badge"
            aria-hidden="true"
            className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center text-[9px] font-bold bg-emerald-500 text-white rounded-full leading-none"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          data-testid="notification-dropdown"
          role="dialog"
          aria-label="Notification history"
          className="absolute right-0 top-full mt-2 z-50 w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-dark)] shadow-xl shadow-black/40 overflow-hidden flex flex-col"
          style={{ maxHeight: '400px' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] flex-shrink-0">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              Notifications
              {notifications.length > 0 && (
                <span className="ml-2 text-xs text-[var(--color-text-muted)] font-normal">
                  {notifications.length} total
                </span>
              )}
            </h2>
            <div className="flex items-center gap-2">
              {notifications.length > 0 && (
                <>
                  <button
                    data-testid="notification-mark-all-read"
                    onClick={markAllRead}
                    className="text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 rounded px-1"
                  >
                    Mark all read
                  </button>
                  <span aria-hidden="true" className="text-[var(--color-border)] text-xs">|</span>
                  <button
                    data-testid="notification-clear-all"
                    onClick={clearAll}
                    className="text-[10px] text-[var(--color-text-dim)] hover:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 rounded px-1"
                  >
                    Clear all
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Notification list */}
          <div
            className="overflow-y-auto flex-1 scrollbar-thin"
            role="log"
            aria-label="Notification history list"
            aria-live="polite"
          >
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <span aria-hidden="true" className="text-2xl mb-2 text-[var(--color-text-muted)]">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </span>
                <p className="text-sm text-[var(--color-text-dim)]">No notifications yet</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Toasts, errors, and alerts will appear here.
                </p>
              </div>
            ) : (
              <ul role="list" aria-label="Notifications">
                {notifications.map((n) => (
                  <NotificationItem key={n.id} notification={n} />
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-[var(--color-border)] flex-shrink-0">
              <p className="text-[10px] text-[var(--color-text-muted)]">
                Last {Math.min(notifications.length, 100)} events · Clears on page reload
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
