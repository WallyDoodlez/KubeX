import { useState, useRef } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { killAllKubexes, getKubexes } from '../api';
import KillAllDialog from './KillAllDialog';
import QuickActionsMenu from './QuickActionsMenu';
import Toast from './Toast';
import CommandPalette from './CommandPalette';
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import Breadcrumb from './Breadcrumb';
import type { BreadcrumbItem } from './Breadcrumb';

interface NavItem {
  label: string;
  icon: string;
  description: string;
  path: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',    icon: '◈', description: 'System overview',   path: '/'          },
  { label: 'Agents',       icon: '◎', description: 'Registered agents', path: '/agents'    },
  { label: 'Traffic',      icon: '⇌', description: 'Actions log',       path: '/traffic'   },
  { label: 'Orchestrator', icon: '⌘', description: 'Dispatch tasks',    path: '/chat'      },
  { label: 'Containers',   icon: '⬡', description: 'Docker kubexes',    path: '/containers'},
  { label: 'Approvals',    icon: '⚑', description: 'Escalated actions', path: '/approvals' },
];

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { pendingApprovalCount } = useAppContext();
  const { addToast } = useToast();
  const { isConfigured, setToken } = useAuth();

  const [killAllOpen, setKillAllOpen] = useState(false);
  const [killAllLoading, setKillAllLoading] = useState(false);
  const [kubexCount, setKubexCount] = useState<number | undefined>(undefined);
  const [authBannerDismissed, setAuthBannerDismissed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  // "G then X" two-key navigation — store first key with a timeout
  const gKeyPending = useRef(false);
  const gKeyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function startGSequence() {
    gKeyPending.current = true;
    if (gKeyTimer.current) clearTimeout(gKeyTimer.current);
    gKeyTimer.current = setTimeout(() => {
      gKeyPending.current = false;
    }, 1500);
  }

  // ── Global keyboard shortcuts ──────────────────────────────────────
  useKeyboardShortcuts([
    // Ctrl+K — open command palette
    {
      key: 'k',
      ctrl: true,
      description: 'Open command palette',
      allowInInput: true,
      handler: () => setCommandPaletteOpen((o) => !o),
    },
    // ? — show shortcuts help (not in input)
    {
      key: '?',
      description: 'Show keyboard shortcuts',
      handler: () => setShortcutsHelpOpen((o) => !o),
    },
    // Escape — close any overlay
    {
      key: 'Escape',
      description: 'Close overlay',
      allowInInput: true,
      handler: () => {
        if (commandPaletteOpen) { setCommandPaletteOpen(false); return; }
        if (shortcutsHelpOpen) { setShortcutsHelpOpen(false); return; }
        if (killAllOpen) { setKillAllOpen(false); return; }
      },
    },
    // G then D/A/T/C/K/P — go to page (two-key sequence)
    {
      key: 'g',
      description: 'Start navigation sequence (G + key)',
      handler: () => startGSequence(),
    },
    {
      key: 'd',
      description: 'Go to Dashboard (after G)',
      handler: () => {
        if (gKeyPending.current) { gKeyPending.current = false; navigate('/'); }
      },
    },
    {
      key: 'a',
      description: 'Go to Agents (after G)',
      handler: () => {
        if (gKeyPending.current) { gKeyPending.current = false; navigate('/agents'); }
      },
    },
    {
      key: 't',
      description: 'Go to Traffic (after G)',
      handler: () => {
        if (gKeyPending.current) { gKeyPending.current = false; navigate('/traffic'); }
      },
    },
    {
      key: 'c',
      description: 'Go to Chat/Orchestrator (after G)',
      handler: () => {
        if (gKeyPending.current) { gKeyPending.current = false; navigate('/chat'); }
      },
    },
    {
      key: 'k',
      description: 'Go to Containers/Kubexes (after G)',
      handler: () => {
        if (gKeyPending.current) { gKeyPending.current = false; navigate('/containers'); }
      },
    },
    {
      key: 'p',
      description: 'Go to Approvals/Pending (after G)',
      handler: () => {
        if (gKeyPending.current) { gKeyPending.current = false; navigate('/approvals'); }
      },
    },
  ]);

  const currentItem = NAV_ITEMS.find((n) => n.path === location.pathname) ?? NAV_ITEMS[0];

  // Build breadcrumbs for nested routes (e.g. /agents/:agentId)
  const topBarBreadcrumbs: BreadcrumbItem[] | null = (() => {
    // /agents/:agentId
    const agentDetailMatch = location.pathname.match(/^\/agents\/(.+)$/);
    if (agentDetailMatch) {
      return [
        { label: 'Agents', path: '/agents' },
        { label: agentDetailMatch[1] },
      ];
    }
    return null;
  })();

  async function openKillAllDialog() {
    const res = await getKubexes();
    if (res.ok && res.data) {
      const running = res.data.filter((k) => k.status === 'running').length;
      setKubexCount(running);
    } else {
      setKubexCount(undefined);
    }
    setKillAllOpen(true);
  }

  async function handleKillAll() {
    setKillAllLoading(true);
    const res = await killAllKubexes();
    setKillAllLoading(false);
    setKillAllOpen(false);
    if (res.ok) {
      addToast('All kubexes have been killed', 'success');
    } else {
      addToast(`Kill all failed: ${res.error ?? 'Unknown error'}`, 'error');
    }
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      {/* ── Skip-to-content link (visible on focus) ─────────────────── */}
      <a
        href="#main-content"
        className="
          sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50
          focus:rounded-lg focus:bg-emerald-500 focus:px-4 focus:py-2
          focus:text-sm focus:font-semibold focus:text-white
          focus:outline-none focus:ring-2 focus:ring-emerald-300
        "
      >
        Skip to main content
      </a>

      {/* Toast notifications */}
      <Toast />

      {/* Command palette */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />

      {/* Keyboard shortcuts help overlay */}
      <KeyboardShortcutsHelp
        isOpen={shortcutsHelpOpen}
        onClose={() => setShortcutsHelpOpen(false)}
      />

      {/* Kill All confirmation dialog */}
      <KillAllDialog
        isOpen={killAllOpen}
        onClose={() => setKillAllOpen(false)}
        onConfirm={handleKillAll}
        kubexCount={kubexCount}
        isLoading={killAllLoading}
      />

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside
        aria-label="Application navigation"
        className="w-56 flex-shrink-0 flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-dark)]"
      >
        {/* Brand */}
        <div className="px-4 py-5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2.5">
            <div
              aria-hidden="true"
              className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-sm font-bold text-white"
            >
              K
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--color-text)] leading-none">KubexClaw</p>
              <p className="text-xs text-[var(--color-text-dim)] leading-none mt-0.5">Command Center</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav aria-label="Main navigation" className="flex-1 px-2 py-3 overflow-y-auto">
          <p
            id="nav-heading"
            className="px-2 mb-2 text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)]"
            aria-hidden="true"
          >
            Navigation
          </p>
          <ul role="list" aria-labelledby="nav-heading" className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const active = location.pathname === item.path;
              return (
                <li key={item.path}>
                  <button
                    onClick={() => navigate(item.path)}
                    aria-label={`${item.label} — ${item.description}`}
                    aria-current={active ? 'page' : undefined}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
                      focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-dark)]
                      ${active
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                        : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)] border border-transparent'
                      }
                    `}
                  >
                    <span
                      aria-hidden="true"
                      className={`text-base w-5 text-center flex-shrink-0 ${active ? 'text-emerald-400' : ''}`}
                    >
                      {item.icon}
                    </span>
                    <div className="min-w-0">
                      <p className={`text-sm font-medium leading-none ${active ? 'text-emerald-300' : ''}`}>
                        {item.label}
                      </p>
                      <p className="text-[10px] text-[var(--color-text-muted)] leading-none mt-0.5 truncate">
                        {item.description}
                      </p>
                    </div>
                    {item.label === 'Approvals' && pendingApprovalCount > 0 && !active && (
                      <span
                        aria-label={`${pendingApprovalCount} pending approvals`}
                        className="ml-auto text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full px-1.5 py-0.5 flex-shrink-0"
                      >
                        {pendingApprovalCount}
                      </span>
                    )}
                    {active && (
                      <span aria-hidden="true" className="ml-auto w-1 h-4 rounded-full bg-emerald-400 flex-shrink-0" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--color-border)]">
          <p className="text-[10px] text-[var(--color-text-muted)] font-mono-data">v1.1 · stem cell kubex</p>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main id="main-content" className="flex-1 flex flex-col overflow-hidden" tabIndex={-1}>
        {/* Top bar */}
        <header
          role="banner"
          className="flex-shrink-0 h-12 border-b border-[var(--color-border)] bg-[var(--color-surface-dark)] flex items-center justify-between px-6"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-[var(--color-text-dim)] text-sm">{currentItem.icon}</span>
            <h1 className="text-sm font-semibold text-[var(--color-text)]">{currentItem.label}</h1>
            {topBarBreadcrumbs ? (
              /* Nested route — show breadcrumbs inline in top bar */
              <Breadcrumb
                items={topBarBreadcrumbs}
                className="ml-0"
              />
            ) : (
              <>
                <span aria-hidden="true" className="text-[var(--color-text-muted)] text-sm">/</span>
                <span className="text-xs text-[var(--color-text-dim)]">{currentItem.description}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3" role="toolbar" aria-label="Global controls">
            {/* Command palette trigger */}
            <button
              onClick={() => setCommandPaletteOpen(true)}
              data-testid="command-palette-trigger"
              aria-label="Open command palette (Ctrl+K)"
              aria-keyshortcuts="Control+k"
              className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--color-text-dim)] border border-[var(--color-border)] rounded-lg hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-secondary)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-dark)]"
            >
              <span aria-hidden="true" className="text-sm">⌕</span>
              <span>Search</span>
              <kbd aria-hidden="true" className="ml-1 text-[10px] font-mono border border-[var(--color-border)] rounded px-1">⌘K</kbd>
            </button>

            {/* Keyboard shortcuts help */}
            <button
              onClick={() => setShortcutsHelpOpen(true)}
              data-testid="shortcuts-help-trigger"
              aria-label="Show keyboard shortcuts (?)"
              aria-keyshortcuts="?"
              className="hidden sm:flex w-7 h-7 items-center justify-center text-xs font-semibold text-[var(--color-text-dim)] border border-[var(--color-border)] rounded-lg hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-secondary)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-dark)]"
            >
              ?
            </button>

            <div aria-hidden="true" className="hidden sm:block w-px h-4 bg-[var(--color-border)]" />

            {/* Emergency Controls */}
            <QuickActionsMenu />
            <button
              onClick={openKillAllDialog}
              data-testid="kill-all-button"
              aria-label="Kill all kubexes"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 hover:border-red-500/50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-dark)]"
            >
              <span aria-hidden="true">⏹</span>
              <span>Kill All</span>
            </button>

            <div aria-hidden="true" className="w-px h-4 bg-[var(--color-border)]" />

            <time
              dateTime={new Date().toISOString().split('T')[0]}
              className="text-xs text-[var(--color-text-muted)] font-mono-data"
            >
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </time>
            <div
              role="status"
              aria-label="Connection status: live"
              className="flex items-center gap-1.5 text-xs text-emerald-400"
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono-data">live</span>
            </div>
          </div>
        </header>

        {/* Auth banner — shown when no token is configured */}
        {!isConfigured && !authBannerDismissed && (
          <div
            role="alert"
            aria-live="polite"
            data-testid="auth-banner"
            className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-xs text-amber-300 flex-shrink-0"
          >
            <span>
              <strong>No Manager token configured.</strong> Manager API calls will fail. Set{' '}
              <code className="font-mono text-amber-200">VITE_MANAGER_TOKEN</code> or{' '}
              <button
                onClick={() => {
                  const t = window.prompt('Enter Manager token:');
                  if (t?.trim()) setToken(t.trim());
                }}
                className="underline underline-offset-2 hover:text-amber-200 transition-colors"
              >
                enter a token
              </button>
              .
            </span>
            <button
              onClick={() => setAuthBannerDismissed(true)}
              aria-label="Dismiss auth warning"
              className="flex-shrink-0 text-amber-400 hover:text-amber-200 transition-colors px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Page content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {children}
        </div>
      </main>
    </div>
  );
}
