import { useState, useRef, useEffect } from 'react';
import { installKubexDep } from '../api';

interface Props {
  kubexId: string;
}

type DepType = 'pip' | 'cli';

interface InstallRecord {
  package: string;
  type: DepType;
  status: 'ok' | 'error';
  message: string;
}

/**
 * KubexInstallDepPanel — inline panel shown below a running KubexRow.
 * Lets the user install a pip or CLI package into the running container
 * via POST /kubexes/{id}/install-dep.
 */
export default function KubexInstallDepPanel({ kubexId }: Props) {
  const [pkg, setPkg] = useState('');
  const [depType, setDepType] = useState<DepType>('pip');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<InstallRecord[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the package input when the panel opens
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleInstall(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = pkg.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    const res = await installKubexDep(kubexId, { package: trimmed, type: depType });
    setLoading(false);

    if (res.ok && res.data) {
      setHistory((prev) => [
        { package: trimmed, type: depType, status: 'ok', message: `Installed ${trimmed} (${depType})` },
        ...prev,
      ]);
      setPkg('');
      inputRef.current?.focus();
    } else {
      const errMsg =
        res.error ??
        (res.data && typeof res.data === 'object' && 'message' in res.data
          ? String((res.data as { message?: string }).message)
          : `HTTP ${res.status}`);
      setHistory((prev) => [
        { package: trimmed, type: depType, status: 'error', message: errMsg },
        ...prev,
      ]);
    }
  }

  return (
    <div
      className="border-t border-[var(--color-border)] bg-[var(--color-surface-dark)] px-6 py-4"
      data-testid={`install-dep-panel-${kubexId}`}
      role="region"
      aria-label={`Install package into kubex ${kubexId}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)]">
          Install Package
        </span>
        <span className="text-[10px] text-[var(--color-text-dim)]">
          into running container
        </span>
      </div>

      <form
        onSubmit={handleInstall}
        className="flex items-center gap-2"
        data-testid={`install-dep-form-${kubexId}`}
      >
        {/* Package name input */}
        <input
          ref={inputRef}
          type="text"
          value={pkg}
          onChange={(e) => setPkg(e.target.value)}
          placeholder={depType === 'pip' ? 'e.g. requests==2.31.0' : 'e.g. jq'}
          aria-label="Package name"
          data-testid={`install-dep-input-${kubexId}`}
          disabled={loading}
          className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-60 transition-colors font-mono"
        />

        {/* Type selector */}
        <select
          value={depType}
          onChange={(e) => setDepType(e.target.value as DepType)}
          aria-label="Package type"
          data-testid={`install-dep-type-${kubexId}`}
          disabled={loading}
          className="px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-dark)] text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-60 transition-colors"
        >
          <option value="pip">pip</option>
          <option value="cli">cli (apt-get)</option>
        </select>

        {/* Submit button */}
        <button
          type="submit"
          disabled={loading || !pkg.trim()}
          data-testid={`install-dep-submit-${kubexId}`}
          className="px-3 py-1.5 text-xs rounded-lg border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
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
              Installing…
            </span>
          ) : (
            'Install'
          )}
        </button>
      </form>

      {/* Install history */}
      {history.length > 0 && (
        <ul
          className="mt-3 space-y-1"
          data-testid={`install-dep-history-${kubexId}`}
          aria-label="Install history"
        >
          {history.map((entry, i) => (
            <li
              key={i}
              className={`flex items-start gap-2 text-xs px-2 py-1 rounded ${
                entry.status === 'ok'
                  ? 'bg-emerald-500/5 border border-emerald-500/20'
                  : 'bg-red-500/5 border border-red-500/20'
              }`}
            >
              <span
                className={`mt-0.5 flex-shrink-0 ${
                  entry.status === 'ok' ? 'text-emerald-400' : 'text-red-400'
                }`}
                aria-hidden="true"
              >
                {entry.status === 'ok' ? '✓' : '✗'}
              </span>
              <span
                className={entry.status === 'ok' ? 'text-emerald-300' : 'text-red-300'}
                data-testid={`install-dep-result-${kubexId}-${i}`}
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
