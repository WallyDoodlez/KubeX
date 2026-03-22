import { useEffect, useRef, useState } from 'react';

interface KillAllDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  kubexCount?: number;
  isLoading?: boolean;
}

const CONFIRMATION_PHRASE = 'KILL ALL';

export default function KillAllDialog({
  isOpen,
  onClose,
  onConfirm,
  kubexCount,
  isLoading = false,
}: KillAllDialogProps) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setInputValue('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const confirmed = inputValue === CONFIRMATION_PHRASE;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kill-all-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog panel */}
      <div className="relative z-10 w-full max-w-md mx-4 bg-[var(--color-surface-dark)] border border-red-500/40 rounded-xl shadow-2xl p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center text-lg">
            ⚠
          </div>
          <div>
            <h2 id="kill-all-title" className="text-base font-semibold text-red-400">
              Kill All Kubexes
            </h2>
            <p className="text-xs text-[var(--color-text-dim)]">
              {kubexCount !== undefined
                ? `This will immediately stop ${kubexCount} running kubex${kubexCount !== 1 ? 'es' : ''}.`
                : 'This will immediately stop all running kubexes.'}
            </p>
          </div>
        </div>

        {/* Warning */}
        <div className="mb-5 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-xs text-red-300 leading-relaxed">
            All running agents will be forcefully terminated. Active tasks will be abandoned.
            This action cannot be undone.
          </p>
        </div>

        {/* Typed confirmation */}
        <div className="mb-5">
          <label htmlFor="kill-all-input" className="block text-xs text-[var(--color-text-dim)] mb-1.5">
            Type <span className="font-mono font-bold text-red-400">{CONFIRMATION_PHRASE}</span> to confirm:
          </label>
          <input
            id="kill-all-input"
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && confirmed && !isLoading) onConfirm(); }}
            placeholder={CONFIRMATION_PHRASE}
            autoComplete="off"
            className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg text-sm font-mono text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-red-500/60 transition-colors"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!confirmed || isLoading}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600/20 text-red-400 border border-red-500/40 hover:bg-red-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {isLoading ? 'Killing…' : 'Kill All Kubexes'}
          </button>
        </div>
      </div>
    </div>
  );
}
