import { useState, useRef, useEffect } from 'react';
import { injectKubexCredentials } from '../api';
import type { KubexRuntime } from '../types';

interface Props {
  kubexId: string;
}

const RUNTIME_OPTIONS: { value: KubexRuntime; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex-cli', label: 'Codex CLI' },
  { value: 'gemini-cli', label: 'Gemini CLI' },
];

interface InjectionRecord {
  runtime: KubexRuntime;
  status: 'ok' | 'error';
  message: string;
}

/**
 * KubexCredentialPanel — inline panel shown below a running KubexRow.
 * Lets the user inject OAuth / API credentials into the running container
 * via POST /kubexes/{id}/credentials.
 *
 * The credential_data field accepts raw JSON — the user pastes the token
 * blob (e.g. the Claude Code .credentials.json contents) and the panel
 * sends it to the Manager which writes it inside the container.
 */
export default function KubexCredentialPanel({ kubexId }: Props) {
  const [runtime, setRuntime] = useState<KubexRuntime>('claude-code');
  const [credJson, setCredJson] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<InjectionRecord[]>([]);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea when the panel opens
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function validateJson(value: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        setJsonError('Must be a JSON object (not an array or primitive)');
        return null;
      }
      setJsonError(null);
      return parsed as Record<string, unknown>;
    } catch {
      setJsonError('Invalid JSON — check syntax');
      return null;
    }
  }

  function handleJsonChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setCredJson(val);
    if (val.trim()) validateJson(val);
    else setJsonError(null);
  }

  async function handleInject(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = credJson.trim();
    if (!trimmed || loading) return;

    const parsed = validateJson(trimmed);
    if (!parsed) return;

    setLoading(true);
    const res = await injectKubexCredentials(kubexId, {
      runtime,
      credential_data: parsed,
    });
    setLoading(false);

    if (res.ok && res.data) {
      setHistory((prev) => [
        {
          runtime,
          status: 'ok',
          message: `Injected ${runtime} credentials → ${res.data!.path}`,
        },
        ...prev,
      ]);
      setCredJson('');
      setJsonError(null);
    } else {
      const errMsg =
        res.error ??
        (res.data && typeof res.data === 'object' && 'message' in res.data
          ? String((res.data as { message?: string }).message)
          : `HTTP ${res.status}`);
      setHistory((prev) => [
        { runtime, status: 'error', message: errMsg },
        ...prev,
      ]);
    }
  }

  const canSubmit = credJson.trim().length > 0 && !jsonError && !loading;

  return (
    <div
      className="border-t border-[var(--color-border)] bg-[var(--color-surface-dark)] px-6 py-4"
      data-testid={`credential-panel-${kubexId}`}
      role="region"
      aria-label={`Inject credentials into kubex ${kubexId}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)]">
          Inject Credentials
        </span>
        <span className="text-[10px] text-[var(--color-text-dim)]">
          into running container
        </span>
      </div>

      <form
        onSubmit={handleInject}
        className="space-y-2"
        data-testid={`credential-form-${kubexId}`}
      >
        {/* Runtime selector + submit on the same row */}
        <div className="flex items-center gap-2">
          <select
            value={runtime}
            onChange={(e) => setRuntime(e.target.value as KubexRuntime)}
            aria-label="CLI runtime"
            data-testid={`credential-runtime-${kubexId}`}
            disabled={loading}
            className="px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-dark)] text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent disabled:opacity-60 transition-colors"
          >
            {RUNTIME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <span className="flex-1" />

          <button
            type="submit"
            disabled={!canSubmit}
            data-testid={`credential-submit-${kubexId}`}
            className="px-3 py-1.5 text-xs rounded-lg border border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {loading ? (
              <span className="flex items-center gap-1.5">
                <svg
                  className="h-3 w-3 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8z"
                  />
                </svg>
                Injecting…
              </span>
            ) : (
              'Inject'
            )}
          </button>
        </div>

        {/* JSON credential input */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={credJson}
            onChange={handleJsonChange}
            placeholder={'Paste credential JSON here…\ne.g. { "access_token": "...", "refresh_token": "..." }'}
            aria-label="Credential JSON"
            data-testid={`credential-json-${kubexId}`}
            disabled={loading}
            rows={4}
            spellCheck={false}
            className={`w-full px-3 py-2 text-xs rounded-lg border font-mono resize-y
              bg-[var(--color-bg)] text-[var(--color-text)]
              placeholder:text-[var(--color-text-dim)]
              focus:outline-none focus:ring-2 focus:border-transparent
              disabled:opacity-60 transition-colors
              ${jsonError
                ? 'border-red-500/60 focus:ring-red-500'
                : 'border-[var(--color-border)] focus:ring-cyan-500'
              }
            `}
          />
          {jsonError && (
            <p
              className="mt-1 text-[10px] text-red-400"
              data-testid={`credential-json-error-${kubexId}`}
              role="alert"
            >
              {jsonError}
            </p>
          )}
        </div>
      </form>

      {/* Injection history */}
      {history.length > 0 && (
        <ul
          className="mt-3 space-y-1"
          data-testid={`credential-history-${kubexId}`}
          aria-label="Injection history"
        >
          {history.map((entry, i) => (
            <li
              key={i}
              className={`flex items-start gap-2 text-xs px-2 py-1 rounded ${
                entry.status === 'ok'
                  ? 'bg-cyan-500/5 border border-cyan-500/20'
                  : 'bg-red-500/5 border border-red-500/20'
              }`}
            >
              <span
                className={`mt-0.5 flex-shrink-0 ${
                  entry.status === 'ok' ? 'text-cyan-400' : 'text-red-400'
                }`}
                aria-hidden="true"
              >
                {entry.status === 'ok' ? '✓' : '✗'}
              </span>
              <span
                className={entry.status === 'ok' ? 'text-cyan-300' : 'text-red-300'}
                data-testid={`credential-result-${kubexId}-${i}`}
              >
                {entry.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
