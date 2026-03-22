import { useEffect, useRef, useState } from 'react';
import { getKubexes, killKubex, startKubex } from '../api';
import type { Kubex } from '../types';
import { useToast } from '../context/ToastContext';

export default function QuickActionsMenu() {
  const [open, setOpen] = useState(false);
  const [kubexes, setKubexes] = useState<Kubex[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { addToast } = useToast();

  // Load kubexes when menu opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getKubexes().then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok && res.data) {
        setKubexes(res.data);
      } else {
        addToast('Failed to load kubexes', 'error');
      }
    });
    return () => { cancelled = true; };
  }, [open, addToast]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function handleKill(kubex: Kubex) {
    setActionInFlight(kubex.kubex_id);
    const res = await killKubex(kubex.kubex_id);
    setActionInFlight(null);
    if (res.ok) {
      addToast(`Killed ${kubex.container_name ?? kubex.kubex_id}`, 'success');
      setKubexes((prev) =>
        prev.map((k) => (k.kubex_id === kubex.kubex_id ? { ...k, status: 'stopped' } : k)),
      );
    } else {
      addToast(`Failed to kill ${kubex.container_name ?? kubex.kubex_id}`, 'error');
    }
  }

  async function handleStart(kubex: Kubex) {
    setActionInFlight(kubex.kubex_id);
    const res = await startKubex(kubex.kubex_id);
    setActionInFlight(null);
    if (res.ok) {
      addToast(`Started ${kubex.container_name ?? kubex.kubex_id}`, 'success');
      setKubexes((prev) =>
        prev.map((k) => (k.kubex_id === kubex.kubex_id ? { ...k, status: 'running' } : k)),
      );
    } else {
      addToast(`Failed to start ${kubex.container_name ?? kubex.kubex_id}`, 'error');
    }
  }

  const statusColor: Record<string, string> = {
    running: 'text-emerald-400',
    created: 'text-blue-400',
    stopped: 'text-[var(--color-text-dim)]',
    exited:  'text-[var(--color-text-dim)]',
    error:   'text-red-400',
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Quick Actions"
        data-testid="quick-actions-button"
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] transition-all"
      >
        <span>⚡</span>
        <span>Quick Actions</span>
        <span className={`transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Kubex quick actions"
          data-testid="quick-actions-menu"
          className="absolute right-0 top-full mt-1 w-72 bg-[var(--color-surface-dark)] border border-[var(--color-border)] rounded-xl shadow-2xl z-40 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-[var(--color-border)]">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)]">
              Kubex Instances
            </p>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {loading && (
              <div className="px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">Loading…</div>
            )}

            {!loading && kubexes.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">No kubexes found</div>
            )}

            {!loading && kubexes.map((kubex) => {
              const isActive = actionInFlight === kubex.kubex_id;
              const isRunning = kubex.status === 'running';
              const name = kubex.container_name ?? kubex.kubex_id.slice(0, 16);

              return (
                <div
                  key={kubex.kubex_id}
                  role="menuitem"
                  className="flex items-center justify-between px-3 py-2 hover:bg-[var(--color-surface)] transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-[var(--color-text)] truncate">{name}</p>
                    <p className={`text-[10px] ${statusColor[kubex.status] ?? 'text-[var(--color-text-dim)]'}`}>
                      {kubex.status}
                    </p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0 ml-2">
                    {isRunning ? (
                      <button
                        onClick={() => handleKill(kubex)}
                        disabled={isActive}
                        aria-label={`Kill ${name}`}
                        className="px-2 py-1 text-[10px] font-medium rounded bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50 transition-all"
                      >
                        {isActive ? '…' : 'Kill'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStart(kubex)}
                        disabled={isActive}
                        aria-label={`Start ${name}`}
                        className="px-2 py-1 text-[10px] font-medium rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50 transition-all"
                      >
                        {isActive ? '…' : 'Start'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
