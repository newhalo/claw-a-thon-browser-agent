/**
 * User + session persistence — SQLite via better-sqlite3.
 * Shares the same DB file as long-term memory.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'memories.db');

let db;
function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        email       TEXT UNIQUE NOT NULL,
        name        TEXT,
        avatar_url  TEXT,
        provider    TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_token TEXT UNIQUE NOT NULL,
        expires_at    INTEGER NOT NULL,
        created_at    INTEGER NOT NULL,
        last_used_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_refresh ON sessions(refresh_token);
      CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
    `);
  }
  return db;
}

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function upsertUser({ id, email, name, avatarUrl, provider }) {
  const now = Date.now();
  const db = getDb();
  db.prepare(`
    INSERT INTO users (id, email, name, avatar_url, provider, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name       = excluded.name,
      avatar_url = excluded.avatar_url,
      updated_at = excluded.updated_at
  `).run(id, email, name ?? null, avatarUrl ?? null, provider, now, now);
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

export function createSession(userId, refreshToken) {
  const now = Date.now();
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (id, user_id, refresh_token, expires_at, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), userId, refreshToken, now + REFRESH_TTL_MS, now, now);
}

/** Rolling refresh — bumps expires_at by 30 days on each use */
export function rotateSession(oldRefreshToken, newRefreshToken) {
  const now = Date.now();
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE refresh_token = ?').get(oldRefreshToken);
  if (!session) return null;
  if (session.expires_at < now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    return null;
  }
  db.prepare(`
    UPDATE sessions SET refresh_token = ?, expires_at = ?, last_used_at = ? WHERE id = ?
  `).run(newRefreshToken, now + REFRESH_TTL_MS, now, session.id);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
}

export function deleteSession(refreshToken) {
  getDb().prepare('DELETE FROM sessions WHERE refresh_token = ?').run(refreshToken);
}

export function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

/** Remove expired sessions (called periodically) */
export function pruneExpiredSessions() {
  getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}
