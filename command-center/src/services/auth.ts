/**
 * OAuth Authentication Service
 *
 * Implements the Authorization Code flow with PKCE.
 *
 * Configuration (via Vite env vars):
 *   VITE_OAUTH_AUTHORITY      — base URL of the OAuth provider (e.g. https://auth.example.com)
 *   VITE_OAUTH_CLIENT_ID      — client ID registered with the provider
 *   VITE_OAUTH_REDIRECT_URI   — absolute redirect URI (defaults to window.location.origin + '/auth/callback')
 *
 * When VITE_OAUTH_AUTHORITY is NOT set, the service is in "legacy bearer token" mode
 * and all OAuth methods are no-ops / return safe defaults.  The rest of the app
 * continues to work exactly as it did before Iteration 32.
 */

const STORAGE_PREFIX = 'kubex_oauth_';

function storageKey(k: string) {
  return `${STORAGE_PREFIX}${k}`;
}

function getEnv(key: string): string {
  return (import.meta.env[key as keyof ImportMetaEnv] as string | undefined) ?? '';
}

// ── PKCE helpers ──────────────────────────────────────────────────────

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  return base64UrlEncode(array.buffer);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await sha256(verifier);
  return base64UrlEncode(hash);
}

// ── Token storage ─────────────────────────────────────────────────────

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // ms since epoch
  token_type: string;
  scope?: string;
}

export interface OAuthUser {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
}

function saveTokens(tokens: OAuthTokens): void {
  sessionStorage.setItem(storageKey('tokens'), JSON.stringify(tokens));
}

function loadTokens(): OAuthTokens | null {
  try {
    const raw = sessionStorage.getItem(storageKey('tokens'));
    if (!raw) return null;
    return JSON.parse(raw) as OAuthTokens;
  } catch {
    return null;
  }
}

function clearTokens(): void {
  sessionStorage.removeItem(storageKey('tokens'));
  sessionStorage.removeItem(storageKey('user'));
  sessionStorage.removeItem(storageKey('verifier'));
  sessionStorage.removeItem(storageKey('state'));
}

function saveUser(user: OAuthUser): void {
  sessionStorage.setItem(storageKey('user'), JSON.stringify(user));
}

function loadUser(): OAuthUser | null {
  try {
    const raw = sessionStorage.getItem(storageKey('user'));
    if (!raw) return null;
    return JSON.parse(raw) as OAuthUser;
  } catch {
    return null;
  }
}

// ── Configuration ─────────────────────────────────────────────────────

export function isOAuthConfigured(): boolean {
  return getEnv('VITE_OAUTH_AUTHORITY') !== '';
}

function getAuthority(): string {
  return getEnv('VITE_OAUTH_AUTHORITY').replace(/\/$/, '');
}

function getClientId(): string {
  return getEnv('VITE_OAUTH_CLIENT_ID');
}

function getRedirectUri(): string {
  const configured = getEnv('VITE_OAUTH_REDIRECT_URI');
  if (configured) return configured;
  return `${window.location.origin}/auth/callback`;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Returns the current access token.
 * In legacy mode returns the VITE_MANAGER_TOKEN bearer token.
 */
export function getAccessToken(): string {
  if (!isOAuthConfigured()) {
    return getEnv('VITE_MANAGER_TOKEN');
  }
  const tokens = loadTokens();
  return tokens?.access_token ?? '';
}

/**
 * Returns true when the user is authenticated.
 * In legacy mode returns true when VITE_MANAGER_TOKEN is set.
 */
export function isAuthenticated(): boolean {
  if (!isOAuthConfigured()) {
    return getEnv('VITE_MANAGER_TOKEN') !== '';
  }
  const tokens = loadTokens();
  if (!tokens) return false;
  return tokens.expires_at > Date.now() + 5_000; // 5 s buffer
}

/**
 * Returns profile information if available.
 */
export function getUser(): OAuthUser | null {
  if (!isOAuthConfigured()) return null;
  return loadUser();
}

/**
 * Initiates the OAuth Authorization Code + PKCE flow.
 * Redirects the browser to the provider's authorize URL.
 */
export async function login(): Promise<void> {
  if (!isOAuthConfigured()) return;

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)).buffer);

  sessionStorage.setItem(storageKey('verifier'), verifier);
  sessionStorage.setItem(storageKey('state'), state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${getAuthority()}/authorize?${params.toString()}`;
}

/**
 * Handles the OAuth callback after the provider redirects back.
 * Exchanges the authorization code for tokens.
 * Returns true on success, throws on failure.
 */
export async function handleCallback(callbackUrl: string): Promise<boolean> {
  if (!isOAuthConfigured()) return false;

  const url = new URL(callbackUrl);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    const desc = url.searchParams.get('error_description') ?? error;
    throw new Error(`OAuth error: ${desc}`);
  }

  if (!code) throw new Error('OAuth callback missing authorization code');

  const savedState = sessionStorage.getItem(storageKey('state'));
  if (savedState && returnedState !== savedState) {
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  const verifier = sessionStorage.getItem(storageKey('verifier'));
  if (!verifier) throw new Error('PKCE verifier missing from session storage');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    code,
    code_verifier: verifier,
  });

  const res = await fetch(`${getAuthority()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
  }

  const data = (await res.json()) as TokenResponse;

  const tokens: OAuthTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
    token_type: data.token_type ?? 'Bearer',
    scope: data.scope,
  };

  saveTokens(tokens);

  // Clean up PKCE state
  sessionStorage.removeItem(storageKey('verifier'));
  sessionStorage.removeItem(storageKey('state'));

  // Fetch user profile if we have an openid token
  try {
    await fetchUserProfile(tokens.access_token);
  } catch {
    // Non-fatal — user profile is optional
  }

  return true;
}

/**
 * Refreshes the access token using the stored refresh token.
 * Returns true on success, false if no refresh token is available.
 * On failure (network error, expired refresh token) clears session and returns false.
 */
export async function refreshToken(): Promise<boolean> {
  if (!isOAuthConfigured()) return false;

  const tokens = loadTokens();
  if (!tokens?.refresh_token) return false;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: getClientId(),
    refresh_token: tokens.refresh_token,
  });

  try {
    const res = await fetch(`${getAuthority()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      clearTokens();
      return false;
    }

    interface TokenResponse {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    }

    const data = (await res.json()) as TokenResponse;

    const refreshed: OAuthTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? tokens.refresh_token,
      expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
      token_type: data.token_type ?? 'Bearer',
      scope: tokens.scope,
    };

    saveTokens(refreshed);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

/**
 * Logs out: clears session storage and redirects to the provider's end_session endpoint
 * if available, otherwise reloads the page.
 */
export function logout(): void {
  clearTokens();
  if (!isOAuthConfigured()) return;

  const params = new URLSearchParams({
    client_id: getClientId(),
    post_logout_redirect_uri: window.location.origin,
  });

  // Try RP-Initiated Logout (OIDC spec) — may not be supported by all providers
  const endSessionUrl = `${getAuthority()}/logout?${params.toString()}`;
  window.location.href = endSessionUrl;
}

// ── Internal helpers ──────────────────────────────────────────────────

async function fetchUserProfile(accessToken: string): Promise<void> {
  const res = await fetch(`${getAuthority()}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return;

  interface UserinfoResponse {
    sub?: string;
    name?: string;
    email?: string;
    picture?: string;
    [key: string]: unknown;
  }

  const data = (await res.json()) as UserinfoResponse;
  const user: OAuthUser = {
    sub: data.sub,
    name: data.name,
    email: data.email,
    picture: data.picture,
  };
  saveUser(user);
}
