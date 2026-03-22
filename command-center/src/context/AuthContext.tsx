/**
 * AuthContext — manages authentication state.
 *
 * Supports two modes:
 *
 * 1. OAuth mode (VITE_OAUTH_AUTHORITY is set):
 *    - User is authenticated when valid OAuth tokens are stored in sessionStorage.
 *    - `login()` redirects to the OAuth provider.
 *    - `logout()` clears tokens and redirects to provider logout endpoint.
 *    - User profile (name, email, picture) is available via `user`.
 *
 * 2. Legacy bearer token mode (VITE_OAUTH_AUTHORITY is NOT set):
 *    - Same behaviour as before Iteration 32.
 *    - `token` / `setToken` / `clearToken` / `isConfigured` work exactly as before.
 *    - `login()` / `logout()` are no-ops.
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import {
  isOAuthConfigured,
  isAuthenticated as oauthIsAuthenticated,
  getAccessToken as oauthGetAccessToken,
  getUser,
  login as oauthLogin,
  logout as oauthLogout,
  type OAuthUser,
} from '../services/auth';

export interface AuthContextValue {
  // Legacy token API — always available for backward compat
  token: string;
  setToken: (token: string) => void;
  isConfigured: boolean;
  clearToken: () => void;

  // OAuth API
  /** True when OAuth is configured AND the user has a valid session. */
  oauthEnabled: boolean;
  /** Authenticated via OAuth (or legacy token when oauthEnabled=false). */
  isAuthenticated: boolean;
  /** Current user profile (OAuth only; null in legacy mode). */
  user: OAuthUser | null;
  /** Initiates login (OAuth redirect or no-op in legacy mode). */
  login: () => Promise<void>;
  /** Clears session (OAuth logout or clears legacy token). */
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // ── Legacy bearer token state ────────────────────────────────────
  const [token, setTokenState] = useState<string>(
    () => import.meta.env.VITE_MANAGER_TOKEN ?? '',
  );

  const setToken = useCallback((t: string) => {
    setTokenState(t);
  }, []);

  const clearToken = useCallback(() => {
    setTokenState('');
  }, []);

  const isConfigured = token.length > 0;

  // ── OAuth state ──────────────────────────────────────────────────
  const oauthEnabled = isOAuthConfigured();

  // User profile state: populated after a successful OAuth callback.
  const [user, setUser] = useState<OAuthUser | null>(() => (oauthEnabled ? getUser() : null));

  // Auth status: in OAuth mode derive from service; in legacy mode derive from token.
  const isAuthenticated = oauthEnabled ? oauthIsAuthenticated() : isConfigured;

  const login = useCallback(async () => {
    if (oauthEnabled) {
      await oauthLogin();
    }
    // Legacy mode: no-op — user enters token via the existing AuthGate / banner
  }, [oauthEnabled]);

  const logout = useCallback(() => {
    if (oauthEnabled) {
      setUser(null);
      oauthLogout(); // redirects browser — nothing after this runs
    } else {
      clearToken();
    }
  }, [oauthEnabled, clearToken]);

  // When OAuth mode is active, refresh user profile from storage on mount
  // (handles the case where the user returns to the app and tokens are still valid).
  React.useEffect(() => {
    if (oauthEnabled) {
      const profile = getUser();
      setUser(profile);
    }
  }, [oauthEnabled]);

  // Get the effective access token (OAuth token or legacy bearer token)
  const effectiveToken = oauthEnabled ? oauthGetAccessToken() : token;

  return (
    <AuthContext.Provider
      value={{
        // Legacy API (always present — backward compat)
        token: effectiveToken,
        setToken,
        isConfigured: oauthEnabled ? isAuthenticated : isConfigured,
        clearToken,

        // OAuth API
        oauthEnabled,
        isAuthenticated,
        user,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
