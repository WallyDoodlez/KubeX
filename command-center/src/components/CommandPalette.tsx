import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';

// ── Types ────────────────────────────────────────────────────────────

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  category: string;
  action: () => void;
  keywords?: string[];
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  extraCommands?: CommandItem[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function fuzzyMatch(query: string, item: CommandItem): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const label = item.label.toLowerCase();
  const desc = (item.description ?? '').toLowerCase();
  const keywords = (item.keywords ?? []).join(' ').toLowerCase();
  const category = item.category.toLowerCase();
  const searchable = `${label} ${desc} ${keywords} ${category}`;

  // Exact substring match first
  if (searchable.includes(q)) return true;

  // Fuzzy: every character in query appears in label in order
  let qi = 0;
  for (let i = 0; i < label.length && qi < q.length; i++) {
    if (label[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function scoreMatch(query: string, item: CommandItem): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 3;
  if (label.includes(q)) return 2;
  if ((item.description ?? '').toLowerCase().includes(q)) return 1;
  return 0;
}

// ── Component ─────────────────────────────────────────────────────────

function CommandPalette({ isOpen, onClose, extraCommands = [] }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // ── Built-in navigation commands ────────────────────────────────────
  const builtinCommands: CommandItem[] = [
    {
      id: 'nav-dashboard',
      label: 'Go to Dashboard',
      description: 'System overview, health status, metrics',
      icon: '◈',
      category: 'Navigation',
      keywords: ['home', 'overview', 'metrics', 'health'],
      action: () => navigate('/'),
    },
    {
      id: 'nav-agents',
      label: 'Go to Agents',
      description: 'Registered agent list, search & filter',
      icon: '◎',
      category: 'Navigation',
      keywords: ['agents', 'workers', 'list'],
      action: () => navigate('/agents'),
    },
    {
      id: 'nav-traffic',
      label: 'Go to Traffic Log',
      description: 'Action audit log, policy decisions',
      icon: '⇌',
      category: 'Navigation',
      keywords: ['traffic', 'log', 'audit', 'policy', 'actions'],
      action: () => navigate('/traffic'),
    },
    {
      id: 'nav-chat',
      label: 'Go to Orchestrator',
      description: 'Dispatch tasks to agents via chat',
      icon: '⌘',
      category: 'Navigation',
      keywords: ['chat', 'orchestrator', 'dispatch', 'task', 'message'],
      action: () => navigate('/chat'),
    },
    {
      id: 'nav-containers',
      label: 'Go to Containers',
      description: 'Docker kubex containers, start/stop',
      icon: '⬡',
      category: 'Navigation',
      keywords: ['containers', 'docker', 'kubex', 'pods'],
      action: () => navigate('/containers'),
    },
    {
      id: 'nav-approvals',
      label: 'Go to Approvals',
      description: 'Escalated actions awaiting human review',
      icon: '⚑',
      category: 'Navigation',
      keywords: ['approvals', 'escalated', 'review', 'hitl'],
      action: () => navigate('/approvals'),
    },
  ];

  const allCommands = [...builtinCommands, ...extraCommands];

  const filtered = allCommands
    .filter((item) => fuzzyMatch(query, item))
    .sort((a, b) => scoreMatch(query, b) - scoreMatch(query, a));

  // ── Reset state when opened ──────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      // Focus input on next tick after render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // ── Keep selected item in view ───────────────────────────────────────
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // ── Keyboard navigation ──────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[selectedIndex];
        if (item) {
          item.action();
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, selectedIndex, onClose]
  );

  // Reset selectedIndex when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  // Group by category for display
  const grouped: Record<string, CommandItem[]> = {};
  for (const item of filtered) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  // Flat list for index tracking
  const flatList: CommandItem[] = Object.values(grouped).flat();

  return (
    /* Backdrop */
    <div
      role="presentation"
      data-testid="command-palette-backdrop"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        className="w-full max-w-lg mx-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl overflow-hidden"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
          <span aria-hidden="true" className="text-[var(--color-text-dim)] text-sm flex-shrink-0">⌕</span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-autocomplete="list"
            aria-activedescendant={
              filtered[selectedIndex] ? `cmd-item-${filtered[selectedIndex].id}` : undefined
            }
            placeholder="Type a command or search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            data-testid="command-palette-input"
            className="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none"
          />
          <kbd
            aria-hidden="true"
            className="flex-shrink-0 text-[10px] font-mono text-[var(--color-text-muted)] border border-[var(--color-border)] rounded px-1.5 py-0.5"
          >
            esc
          </kbd>
        </div>

        {/* Results */}
        <ul
          id="command-palette-list"
          ref={listRef}
          role="listbox"
          aria-label="Commands"
          data-testid="command-palette-list"
          className="max-h-80 overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]" role="option" aria-selected="false">
              No commands match <strong className="text-[var(--color-text-dim)]">"{query}"</strong>
            </li>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <li key={category} role="presentation">
                <p
                  className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)]"
                  aria-hidden="true"
                >
                  {category}
                </p>
                <ul role="presentation">
                  {items.map((item) => {
                    const flatIdx = flatList.indexOf(item);
                    const isSelected = flatIdx === selectedIndex;
                    return (
                      <li
                        key={item.id}
                        id={`cmd-item-${item.id}`}
                        role="option"
                        aria-selected={isSelected}
                        data-testid={`cmd-item-${item.id}`}
                        className={`
                          flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors
                          ${isSelected
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-dark)] hover:text-[var(--color-text)]'
                          }
                        `}
                        onMouseEnter={() => setSelectedIndex(flatIdx)}
                        onClick={() => {
                          item.action();
                          onClose();
                        }}
                      >
                        {item.icon && (
                          <span
                            aria-hidden="true"
                            className={`text-base w-5 text-center flex-shrink-0 ${isSelected ? 'text-emerald-400' : 'text-[var(--color-text-dim)]'}`}
                          >
                            {item.icon}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium leading-none ${isSelected ? 'text-emerald-300' : 'text-[var(--color-text)]'}`}>
                            {item.label}
                          </p>
                          {item.description && (
                            <p className="text-xs text-[var(--color-text-dim)] leading-none mt-0.5 truncate">
                              {item.description}
                            </p>
                          )}
                        </div>
                        {isSelected && (
                          <kbd
                            aria-hidden="true"
                            className="flex-shrink-0 text-[10px] font-mono text-[var(--color-text-muted)] border border-[var(--color-border)] rounded px-1.5 py-0.5"
                          >
                            ↵
                          </kbd>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>

        {/* Footer hint */}
        <div
          aria-hidden="true"
          className="flex items-center gap-4 px-4 py-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]"
        >
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> select</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
          <span className="ml-auto"><kbd className="font-mono">Ctrl+K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}

export default memo(CommandPalette);
