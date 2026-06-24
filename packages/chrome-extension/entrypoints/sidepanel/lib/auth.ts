/**
 * Extension auth helpers.
 *
 * Storage keys (chrome.storage.local — not synced, more secure):
 *   auth_jwt           short-lived JWT (1h)
 *   auth_refresh_token opaque rolling refresh token (30d)
 *   auth_user          { id, email, name, avatarUrl }
 */

import { getAgentServiceConfig } from './agentServiceClient';

const KEY_JWT     = 'auth_jwt';
const KEY_REFRESH = 'auth_refresh_token';
const KEY_USER    = 'auth_user';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

export function getStoredAuth(): Promise<{ jwt: string | null; refreshToken: string | null; user: AuthUser | null }> {
  return new Promise(resolve =>
    chrome.storage.local.get([KEY_JWT, KEY_REFRESH, KEY_USER], r => resolve({
      jwt:          r[KEY_JWT]     ?? null,
      refreshToken: r[KEY_REFRESH] ?? null,
      user:         r[KEY_USER]    ?? null,
    }))
  );
}

export function saveAuth(jwt: string, refreshToken: string, user: AuthUser): Promise<void> {
  return new Promise(resolve =>
    chrome.storage.local.set({ [KEY_JWT]: jwt, [KEY_REFRESH]: refreshToken, [KEY_USER]: user }, resolve)
  );
}

export function clearAuth(): Promise<void> {
  return new Promise(resolve =>
    chrome.storage.local.remove([KEY_JWT, KEY_REFRESH, KEY_USER], resolve)
  );
}

// ── Google OAuth ──────────────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID = (import.meta as { env?: { VITE_GOOGLE_CLIENT_ID?: string } }).env?.VITE_GOOGLE_CLIENT_ID;

// PKCE helpers
function base64url(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generatePkce() {
  const verifier  = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

export async function loginWithGoogle(agentServiceUrl: string): Promise<AuthUser> {
  if (!GOOGLE_CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID not set. Add it to .env.local');

  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const { verifier, challenge } = await generatePkce();
  const state = crypto.randomUUID();

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id',             GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri',          redirectUri);
  authUrl.searchParams.set('response_type',         'code');
  authUrl.searchParams.set('scope',                 'openid email profile');
  authUrl.searchParams.set('code_challenge',        challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state',                 state);

  const redirectUrl = await new Promise<string>((resolve, reject) =>
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      url => url ? resolve(url) : reject(new Error(chrome.runtime.lastError?.message ?? 'Auth cancelled')),
    )
  );

  const params = new URL(redirectUrl).searchParams;
  if (params.get('state') !== state) throw new Error('OAuth state mismatch');
  const code = params.get('code');
  if (!code) throw new Error('Google did not return authorization code');

  // Exchange code on agent-service (keeps client_secret server-side)
  return loginWithProvider(agentServiceUrl, 'google', code, { redirectUri, codeVerifier: verifier });
}

// ── Generic provider login ────────────────────────────────────────────────────

async function loginWithProvider(
  agentServiceUrl: string,
  provider: string,
  token: string,
  extra?: Record<string, string>,
): Promise<AuthUser> {
  const res = await fetch(`${agentServiceUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, token, ...extra }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `Login failed (${res.status})`);
  }
  const data = await res.json();
  await saveAuth(data.jwt, data.refreshToken, data.user);
  return data.user;
}

// ── Silent refresh ────────────────────────────────────────────────────────────

let _refreshPromise: Promise<string | null> | null = null;

export async function refreshJwt(agentServiceUrl: string): Promise<string | null> {
  // Deduplicate concurrent refresh calls
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const { refreshToken } = await getStoredAuth();
      if (!refreshToken) return null;

      const res = await fetch(`${agentServiceUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        await clearAuth();
        return null;
      }

      const data = await res.json();
      await saveAuth(data.jwt, data.refreshToken, data.user);
      return data.jwt as string;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

// ── Logout ────────────────────────────────────────────────────────────────────

export async function logout(): Promise<void> {
  const [{ refreshToken }, cfg] = await Promise.all([getStoredAuth(), getAgentServiceConfig()]);
  if (refreshToken) {
    fetch(`${cfg.url}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }
  await clearAuth();
}

// ── isAuthenticated ───────────────────────────────────────────────────────────

export async function isAuthenticated(): Promise<boolean> {
  const { jwt, refreshToken } = await getStoredAuth();
  if (!jwt && !refreshToken) return false;
  // Has a refresh token — can silently renew, treat as authenticated
  return true;
}
