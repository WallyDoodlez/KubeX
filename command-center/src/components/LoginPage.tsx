/**
 * LoginPage — shown when OAuth is configured and the user is not authenticated.
 *
 * When VITE_OAUTH_AUTHORITY is not set this component is never rendered
 * (App.tsx only mounts it when oauthEnabled=true and isAuthenticated=false).
 */
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      await login();
      // login() redirects; code below only executes if redirect doesn't happen
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--color-bg)' }}
      data-testid="login-page"
    >
      <div
        className="w-full max-w-sm p-8 rounded-2xl border border-[var(--color-border)] shadow-2xl"
        style={{ background: 'var(--color-surface-dark)' }}
      >
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-xl font-bold text-white shadow-lg">
            K
          </div>
        </div>

        <h1 className="text-xl font-bold text-center text-[var(--color-text)] mb-1">
          KubexClaw Command Center
        </h1>
        <p className="text-sm text-center text-[var(--color-text-dim)] mb-8">
          Sign in to continue
        </p>

        {error && (
          <div
            role="alert"
            className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400"
          >
            {error}
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={loading}
          data-testid="oauth-login-button"
          className="
            w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl
            bg-emerald-500/15 text-emerald-400 border border-emerald-500/30
            hover:bg-emerald-500/25 hover:border-emerald-500/50
            disabled:opacity-50 disabled:cursor-not-allowed
            font-semibold text-sm transition-all
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
          "
        >
          {loading ? (
            <>
              <span
                aria-hidden="true"
                className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"
              />
              Redirecting…
            </>
          ) : (
            <>
              <span aria-hidden="true" className="text-base">⬡</span>
              Sign in with OAuth
            </>
          )}
        </button>

        <p className="mt-6 text-center text-xs text-[var(--color-text-muted)]">
          Secure login via your organisation's identity provider
        </p>
      </div>
    </div>
  );
}
