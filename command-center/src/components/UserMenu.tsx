/**
 * UserMenu — top-bar avatar / username dropdown with logout.
 *
 * Rendered in Layout.tsx when:
 *   - OAuth is configured (oauthEnabled=true), OR
 *   - A legacy bearer token is present (for context — shows a generic "API" icon)
 *
 * The dropdown contains:
 *   - User name + email (OAuth) or "Bearer token" label (legacy)
 *   - Logout / Clear token button
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

export default function UserMenu() {
  const { user, oauthEnabled, isAuthenticated, logout, token } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, close]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Don't render when not authenticated (covers both modes)
  if (!isAuthenticated && !token) return null;

  const displayName = user?.name ?? (oauthEnabled ? 'Signed in' : 'API Token');
  const displayEmail = user?.email ?? (oauthEnabled ? '' : token ? 'Bearer token active' : '');
  const initials = user?.name
    ? user.name
        .split(' ')
        .slice(0, 2)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
    : oauthEnabled
      ? '?'
      : 'T';

  return (
    <div className="relative" ref={menuRef} data-testid="user-menu">
      {/* Trigger */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        data-testid="user-menu-trigger"
        aria-label={`User menu — ${displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-[var(--color-surface)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-dark)]"
      >
        {/* Avatar */}
        {user?.picture ? (
          <img
            src={user.picture}
            alt={displayName}
            className="w-6 h-6 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div
            aria-hidden="true"
            className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
          >
            {initials}
          </div>
        )}
        <span className="hidden sm:inline text-xs font-medium text-[var(--color-text-secondary)] max-w-[7rem] truncate">
          {displayName}
        </span>
        <span aria-hidden="true" className="hidden sm:inline text-[8px] text-[var(--color-text-muted)]">
          ▾
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="menu"
          aria-label="User options"
          data-testid="user-menu-dropdown"
          className="
            absolute right-0 top-full mt-1 w-52 rounded-xl border border-[var(--color-border)]
            shadow-2xl z-50 overflow-hidden
          "
          style={{ background: 'var(--color-surface-dark)' }}
        >
          {/* Profile header */}
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <p className="text-sm font-semibold text-[var(--color-text)] truncate">{displayName}</p>
            {displayEmail && (
              <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">{displayEmail}</p>
            )}
            {oauthEnabled && (
              <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 rounded-full px-1.5 py-0.5">
                <span aria-hidden="true" className="text-[8px]">●</span>
                OAuth
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="p-1">
            <button
              role="menuitem"
              onClick={() => {
                close();
                logout();
              }}
              data-testid="user-menu-logout"
              className="
                w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left
                text-[var(--color-text-dim)] hover:bg-red-500/10 hover:text-red-400
                transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500
              "
            >
              <span aria-hidden="true" className="text-sm">⏏</span>
              {oauthEnabled ? 'Sign out' : 'Clear token'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
