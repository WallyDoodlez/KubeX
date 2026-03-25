import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { getAgents, dispatchTask } from '../api';
import type { Agent, TrafficEntry } from '../types';
import { validateCapability, validateMessage } from '../utils/validation';
import { useFavorites } from '../hooks/useFavorites';
import { useAppContext } from '../context/AppContext';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface QuickDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-select this agent ID when the modal opens (e.g. from current context). */
  prefilledAgentId?: string;
}

type Priority = 'low' | 'normal' | 'high';

const PRIORITIES: { value: Priority; label: string; color: string }[] = [
  { value: 'low',    label: 'Low',    color: 'text-[var(--color-text-dim)]'  },
  { value: 'normal', label: 'Normal', color: 'text-emerald-400'              },
  { value: 'high',   label: 'High',   color: 'text-amber-400'                },
];

function QuickDispatchModal({ isOpen, onClose, prefilledAgentId }: QuickDispatchModalProps) {
  const { addTrafficEntry } = useAppContext();
  const { favoritesSet } = useFavorites();

  // ── Form state ────────────────────────────────────────────────────
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [capability, setCapability] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');

  // ── Validation errors ─────────────────────────────────────────────
  const [capError, setCapError] = useState<string | null>(null);
  const [msgError, setMsgError] = useState<string | null>(null);

  // ── Dispatch result ───────────────────────────────────────────────
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; taskId?: string } | null>(null);

  // ── Autocomplete state ────────────────────────────────────────────
  const [capSuggestions, setCapSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);

  const capInputRef = useRef<HTMLInputElement>(null);
  const firstFocusRef = useRef<HTMLSelectElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, isOpen);

  // ── Derived: capabilities for selected agent ──────────────────────
  const selectedAgent = agents.find((a) => a.agent_id === selectedAgentId);
  const agentCapabilities: string[] = selectedAgent?.capabilities ?? [];

  // All capabilities across all agents (for autocomplete when no agent selected).
  // Stabilised with useMemo so the suggestions useEffect below only re-runs when
  // the agents list actually changes — not on every render due to a new array ref.
  const allCapabilities: string[] = useMemo(
    () => [...new Set(agents.flatMap((a) => a.capabilities))].sort(),
    [agents]
  );

  const capabilitiesForSuggestion = useMemo(
    () => (agentCapabilities.length > 0 ? agentCapabilities : allCapabilities),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedAgentId, agents, allCapabilities]
  );

  // ── Sorted agents: favorites first ───────────────────────────────
  const sortedAgents = [...agents].sort((a, b) => {
    const aFav = favoritesSet.has(a.agent_id) ? 0 : 1;
    const bFav = favoritesSet.has(b.agent_id) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return a.agent_id.localeCompare(b.agent_id);
  });

  // ── Load agents when modal opens ──────────────────────────────────
  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    const res = await getAgents();
    setAgentsLoading(false);
    if (res.ok && Array.isArray(res.data)) {
      setAgents(res.data as Agent[]);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    // Reset form state on open
    setCapability('');
    setMessage('');
    setPriority('normal');
    setCapError(null);
    setMsgError(null);
    setResult(null);
    setShowSuggestions(false);
    setSuggestionIndex(-1);

    // Apply prefilled agent if provided
    if (prefilledAgentId) {
      setSelectedAgentId(prefilledAgentId);
    } else {
      setSelectedAgentId('');
    }

    loadAgents();

    // Focus the agent selector after render
    requestAnimationFrame(() => firstFocusRef.current?.focus());
  }, [isOpen, prefilledAgentId, loadAgents]);

  // ── Update suggestions as user types ─────────────────────────────
  useEffect(() => {
    // Guard: skip when the modal is closed to avoid running on every render
    if (!isOpen) return;
    if (!capability.trim()) {
      setCapSuggestions((prev) => (prev.length === 0 ? prev : []));
      setShowSuggestions(false);
      return;
    }
    const q = capability.toLowerCase();
    const matches = capabilitiesForSuggestion.filter((c) => c.toLowerCase().includes(q));
    setCapSuggestions(matches);
    setShowSuggestions(matches.length > 0);
    setSuggestionIndex(-1);
  }, [isOpen, capability, capabilitiesForSuggestion]);

  // ── Validate on blur ──────────────────────────────────────────────
  function handleCapBlur() {
    if (capability.trim()) {
      const v = validateCapability(capability);
      setCapError(v.valid ? null : (v.error ?? null));
    }
  }

  function handleMsgBlur() {
    if (message.trim()) {
      const v = validateMessage(message);
      setMsgError(v.valid ? null : (v.error ?? null));
    }
  }

  // ── Autocomplete keyboard nav ─────────────────────────────────────
  function handleCapKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSuggestionIndex((i) => Math.min(i + 1, capSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSuggestionIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && suggestionIndex >= 0) {
      e.preventDefault();
      setCapability(capSuggestions[suggestionIndex]);
      setShowSuggestions(false);
      setSuggestionIndex(-1);
      setCapError(null);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  }

  // ── Dispatch ──────────────────────────────────────────────────────
  async function handleDispatch() {
    const capVal = validateCapability(capability);
    const msgVal = validateMessage(message);
    setCapError(capVal.valid ? null : (capVal.error ?? null));
    setMsgError(msgVal.valid ? null : (msgVal.error ?? null));
    if (!capVal.valid || !msgVal.valid) return;

    setSending(true);
    setResult(null);

    const agentId = selectedAgentId || 'command-center';
    const res = await dispatchTask(capability.trim(), message.trim(), agentId);

    setSending(false);

    const now = new Date();
    const taskId = (res.data as { task_id?: string } | null)?.task_id;

    // Add to traffic log
    const entry: TrafficEntry = {
      id: crypto.randomUUID(),
      timestamp: now,
      agent_id: agentId,
      action: 'dispatch_task',
      capability: capability.trim(),
      status: res.ok ? 'allowed' : 'denied',
      task_id: taskId,
      details: res.data,
    };
    addTrafficEntry(entry);

    if (res.ok) {
      setResult({
        ok: true,
        message: taskId ? `Dispatched — task ${taskId}` : 'Dispatched successfully',
        taskId,
      });
    } else {
      setResult({
        ok: false,
        message: res.error ?? 'Dispatch failed',
      });
    }
  }

  // ── Form submit ───────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void handleDispatch();
  }

  // ── Close handler — also resets result ───────────────────────────
  function handleClose() {
    setResult(null);
    onClose();
  }

  if (!isOpen) return null;

  return (
    /* Backdrop */
    <div
      role="presentation"
      data-testid="quick-dispatch-backdrop"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      {/* Panel */}
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Quick dispatch"
        aria-describedby="quick-dispatch-desc"
        data-testid="quick-dispatch-modal"
        className="w-full max-w-lg mx-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              Quick Dispatch
            </h2>
            <p
              id="quick-dispatch-desc"
              className="text-xs text-[var(--color-text-dim)] mt-0.5"
            >
              Send a task to any agent from anywhere
            </p>
          </div>
          <div className="flex items-center gap-2">
            <kbd
              aria-hidden="true"
              className="text-[10px] font-mono text-[var(--color-text-muted)] border border-[var(--color-border)] rounded px-1.5 py-0.5"
            >
              Ctrl+D
            </kbd>
            <button
              onClick={handleClose}
              data-testid="quick-dispatch-close"
              aria-label="Close quick dispatch"
              className="text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          <div className="px-5 py-4 space-y-4">

            {/* Agent selector */}
            <div>
              <label
                htmlFor="qd-agent"
                className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5"
              >
                Agent
                {favoritesSet.size > 0 && (
                  <span className="ml-1.5 text-[10px] text-amber-400 font-normal">
                    ★ favorites first
                  </span>
                )}
              </label>
              <select
                id="qd-agent"
                ref={firstFocusRef}
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                data-testid="quick-dispatch-agent-select"
                disabled={agentsLoading}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-dark)] text-sm text-[var(--color-text)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">— Any agent (command-center) —</option>
                {agentsLoading ? (
                  <option disabled>Loading agents…</option>
                ) : (
                  <>
                    {/* Favorites group */}
                    {sortedAgents.filter((a) => favoritesSet.has(a.agent_id)).length > 0 && (
                      <optgroup label="★ Pinned">
                        {sortedAgents
                          .filter((a) => favoritesSet.has(a.agent_id))
                          .map((a) => (
                            <option key={a.agent_id} value={a.agent_id}>
                              {a.agent_id} ({a.status})
                            </option>
                          ))}
                      </optgroup>
                    )}
                    {/* All agents group */}
                    <optgroup label="All Agents">
                      {sortedAgents
                        .filter((a) => !favoritesSet.has(a.agent_id))
                        .map((a) => (
                          <option key={a.agent_id} value={a.agent_id}>
                            {a.agent_id} ({a.status})
                          </option>
                        ))}
                    </optgroup>
                  </>
                )}
              </select>
              {selectedAgent && (
                <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                  Capabilities: {agentCapabilities.length > 0 ? agentCapabilities.join(', ') : 'none listed'}
                </p>
              )}
            </div>

            {/* Capability input with autocomplete */}
            <div className="relative">
              <label
                htmlFor="qd-capability"
                className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5"
              >
                Capability <span aria-hidden="true" className="text-[var(--color-text-muted)]">*</span>
              </label>
              <input
                id="qd-capability"
                ref={capInputRef}
                type="text"
                value={capability}
                onChange={(e) => {
                  setCapability(e.target.value);
                  if (capError) setCapError(null);
                }}
                onBlur={handleCapBlur}
                onKeyDown={handleCapKeyDown}
                placeholder="e.g. summarize_text"
                autoComplete="off"
                data-testid="quick-dispatch-capability"
                aria-autocomplete="list"
                aria-expanded={showSuggestions}
                aria-controls={showSuggestions ? 'qd-cap-suggestions' : undefined}
                aria-activedescendant={
                  showSuggestions && suggestionIndex >= 0
                    ? `qd-cap-opt-${suggestionIndex}`
                    : undefined
                }
                className={`w-full rounded-lg border px-3 py-2 text-sm bg-[var(--color-surface-dark)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                  capError
                    ? 'border-red-500/60 focus:ring-red-500'
                    : 'border-[var(--color-border)]'
                }`}
              />
              {capError && (
                <p role="alert" className="mt-1 text-xs text-red-400" data-testid="quick-dispatch-cap-error">
                  {capError}
                </p>
              )}
              {/* Autocomplete dropdown */}
              {showSuggestions && (
                <ul
                  id="qd-cap-suggestions"
                  role="listbox"
                  data-testid="quick-dispatch-cap-suggestions"
                  className="absolute z-10 left-0 right-0 mt-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
                >
                  {capSuggestions.map((cap, i) => (
                    <li
                      key={cap}
                      id={`qd-cap-opt-${i}`}
                      role="option"
                      aria-selected={i === suggestionIndex}
                      data-testid={`qd-cap-opt-${i}`}
                      className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                        i === suggestionIndex
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-dark)] hover:text-[var(--color-text)]'
                      }`}
                      onMouseDown={(e) => {
                        // Use mousedown to prevent blur from firing first
                        e.preventDefault();
                        setCapability(cap);
                        setShowSuggestions(false);
                        setSuggestionIndex(-1);
                        setCapError(null);
                        capInputRef.current?.focus();
                      }}
                    >
                      {cap}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Message textarea */}
            <div>
              <label
                htmlFor="qd-message"
                className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5"
              >
                Message <span aria-hidden="true" className="text-[var(--color-text-muted)]">*</span>
              </label>
              <textarea
                id="qd-message"
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (msgError) setMsgError(null);
                }}
                onBlur={handleMsgBlur}
                rows={3}
                placeholder="Describe the task for the agent…"
                data-testid="quick-dispatch-message"
                className={`w-full rounded-lg border px-3 py-2 text-sm bg-[var(--color-surface-dark)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none ${
                  msgError
                    ? 'border-red-500/60 focus:ring-red-500'
                    : 'border-[var(--color-border)]'
                }`}
              />
              {msgError && (
                <p role="alert" className="mt-1 text-xs text-red-400" data-testid="quick-dispatch-msg-error">
                  {msgError}
                </p>
              )}
            </div>

            {/* Priority selector */}
            <div>
              <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
                Priority
              </p>
              <div role="radiogroup" aria-label="Task priority" className="flex gap-2">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    role="radio"
                    aria-checked={priority === p.value}
                    data-testid={`quick-dispatch-priority-${p.value}`}
                    onClick={() => setPriority(p.value)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                      priority === p.value
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                        : `border-[var(--color-border)] bg-[var(--color-surface-dark)] ${p.color} hover:border-[var(--color-border-hover)]`
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Inline result */}
            {result && (
              <div
                role="status"
                aria-live="polite"
                data-testid="quick-dispatch-result"
                className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${
                  result.ok
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-red-500/30 bg-red-500/10 text-red-300'
                }`}
              >
                <span aria-hidden="true" className="mt-0.5 flex-shrink-0">
                  {result.ok ? '✓' : '✗'}
                </span>
                <span data-testid="quick-dispatch-result-message">{result.message}</span>
              </div>
            )}
          </div>

          {/* Footer / actions */}
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-[var(--color-border)]">
            <p aria-hidden="true" className="text-[10px] text-[var(--color-text-muted)]">
              <kbd className="font-mono">Ctrl+D</kbd> to toggle · <kbd className="font-mono">Esc</kbd> to close
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1.5 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending}
                data-testid="quick-dispatch-submit"
                className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 hover:border-emerald-500/50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <>
                    <span aria-hidden="true" className="animate-spin">⟳</span>
                    Dispatching…
                  </>
                ) : (
                  <>
                    <span aria-hidden="true">⚡</span>
                    Dispatch
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default memo(QuickDispatchModal);
