/**
 * Google OAuth provider — PKCE authorization code flow.
 *
 * Extension sends: { provider: 'google', token: <code>, redirectUri, codeVerifier }
 * Server exchanges code → tokens → verifies id_token via tokeninfo.
 *
 * Requires env:
 *   GOOGLE_CLIENT_ID     — OAuth client ID (Chrome Extension type)
 *   GOOGLE_CLIENT_SECRET — OAuth client secret (optional for PKCE-only public clients,
 *                          but Google requires it even for Chrome Extension clients)
 */

export const PROVIDER_ID = 'google';

export async function verifyToken(code, { redirectUri, codeVerifier } = {}) {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID not set');

  // Exchange authorization code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    throw new Error(`Google token exchange failed: ${err.error_description || err.error || tokenRes.status}`);
  }

  const tokens = await tokenRes.json();
  const idToken = tokens.id_token;
  if (!idToken) throw new Error('Google did not return id_token');

  // Verify id_token
  const infoRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!infoRes.ok) throw new Error('Google tokeninfo verification failed');
  const info = await infoRes.json();
  if (info.error) throw new Error(`Google: ${info.error_description || info.error}`);

  const allowedClientIds = clientId.split(',').map(s => s.trim()).filter(Boolean);
  if (!allowedClientIds.includes(info.aud)) throw new Error('Google token audience mismatch');

  return {
    id:        `google:${info.sub}`,
    email:     info.email,
    name:      info.name ?? info.email,
    avatarUrl: info.picture ?? null,
    provider:  PROVIDER_ID,
  };
}
