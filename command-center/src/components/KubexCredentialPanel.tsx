import { useState, useRef, useEffect } from 'react';
import { injectKubexCredentials } from '../api';
import type { KubexRuntime } from '../types';

interface Props {
  kubexId: string;
  /** Pre-select a runtime and skip to the paste step (e.g. when auto-opened on credential_wait). */
  initialRuntime?: KubexRuntime;
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

/** Per-runtime step-by-step auth instructions shown above the paste area. */
const AUTH_INSTRUCTIONS: Record<KubexRuntime, { steps: string[]; file: string }> = {
  'claude-code': {
    steps: [
      'Open a terminal on your machine',
      'Run: claude auth login',
      'Complete the authentication in your browser',
      'Copy the contents of ~/.claude/.credentials.json',
      'Paste the JSON below',
    ],
    file: '~/.claude/.credentials.json',
  },
  'gemini-cli': {
    steps: [
      'Open a terminal on your machine',
      'Run: gemini auth login',
      'Complete the Google OAuth in your browser',
      'Copy the contents of ~/.gemini/oauth_creds.json',
      'Paste the JSON below',
    ],
    file: '~/.gemini/oauth_creds.json',
  },
  'codex-cli': {
    steps: [
      'Open a terminal on your machine',
      'Run: codex auth login',
      'Complete the authentication in your browser',
      'Copy the contents of ~/.codex/.credentials.json',
      'Paste the JSON below',
    ],
    file: '~/.codex/.credentials.json',
  },
};

/**
 * KubexCredentialPanel — guided OAuth credential injection panel.
 *
 * Shows per-runtime authentication instructions so the user knows exactly
 * where to find the credential file, then accepts pasted JSON and calls
 * POST /kubexes/{id}/credentials.
 *
 * Can be pre-seeded with `initialRuntime` when auto-opened on credential_wait.
 */
export default function KubexCredentialPanel({ kubexId, initialRuntime }: Props) {
  const [runtime, setRuntime] = useState<KubexRuntime>(initialRuntime ?? 'claude-code');
  const [credJson, setCredJson] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<InjectionRecord[]>([]);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // When initialRuntime changes from outside (e.g. auto-open), update selection
  useEffect(() => {
    if (initialRuntime) setRuntime(initialRuntime);
  }, [initialRuntime]);

  // Focus the textarea when instructions are dismissed
  useEffect(() => {
    if (!showInstructions) {
      textareaRef.current?.focus();
    }
  }, [showInstructions]);

  // Auto-focus textarea when the panel first opens without instructions
  useEffect(() => {
    if (!showInstructions) {
      textareaRef.current?.focus();
    }
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

  function handleRuntimeChange(val: KubexRuntime) {
    setRuntime(val);
    // Reset paste area when switching runtimes
    setCredJson('');
    setJsonError(null);
    setShowInstructions(true);
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
  const instructions = AUTH_INSTRUCTIONS[runtime];

  return (
    <div
      className="border-t border-[var(--color-border)] bg-[var(--color-surface-dark)] px-6 py-4"
      data-testid={`credential-panel-${kubexId}`}
      role="region"
      aria-label={`Inject credentials into kubex ${kubexId}`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)]">
          Inject Credentials
        </span>
        <span className="text-[10px] text-[var(--color-text-dim)]">
          into running container
        </span>
      </div>

      {/* Runtime selector */}
      <div className="mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {RUNTIME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleRuntimeChange(opt.value)}
              data-testid={`credential-runtime-tab-${kubexId}-${opt.value}`}
              className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                runtime === opt.value
                  ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-300 font-medium'
                  : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Auth instructions */}
      {showInstructions && (
        <div
          className="mb-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-3"
          data-testid={`credential-instructions-${kubexId}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-[10px] uppercase tracking-widest font-semibold text-cyan-400/70 mb-2">
                How to authorize {RUNTIME_OPTIONS.find((o) => o.value === runtime)?.label}
              </p>
              <ol className="space-y-1">
                {instructions.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
                    <span className="flex-shrink-0 text-[10px] font-semibold text-cyan-400/60 mt-0.5 w-4">
                      {i + 1}.
                    </span>
                    <span
                      className={
                        step.startsWith('Run:') || step.startsWith('Copy the') || step.startsWith('Paste')
                          ? ''
                          : ''
                      }
                    >
                      {step.startsWith('Run: ') ? (
                        <>
                          Run:{' '}
                          <code className="font-mono-data bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-1 py-0.5 text-cyan-300">
                            {step.slice(5)}
                          </code>
                        </>
                      ) : step.startsWith('Copy the contents of ') ? (
                        <>
                          Copy the contents of{' '}
                          <code className="font-mono-data bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-1 py-0.5 text-cyan-300">
                            {instructions.file}
                          </code>
                        </>
                      ) : (
                        step
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <button
              type="button"
              onClick={() => setShowInstructions(false)}
              title="Dismiss instructions"
              className="flex-shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-dim)] text-xs transition-colors"
              data-testid={`credential-dismiss-instructions-${kubexId}`}
            >
              ✕
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowInstructions(false);
              setTimeout(() => textareaRef.current?.focus(), 50);
            }}
            className="mt-3 text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors"
            data-testid={`credential-ready-to-paste-${kubexId}`}
          >
            Ready to paste → skip to JSON input
          </button>
        </div>
      )}

      {/* JSON paste form */}
      <form
        onSubmit={handleInject}
        className="space-y-2"
        data-testid={`credential-form-${kubexId}`}
      >
        {/* Submit button row */}
        <div className="flex items-center gap-2">
          {!showInstructions && (
            <button
              type="button"
              onClick={() => setShowInstructions(true)}
              className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-dim)] transition-colors"
              data-testid={`credential-show-instructions-${kubexId}`}
            >
              ← Show instructions
            </button>
          )}
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
              'Inject Credentials'
            )}
          </button>
        </div>

        {/* JSON credential input */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={credJson}
            onChange={handleJsonChange}
            placeholder={`Paste ${instructions.file} contents here…\ne.g. { "access_token": "...", "refresh_token": "..." }`}
            aria-label="Credential JSON"
            data-testid={`credential-json-${kubexId}`}
            disabled={loading}
            rows={5}
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
