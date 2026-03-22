/**
 * AuthCallbackPage — handles the OAuth redirect callback.
 *
 * Mounted at /auth/callback in App.tsx.
 * Exchanges the authorization code for tokens, then redirects to '/'.
 *
 * If OAuth is not configured this page simply redirects to '/'.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleCallback, isOAuthConfigured } from '../services/auth';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function process() {
      if (!isOAuthConfigured()) {
        navigate('/', { replace: true });
        return;
      }

      try {
        await handleCallback(window.location.href);
        navigate('/', { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
      }
    }

    process();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--color-bg)' }}
        data-testid="auth-callback-error"
      >
        <div
          className="w-full max-w-sm p-8 rounded-2xl border border-red-500/30 shadow-2xl text-center"
          style={{ background: 'var(--color-surface-dark)' }}
        >
          <div className="text-4xl mb-4" aria-hidden="true">⚠</div>
          <h1 className="text-lg font-bold text-[var(--color-text)] mb-2">Authentication Failed</h1>
          <p className="text-sm text-red-400 mb-6">{error}</p>
          <button
            onClick={() => (window.location.href = '/')}
            className="px-4 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-sm font-medium hover:bg-emerald-500/25 transition-all"
          >
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--color-bg)' }}
      data-testid="auth-callback-loading"
    >
      <div className="flex flex-col items-center gap-4">
        <div
          aria-hidden="true"
          className="w-10 h-10 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"
        />
        <p className="text-sm text-[var(--color-text-dim)]">Completing sign in…</p>
      </div>
    </div>
  );
}
