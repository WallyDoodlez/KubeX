import { useState, useRef, useEffect, useCallback } from 'react';

interface ExportMenuProps {
  /** Called when the user chooses JSON export */
  onExportJSON: () => void;
  /** Called when the user chooses CSV export — omit to hide the CSV option */
  onExportCSV?: () => void;
  /** Label shown on the trigger button. Defaults to "Export" */
  label?: string;
  /** data-testid for the trigger button */
  testId?: string;
  /** Whether the export options should be disabled (e.g. nothing to export) */
  disabled?: boolean;
}

/**
 * A small dropdown button that offers "Export as JSON" and optionally
 * "Export as CSV" actions. Closes on Escape or outside-click.
 */
export default function ExportMenu({
  onExportJSON,
  onExportCSV,
  label = 'Export',
  testId = 'export-menu',
  disabled = false,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, close]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, close]);

  function handleJSON() {
    close();
    onExportJSON();
  }

  function handleCSV() {
    close();
    onExportCSV?.();
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        data-testid={testId}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="
          flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg
          border border-[var(--color-border)] text-[var(--color-text-secondary)]
          hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]
          disabled:opacity-40 disabled:cursor-not-allowed
          transition-colors select-none
        "
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="w-3.5 h-3.5"
        >
          <path d="M8 2v8M5 7l3 3 3-3M3 12h10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {label}
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          data-testid={`${testId}-dropdown`}
          className="
            absolute right-0 mt-1 z-50
            w-44 rounded-xl border border-[var(--color-border)]
            bg-[var(--color-surface-dark)] shadow-lg
            py-1 text-xs text-[var(--color-text-secondary)]
          "
        >
          <button
            role="menuitem"
            data-testid={`${testId}-json`}
            onClick={handleJSON}
            className="
              w-full text-left px-4 py-2
              hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]
              transition-colors flex items-center gap-2
            "
          >
            <span className="font-mono-data text-emerald-400 text-[10px]">{ }</span>
            Export as JSON
          </button>

          {onExportCSV && (
            <button
              role="menuitem"
              data-testid={`${testId}-csv`}
              onClick={handleCSV}
              className="
                w-full text-left px-4 py-2
                hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]
                transition-colors flex items-center gap-2
              "
            >
              <span className="font-mono-data text-blue-400 text-[10px]">CSV</span>
              Export as CSV
            </button>
          )}
        </div>
      )}
    </div>
  );
}
