/**
 * Auth module — JWT signing/verification, session management, route middleware.
 *
 * Flow:
 *   POST /auth/login  { provider, token }   → { jwt, refreshToken, user }
 *   POST /auth/refresh { refreshToken }      → { jwt, refreshToken }  (rolling 30d)
 *   POST /auth/logout  { refreshToken }      → 204
 *
 * Protected routes validate the short-lived JWT (1h).
 * When JWT expires the client uses refreshToken to get a new pair silently.
 */

import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { upsertUser, createSession, rotateSession, deleteSession, getUserById, pruneExpiredSessions } from './users.js';
import * as googleProvider from './providers/google.js';
import * as vngSsoProvider from './providers/vng-sso.js';

const JWT_SECRET  = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES = '1h';

const PROVIDERS = {
  [googleProvider.PROVIDER_ID]:  googleProvider,
  [vngSsoProvider.PROVIDER_ID]:  vngSsoProvider,
};

// Prune expired sessions every hour
setInterval(pruneExpiredSessions, 60 * 60 * 1000);

function signJwt(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES },
  );
}

function verifyJwt(token) {
  return jwt.verify(token, JWT_SECRET);
}

/** POST /auth/login */
export async function handleLogin(req, res) {
  let body;
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_json' }));
    return;
  }

  const { provider: providerId, token, redirectUri, codeVerifier } = body ?? {};
  const provider = PROVIDERS[providerId];
  if (!provider) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unknown_provider', supported: Object.keys(PROVIDERS) }));
    return;
  }

  let userInfo;
  try {
    userInfo = await provider.verifyToken(token, { redirectUri, codeVerifier });
  } catch (err) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'token_invalid', message: err.message }));
    return;
  }

  const user = upsertUser(userInfo);
  const refreshToken = uuidv4();
  createSession(user.id, refreshToken);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    jwt: signJwt(user),
    refreshToken,
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url },
  }));
}

/** POST /auth/refresh */
export async function handleRefresh(req, res) {
  let body;
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_json' }));
    return;
  }

  const { refreshToken: oldToken } = body ?? {};
  if (!oldToken) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing_refresh_token' }));
    return;
  }

  const newRefreshToken = uuidv4();
  const user = rotateSession(oldToken, newRefreshToken);
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'session_expired', message: 'Please log in again.' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    jwt: signJwt(user),
    refreshToken: newRefreshToken,
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url },
  }));
}

/** POST /auth/logout */
export async function handleLogout(req, res) {
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    const { refreshToken } = JSON.parse(Buffer.concat(chunks).toString()) ?? {};
    if (refreshToken) deleteSession(refreshToken);
  } catch { /* ignore */ }
  res.writeHead(204).end();
}

/**
 * Auth middleware — call before protected routes.
 * Accepts either:
 *   - Legacy static AGENT_TOKEN (backward compat)
 *   - JWT issued by this module
 *
 * Sets req.user = { sub, email, name } on success.
 * Returns true if auth passed, false (and sends 401) if not.
 */
export function requireAuth(req, res, validTokens) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  // Legacy static token
  if (validTokens.length && validTokens.includes(token)) {
    req.user = { sub: 'static-token', email: null, name: 'Agent' };
    return true;
  }

  // JWT
  try {
    req.user = verifyJwt(token);
    return true;
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: expired ? 'token_expired' : 'unauthorized',
      message: expired ? 'JWT expired, refresh required.' : 'Invalid or missing token.',
    }));
    return false;
  }
}

/** GET /auth/me — return current user info from JWT */
export function handleMe(req, res) {
  if (!req.user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  const user = getUserById(req.user.sub);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(user
    ? { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url }
    : { id: req.user.sub, email: req.user.email, name: req.user.name, avatarUrl: null },
  ));
}
