import { useState, useCallback } from 'react';
import type { Kubex } from '../types';
import { getKubexes, killKubex, startKubex } from '../api';
import StatusBadge from './StatusBadge';
import { usePolling } from '../hooks/usePolling';

export default function ContainersPanel() {
  const [kubexes, setKubexes] = useState<Kubex[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionIn, setActionIn] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getKubexes();
    if (res.ok && Array.isArray(res.data)) {
      setKubexes(res.data);
    } else {
      setError(res.error ?? `HTTP ${res.status}`);
    }
    setLoading(false);
  }, []);

  const { refresh } = usePolling(load, { interval: 10_000, immediate: true, pauseOnHidden: true, maxBackoff: 4 });

  async function handleKill(kubexId: string) {
    if (!confirm(`Kill kubex "${kubexId}"?`)) return;
    setActionIn(kubexId);
    await killKubex(kubexId);
    setActionIn(null);
    await load();
  }

  async function handleStart(kubexId: string) {
    setActionIn(kubexId);
    await startKubex(kubexId);
    setActionIn(null);
    await load();
  }

  const running = kubexes.filter((k) => k.status === 'running').length;
  const stopped = kubexes.filter((k) => k.status === 'stopped' || k.status === 'error').length;

  return (
    <div className="p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-[#e2e8f0]">Docker Containers (Kubexes)</h2>
          <p className="text-xs text-[#64748b]">
            Managed by Kubex Manager — {running} running, {stopped} stopped
          </p>
        </div>
        <button
          onClick={refresh}
          className="px-3 py-1.5 text-xs rounded-lg border border-[#2a2f45] text-[#94a3b8] hover:border-[#3a3f5a] hover:text-[#e2e8f0] transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Manager unreachable: {error}
          <span className="block text-xs mt-0.5 text-red-400/70">
            Ensure the KUBEX_MGMT_TOKEN is set correctly.
          </span>
        </div>
      )}

      {loading && kubexes.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-[#1a1d27] border border-[#2a2f45] animate-pulse" />
          ))}
        </div>
      ) : kubexes.length === 0 ? (
        <EmptyContainers />
      ) : (
        <div className="rounded-xl border border-[#2a2f45] overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_2fr_1fr_2fr_auto] gap-4 px-4 py-2.5 border-b border-[#2a2f45] bg-[#12151f]">
            {['Kubex ID', 'Agent', 'Status', 'Image', 'Actions'].map((h) => (
              <span key={h} className="text-[10px] uppercase tracking-widest font-semibold text-[#3a3f5a]">
                {h}
              </span>
            ))}
          </div>

          {kubexes.map((kubex, idx) => (
            <KubexRow
              key={kubex.kubex_id}
              kubex={kubex}
              isLast={idx === kubexes.length - 1}
              actionIn={actionIn === kubex.kubex_id}
              onKill={() => handleKill(kubex.kubex_id)}
              onStart={() => handleStart(kubex.kubex_id)}
            />
          ))}
        </div>
      )}

      {/* Summary footer */}
      {kubexes.length > 0 && (
        <div className="mt-4 flex items-center gap-4 text-xs text-[#64748b]">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {running} running
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            {kubexes.filter((k) => k.status === 'created').length} created
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
            {stopped} stopped/error
          </span>
          <span className="ml-auto font-mono-data">{kubexes.length} total</span>
        </div>
      )}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────

interface KubexRowProps {
  kubex: Kubex;
  isLast: boolean;
  actionIn: boolean;
  onKill: () => void;
  onStart: () => void;
}

function KubexRow({ kubex, isLast, actionIn, onKill, onStart }: KubexRowProps) {
  const isRunning = kubex.status === 'running';

  return (
    <div
      className={`
        grid grid-cols-[2fr_2fr_1fr_2fr_auto] gap-4 px-4 py-3 items-center
        bg-[#1a1d27] hover:bg-[#20243a] transition-colors
        ${!isLast ? 'border-b border-[#2a2f45]' : ''}
      `}
    >
      {/* Kubex ID */}
      <span className="font-mono-data text-sm text-[#e2e8f0] truncate" title={kubex.kubex_id}>
        {kubex.kubex_id}
      </span>

      {/* Agent ID */}
      <span className="font-mono-data text-sm text-[#94a3b8] truncate" title={kubex.agent_id ?? '—'}>
        {kubex.agent_id ?? <span className="text-[#3a3f5a]">—</span>}
      </span>

      {/* Status */}
      <StatusBadge status={kubex.status} />

      {/* Image */}
      <span className="font-mono-data text-xs text-[#64748b] truncate" title={kubex.image ?? '—'}>
        {kubex.image ?? '—'}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {isRunning ? (
          <button
            onClick={onKill}
            disabled={actionIn}
            className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            {actionIn ? '…' : 'Kill'}
          </button>
        ) : (
          <button
            onClick={onStart}
            disabled={actionIn}
            className="px-2 py-1 text-[10px] rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
          >
            {actionIn ? '…' : 'Start'}
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyContainers() {
  return (
    <div className="rounded-xl border border-dashed border-[#2a2f45] bg-[#1a1d27] p-12 text-center">
      <p className="text-3xl mb-3">⬡</p>
      <p className="text-sm font-medium text-[#94a3b8]">No kubexes found</p>
      <p className="text-xs text-[#64748b] mt-1">
        Kubexes appear here when spawned via Manager.
      </p>
    </div>
  );
}
