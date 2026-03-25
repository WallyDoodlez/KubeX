import { memo, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ShortcutRow {
  keys: string[];
  description: string;
}

const SHORTCUT_GROUPS: { heading: string; shortcuts: ShortcutRow[] }[] = [
  {
    heading: 'Global',
    shortcuts: [
      { keys: ['Ctrl', 'K'], description: 'Open command palette' },
      { keys: ['Ctrl', 'D'], description: 'Open quick dispatch modal' },
      { keys: ['?'], description: 'Show / hide this help overlay' },
      { keys: ['Esc'], description: 'Close palette, dialog, or overlay' },
    ],
  },
  {
    heading: 'Navigation',
    shortcuts: [
      { keys: ['G', 'D'], description: 'Go to Dashboard' },
      { keys: ['G', 'A'], description: 'Go to Agents' },
      { keys: ['G', 'T'], description: 'Go to Traffic Log' },
      { keys: ['G', 'C'], description: 'Go to Orchestrator (Chat)' },
      { keys: ['G', 'K'], description: 'Go to Containers (Kubexes)' },
      { keys: ['G', 'P'], description: 'Go to Approvals (Pending)' },
    ],
  },
];

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

function KeyboardShortcutsHelp({ isOpen, onClose }: KeyboardShortcutsHelpProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, isOpen);

  if (!isOpen) return null;

  return (
    /* Backdrop */
    <div
      role="presentation"
      data-testid="shortcuts-help-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-testid="shortcuts-help-panel"
        className="w-full max-w-md mx-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Shortcut groups */}
        <div className="px-5 py-4 space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.heading}>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)] mb-2">
                {group.heading}
              </p>
              <table className="w-full text-sm" role="presentation">
                <tbody>
                  {group.shortcuts.map((row) => (
                    <tr key={row.description} className="border-b border-[var(--color-border)]/50 last:border-0">
                      <td className="py-2 pr-4 w-40">
                        <span className="flex items-center gap-1">
                          {row.keys.map((k, i) => (
                            <span key={i} className="flex items-center gap-1">
                              <kbd className="inline-block rounded border border-[var(--color-border)] bg-[var(--color-surface-dark)] px-1.5 py-0.5 text-[11px] font-mono text-[var(--color-text-secondary)]">
                                {k}
                              </kbd>
                              {i < row.keys.length - 1 && (
                                <span className="text-[var(--color-text-muted)] text-[10px]">then</span>
                              )}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="py-2 text-[var(--color-text-secondary)] text-xs">{row.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]">
          Press <kbd className="font-mono">?</kbd> or <kbd className="font-mono">Esc</kbd> to dismiss
        </div>
      </div>
    </div>
  );
}

export default memo(KeyboardShortcutsHelp);
