import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

interface AuthGateProps {
  children: React.ReactNode;
  /**
   * When `mode="banner"` (default), the app renders normally and a dismissible
   * warning banner appears at the top when no token is configured.
   * When `mode="block"`, the full-screen token prompt is shown instead of
   * children until a token is provided.
   */
  mode?: 'banner' | 'block';
}

export default function AuthGate({ children, mode = 'banner' }: AuthGateProps) {
  const { isConfigured, setToken } = useAuth();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // ── Banner mode: always render children, show a non-blocking warning ──────
  if (mode === 'banner') {
    return (
      <>
        {!isConfigured && !bannerDismissed && (
          <div
            role="alert"
            aria-live="polite"
            data-testid="auth-banner"
            className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-xs text-amber-300"
          >
            <span>
              <strong>No Manager token configured.</strong> Manager API calls will fail. Set{' '}
              <code className="font-mono text-amber-200">VITE_MANAGER_TOKEN</code> or{' '}
              <button
                onClick={() => {
                  const t = window.prompt('Enter Manager token:');
                  if (t?.trim()) setToken(t.trim());
                }}
                className="underline underline-offset-2 hover:text-amber-200 transition-colors"
              >
                enter a token
              </button>
              .
            </span>
            <button
              onClick={() => setBannerDismissed(true)}
              aria-label="Dismiss auth warning"
              className="flex-shrink-0 text-amber-400 hover:text-amber-200 transition-colors px-1"
            >
              ✕
            </button>
          </div>
        )}
        {children}
      </>
    );
  }

  // ── Block mode: full-screen token prompt until configured ─────────────────
  if (isConfigured) return <>{children}</>;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) {
      setError('Token cannot be empty.');
      return;
    }
    setError('');
    setToken(trimmed);
  }

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-[#2a2f45] bg-[#1a1d27] p-8 shadow-lg">

        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/30">
            <svg
              className="h-5 w-5 text-emerald-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-[#e2e8f0]">Manager Token Required</h1>
            <p className="text-xs text-[#64748b]">KubexClaw Command Center</p>
          </div>
        </div>

        {/* Divider */}
        <div className="mb-6 h-px bg-[#2a2f45]" />

        {/* Info message */}
        <div className="mb-6 rounded-lg border border-[#2a2f45] bg-[#0f1117] px-4 py-3">
          <p className="text-xs text-[#94a3b8] leading-relaxed">
            A Manager token is required to authenticate with the Kubex Manager API.
            Set <code className="text-emerald-400 font-mono">VITE_MANAGER_TOKEN</code> in your{' '}
            <code className="text-emerald-400 font-mono">.env</code> file to skip this prompt,
            or enter the token below for this session.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-4">
            <label
              htmlFor="manager-token"
              className="mb-1.5 block text-[10px] uppercase tracking-widest text-[#3a3f5a]"
            >
              Manager Token
            </label>
            <input
              id="manager-token"
              type="password"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (error) setError('');
              }}
              placeholder="Enter token…"
              autoComplete="current-password"
              autoFocus
              className="
                w-full rounded-lg border px-3 py-2.5 text-sm font-mono
                bg-[#0f1117] text-[#e2e8f0] placeholder-[#3a3f5a]
                transition-colors focus:outline-none focus:ring-1
                focus:ring-emerald-500/20
                border-[#2a2f45] focus:border-emerald-500/50
              "
            />
            {error && (
              <p className="mt-1.5 text-xs text-red-400">{error}</p>
            )}
          </div>

          <button
            type="submit"
            className="
              w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white
              transition-colors hover:bg-emerald-400 active:bg-emerald-600
              focus:outline-none focus:ring-2 focus:ring-emerald-500/40
            "
          >
            Connect
          </button>
        </form>
      </div>
    </div>
  );
}
