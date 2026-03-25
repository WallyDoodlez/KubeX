import { useState, useEffect, useRef, useCallback } from 'react';
import { registerAgent } from '../api';
import type { AgentRegistrationBody } from '../types';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface AgentRegisterModalProps {
  open: boolean;
  onClose: () => void;
  onRegistered: () => void;
}

type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

const AGENT_ID_RE = /^[a-zA-Z0-9_.\-]+$/;
const CAP_RE = /^[a-zA-Z0-9_.\-]+$/;

function validateAgentId(v: string): string | null {
  const t = v.trim();
  if (!t) return 'Agent ID is required';
  if (t.length > 100) return 'Agent ID too long (max 100 chars)';
  if (!AGENT_ID_RE.test(t)) return 'Only letters, numbers, underscore, dot, hyphen allowed';
  return null;
}

function parseCapabilities(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function validateCapabilities(raw: string): string | null {
  const caps = parseCapabilities(raw);
  if (caps.length === 0) return 'At least one capability is required';
  const invalid = caps.find((c) => !CAP_RE.test(c));
  if (invalid) return `Invalid capability: "${invalid}" — only letters, numbers, underscore, dot, hyphen allowed`;
  return null;
}

function validateMetadata(raw: string): string | null {
  if (!raw.trim()) return null; // empty is fine
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
      return 'Metadata must be a JSON object, e.g. {"key": "value"}';
    }
    return null;
  } catch {
    return 'Invalid JSON — must be a valid JSON object';
  }
}

export default function AgentRegisterModal({ open, onClose, onRegistered }: AgentRegisterModalProps) {
  const [agentId, setAgentId] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [boundary, setBoundary] = useState('default');
  const [status, setStatus] = useState<'running' | 'stopped' | 'busy' | 'unknown'>('unknown');
  const [metadata, setMetadata] = useState('');

  const [agentIdError, setAgentIdError] = useState<string | null>(null);
  const [capError, setCapError] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [formStatus, setFormStatus] = useState<FormStatus>('idle');
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setAgentId('');
      setCapabilities('');
      setBoundary('default');
      setStatus('unknown');
      setMetadata('');
      setAgentIdError(null);
      setCapError(null);
      setMetaError(null);
      setFormStatus('idle');
      setResultMessage(null);
    }
  }, [open]);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open && formStatus !== 'submitting') {
        onClose();
      }
    },
    [open, formStatus, onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (formStatus === 'submitting') return;

    // Validate all fields
    const idErr = validateAgentId(agentId);
    const capErr = validateCapabilities(capabilities);
    const metErr = validateMetadata(metadata);

    setAgentIdError(idErr);
    setCapError(capErr);
    setMetaError(metErr);

    if (idErr || capErr || metErr) return;

    setFormStatus('submitting');
    setResultMessage(null);

    let parsedMeta: Record<string, unknown> = {};
    if (metadata.trim()) {
      try {
        parsedMeta = JSON.parse(metadata) as Record<string, unknown>;
      } catch {
        // validated above, should not happen
      }
    }

    const body: AgentRegistrationBody = {
      agent_id: agentId.trim(),
      capabilities: parseCapabilities(capabilities),
      status,
      boundary: boundary.trim() || 'default',
      metadata: parsedMeta,
    };

    const res = await registerAgent(body);
    if (res.ok) {
      setFormStatus('success');
      setResultMessage(`Agent "${agentId.trim()}" registered successfully.`);
      // Notify parent to refresh agent list (but keep modal open to show success state)
      onRegistered();
    } else {
      setFormStatus('error');
      setResultMessage(res.error ?? `HTTP ${res.status}`);
    }
  }

  if (!open) return null;

  const submitting = formStatus === 'submitting';
  const succeeded = formStatus === 'success';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Register Agent"
      data-testid="agent-register-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="
          relative w-full max-w-lg mx-4
          rounded-2xl border border-[var(--color-border)]
          bg-[var(--color-surface)] shadow-2xl
          animate-slide-up overflow-hidden
        "
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text)]" id="agent-register-title">
            Register Agent
          </h2>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="Close register agent modal"
            data-testid="agent-register-close-btn"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-[var(--color-border-strong)] rounded"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="px-6 py-5 space-y-4"
          data-testid="agent-register-form"
        >
          {/* Agent ID */}
          <div>
            <label
              htmlFor="reg-agent-id"
              className="block text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1"
            >
              Agent ID <span className="text-red-400">*</span>
            </label>
            <input
              id="reg-agent-id"
              type="text"
              value={agentId}
              data-testid="reg-agent-id"
              onChange={(e) => {
                setAgentId(e.target.value);
                setAgentIdError(e.target.value.trim() ? validateAgentId(e.target.value) : null);
              }}
              disabled={submitting || succeeded}
              placeholder="e.g. my-worker-agent"
              autoComplete="off"
              className="
                w-full px-3 py-2 rounded-lg text-sm font-mono-data
                bg-[var(--color-bg)] border border-[var(--color-border)]
                text-[var(--color-text)] placeholder-[var(--color-text-muted)]
                focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20
                disabled:opacity-50 transition-colors
              "
            />
            {agentIdError && (
              <p data-testid="reg-agent-id-error" className="text-[10px] text-red-400 mt-0.5">
                {agentIdError}
              </p>
            )}
          </div>

          {/* Capabilities */}
          <div>
            <label
              htmlFor="reg-capabilities"
              className="block text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1"
            >
              Capabilities <span className="text-red-400">*</span>
            </label>
            <input
              id="reg-capabilities"
              type="text"
              value={capabilities}
              data-testid="reg-capabilities"
              onChange={(e) => {
                setCapabilities(e.target.value);
                setCapError(null);
              }}
              onBlur={() => setCapError(validateCapabilities(capabilities))}
              disabled={submitting || succeeded}
              placeholder="e.g. summarise, analyse, translate"
              autoComplete="off"
              className="
                w-full px-3 py-2 rounded-lg text-sm font-mono-data
                bg-[var(--color-bg)] border border-[var(--color-border)]
                text-[var(--color-text)] placeholder-[var(--color-text-muted)]
                focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20
                disabled:opacity-50 transition-colors
              "
            />
            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
              Comma-separated list of capability names.
            </p>
            {capError && (
              <p data-testid="reg-capabilities-error" className="text-[10px] text-red-400 mt-0.5">
                {capError}
              </p>
            )}
          </div>

          {/* Boundary + Status row */}
          <div className="grid grid-cols-2 gap-3">
            {/* Boundary */}
            <div>
              <label
                htmlFor="reg-boundary"
                className="block text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1"
              >
                Boundary
              </label>
              <input
                id="reg-boundary"
                type="text"
                value={boundary}
                data-testid="reg-boundary"
                onChange={(e) => setBoundary(e.target.value)}
                disabled={submitting || succeeded}
                placeholder="default"
                autoComplete="off"
                className="
                  w-full px-3 py-2 rounded-lg text-sm font-mono-data
                  bg-[var(--color-bg)] border border-[var(--color-border)]
                  text-[var(--color-text)] placeholder-[var(--color-text-muted)]
                  focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20
                  disabled:opacity-50 transition-colors
                "
              />
            </div>

            {/* Status */}
            <div>
              <label
                htmlFor="reg-status"
                className="block text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1"
              >
                Initial Status
              </label>
              <select
                id="reg-status"
                value={status}
                data-testid="reg-status"
                onChange={(e) =>
                  setStatus(e.target.value as 'running' | 'stopped' | 'busy' | 'unknown')
                }
                disabled={submitting || succeeded}
                className="
                  w-full px-3 py-2 rounded-lg text-sm
                  bg-[var(--color-bg)] border border-[var(--color-border)]
                  text-[var(--color-text)]
                  focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20
                  disabled:opacity-50 transition-colors
                "
              >
                <option value="unknown">Unknown</option>
                <option value="running">Running</option>
                <option value="busy">Busy</option>
                <option value="stopped">Stopped</option>
              </select>
            </div>
          </div>

          {/* Metadata */}
          <div>
            <label
              htmlFor="reg-metadata"
              className="block text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1"
            >
              Metadata <span className="text-[var(--color-text-muted)] normal-case font-normal tracking-normal">(optional JSON object)</span>
            </label>
            <textarea
              id="reg-metadata"
              value={metadata}
              data-testid="reg-metadata"
              onChange={(e) => {
                setMetadata(e.target.value);
                setMetaError(null);
              }}
              onBlur={() => {
                if (metadata.trim()) setMetaError(validateMetadata(metadata));
              }}
              disabled={submitting || succeeded}
              placeholder={'{\n  "version": "1.0"\n}'}
              rows={3}
              className="
                w-full px-3 py-2 rounded-lg text-sm font-mono-data
                bg-[var(--color-bg)] border border-[var(--color-border)]
                text-[var(--color-text)] placeholder-[var(--color-text-muted)]
                focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20
                disabled:opacity-50 transition-colors resize-y
              "
            />
            {metaError && (
              <p data-testid="reg-metadata-error" className="text-[10px] text-red-400 mt-0.5">
                {metaError}
              </p>
            )}
          </div>

          {/* Result banner */}
          {resultMessage && (
            <div
              data-testid={succeeded ? 'reg-success-banner' : 'reg-error-banner'}
              className={`rounded-lg px-4 py-3 text-sm border ${
                succeeded
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}
            >
              {succeeded ? '✓ ' : '✗ '}
              {resultMessage}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            {succeeded ? (
              <button
                type="button"
                onClick={onClose}
                data-testid="reg-done-btn"
                className="
                  px-4 py-2 rounded-lg text-sm font-medium
                  bg-emerald-500/15 text-emerald-400 border border-emerald-500/30
                  hover:bg-emerald-500/25 hover:border-emerald-500/50
                  transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/40
                "
              >
                Done
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  data-testid="reg-cancel-btn"
                  className="
                    px-4 py-2 rounded-lg text-sm
                    border border-[var(--color-border)] text-[var(--color-text-secondary)]
                    hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]
                    disabled:opacity-40 transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--color-border-strong)]
                  "
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  data-testid="reg-submit-btn"
                  className="
                    px-4 py-2 rounded-lg text-sm font-medium
                    bg-emerald-500/15 text-emerald-400 border border-emerald-500/30
                    hover:bg-emerald-500/25 hover:border-emerald-500/50
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/40
                  "
                >
                  {submitting ? 'Registering…' : 'Register Agent'}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
