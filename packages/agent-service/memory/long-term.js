/**
 * Long-term memory — SQLite-backed, per-conversation summaries with optional vector search.
 *
 * Storage:  packages/agent-service/data/memories.db
 * Search:   cosine similarity over stored embeddings (JS), fallback to SQLite FTS5
 * Trigger:  consolidateConversation() — re-runs every CONSOLIDATE_EVERY_N_TURNS new user turns
 * Inject:   searchMemories() called at start of each chat to build context block
 * Prune:    auto-prune when total entries exceed maxEntries (configurable)
 */

import Database from 'better-sqlite3';
import { embed } from 'ai';
import { getProviderCfg } from '../providers/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'memories.db');

// Re-consolidate every N new user turns within a conversation
const CONSOLIDATE_EVERY_N_TURNS = 5;

// Similarity threshold to merge into existing memory instead of creating new entry
const MERGE_SIMILARITY_THRESHOLD = 0.85;

// ── Memory config (runtime, pushed from extension) ────────────────────────────
let memoryConfig = { maxEntries: 200 };

export function setMemoryConfig(cfg) {
  if (cfg.maxEntries != null) memoryConfig.maxEntries = Math.max(10, parseInt(cfg.maxEntries, 10) || 200);
}

export function getMemoryConfig() {
  return { ...memoryConfig };
}

// ── DB init ───────────────────────────────────────────────────────────────────

let db;

function getDb() {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT    NOT NULL,
      content         TEXT    NOT NULL,
      embedding       TEXT,           -- JSON float array, NULL when embedding unavailable
      importance      REAL    DEFAULT 0.5,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_conv ON memories(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_memories_time ON memories(created_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
      USING fts5(content, content='memories', content_rowid='id', tokenize='unicode61');
  `);

  // Migrate: add updated_at column if missing (existing DBs)
  const cols = db.prepare("PRAGMA table_info(memories)").all().map(c => c.name);
  if (!cols.includes('updated_at')) {
    db.exec("ALTER TABLE memories ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0");
    db.exec("UPDATE memories SET updated_at = created_at WHERE updated_at = 0");
  }

  // FTS sync triggers
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_insert
      AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
      END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_delete
      AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_update
      AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
      END;
  `);

  console.log('[memory] DB initialized at', DB_PATH);
  return db;
}

// ── Vector helpers ────────────────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Save or merge a memory entry.
 * If an existing entry has embedding similarity >= MERGE_SIMILARITY_THRESHOLD,
 * update it in-place instead of creating a duplicate.
 */
export function saveMemory(conversationId, content, embedding = null, importance = 0.5) {
  const d = getDb();
  const now = Date.now();

  // Try to merge into existing similar entry (requires embedding on both sides)
  if (embedding) {
    const existing = d.prepare(
      'SELECT id, embedding FROM memories WHERE embedding IS NOT NULL ORDER BY updated_at DESC LIMIT 300'
    ).all();

    for (const row of existing) {
      let emb;
      try { emb = JSON.parse(row.embedding); } catch { continue; }
      if (cosineSimilarity(embedding, emb) >= MERGE_SIMILARITY_THRESHOLD) {
        d.prepare(
          'UPDATE memories SET content = ?, embedding = ?, importance = ?, updated_at = ? WHERE id = ?'
        ).run(content, JSON.stringify(embedding), Math.min(1.0, importance + 0.1), now, row.id);
        console.log(`[memory] Merged into existing entry #${row.id}`);
        return;
      }
    }
  }

  d.prepare(`
    INSERT INTO memories (conversation_id, content, embedding, importance, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    conversationId,
    content,
    embedding ? JSON.stringify(embedding) : null,
    importance,
    now,
    now,
  );

  pruneIfNeeded();
}

/**
 * Remove oldest, least-important entries when total exceeds maxEntries.
 * Keeps entries sorted by importance DESC, updated_at DESC.
 */
function pruneIfNeeded() {
  const d = getDb();
  const { count } = d.prepare('SELECT COUNT(*) AS count FROM memories').get();
  if (count <= memoryConfig.maxEntries) return;

  const excess = count - memoryConfig.maxEntries;
  // Delete the lowest-importance + oldest entries
  d.prepare(`
    DELETE FROM memories WHERE id IN (
      SELECT id FROM memories ORDER BY importance ASC, updated_at ASC LIMIT ?
    )
  `).run(excess);
  console.log(`[memory] Pruned ${excess} entries (max=${memoryConfig.maxEntries})`);
}

/**
 * Search memories relevant to a query.
 *
 * Strategy:
 *   1. If queryEmbedding provided → cosine similarity over stored embeddings
 *   2. Fallback to FTS5 keyword search
 *
 * Returns top-K memory objects { id, content, similarity, created_at }.
 */
export function searchMemories(query, queryEmbedding = null, topK = 5) {
  const d = getDb();

  if (queryEmbedding) {
    const rows = d.prepare(
      'SELECT id, content, embedding, updated_at AS created_at FROM memories WHERE embedding IS NOT NULL ORDER BY updated_at DESC LIMIT 500'
    ).all();
    const scored = rows
      .map(r => {
        let emb;
        try { emb = JSON.parse(r.embedding); } catch { return null; }
        return { ...r, similarity: cosineSimilarity(queryEmbedding, emb) };
      })
      .filter(Boolean)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    if (scored.length > 0 && scored[0].similarity > 0.3) return scored;
  }

  // FTS5 keyword fallback
  if (!query?.trim()) return [];
  try {
    const rows = d.prepare(`
      SELECT m.id, m.content, m.updated_at AS created_at, fts.rank AS similarity
      FROM memories_fts fts
      JOIN memories m ON fts.rowid = m.id
      WHERE memories_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `).all(query.trim().split(/\s+/).map(w => w + '*').join(' OR '), topK);
    return rows;
  } catch {
    return d.prepare(
      'SELECT id, content, updated_at AS created_at, 0.0 AS similarity FROM memories ORDER BY updated_at DESC LIMIT ?'
    ).all(topK);
  }
}

/**
 * Deduplicate existing memories by cosine similarity.
 * For each pair with similarity >= threshold, keep the most important/newest,
 * merge content, delete the other.
 * Returns { merged, deleted } counts.
 */
export function deduplicateMemories(threshold = 0.82) {
  const d = getDb();
  const rows = d.prepare(
    'SELECT id, content, embedding, importance, updated_at FROM memories WHERE embedding IS NOT NULL ORDER BY importance DESC, updated_at DESC'
  ).all();

  const deleted = new Set();
  let mergedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    if (deleted.has(rows[i].id)) continue;
    let embA;
    try { embA = JSON.parse(rows[i].embedding); } catch { continue; }

    for (let j = i + 1; j < rows.length; j++) {
      if (deleted.has(rows[j].id)) continue;
      let embB;
      try { embB = JSON.parse(rows[j].embedding); } catch { continue; }

      if (cosineSimilarity(embA, embB) >= threshold) {
        // Merge: keep rows[i] (higher importance/newer), append unique content from rows[j]
        const merged = rows[i].content === rows[j].content
          ? rows[i].content
          : `${rows[i].content}\n${rows[j].content}`.slice(0, 1000);
        const newImportance = Math.min(1.0, Math.max(rows[i].importance, rows[j].importance) + 0.05);
        d.prepare('UPDATE memories SET content = ?, importance = ?, updated_at = ? WHERE id = ?')
          .run(merged, newImportance, Date.now(), rows[i].id);
        d.prepare('DELETE FROM memories WHERE id = ?').run(rows[j].id);
        deleted.add(rows[j].id);
        rows[i] = { ...rows[i], content: merged, importance: newImportance };
        mergedCount++;
      }
    }
  }

  if (deleted.size > 0) {
    d.prepare("INSERT INTO memories_fts(memories_fts) VALUES ('rebuild')").run();
  }
  console.log(`[memory] Deduplicate: merged ${mergedCount}, deleted ${deleted.size}`);
  return { merged: mergedCount, deleted: deleted.size };
}

export function getRecentMemories(limit = 20) {
  return getDb().prepare(
    'SELECT id, conversation_id, content, importance, created_at, updated_at FROM memories ORDER BY updated_at DESC LIMIT ?'
  ).all(limit);
}

export function deleteMemory(id) {
  getDb().prepare('DELETE FROM memories WHERE id = ?').run(id);
}

export function clearAllMemories() {
  const d = getDb();
  d.prepare('DELETE FROM memories').run();
  d.prepare("INSERT INTO memories_fts(memories_fts) VALUES ('rebuild')").run();
}

export function getMemoryStats() {
  const d = getDb();
  const { count } = d.prepare('SELECT COUNT(*) AS count FROM memories').get();
  const { withEmbeddings } = d.prepare("SELECT COUNT(*) AS withEmbeddings FROM memories WHERE embedding IS NOT NULL").get();
  return { total: count, withEmbeddings, maxEntries: memoryConfig.maxEntries };
}

// ── Consolidation ─────────────────────────────────────────────────────────────

// Track last consolidated turn count per conversationId
// Value: number of user messages at last consolidation
const consolidatedAtTurn = new Map(); // conversationId → userMsgCount

/**
 * Summarize a conversation and save/merge into long-term memory.
 * Called async after chat completion — never blocks the response stream.
 * Re-runs every CONSOLIDATE_EVERY_N_TURNS new user turns (not time-based).
 */
export async function consolidateConversation(conversationId, messages, getModelFn, getEmbeddingFn) {
  const userMsgs = messages.filter(m => m.role === 'user');
  if (userMsgs.length < 2) return;

  // Re-consolidate every N new turns
  const lastTurn = consolidatedAtTurn.get(conversationId) ?? 0;
  if (userMsgs.length - lastTurn < CONSOLIDATE_EVERY_N_TURNS && lastTurn > 0) return;
  consolidatedAtTurn.set(conversationId, userMsgs.length);

  try {
    const extractText = (m) => typeof m.content === 'string'
      ? m.content
      : (Array.isArray(m.content)
          ? m.content.filter(p => p.type === 'text').map(p => p.text).join(' ')
          : '');

    // Full conversation digest (all turns, not just first 2)
    const digest = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${extractText(m).slice(0, 500)}`)
      .join('\n')
      .slice(0, 8000);

    // Summarize via direct fetch (bypasses AI SDK to avoid hanging on some providers)
    const cfg = getProviderCfg();
    let summary;
    if (cfg && cfg.apiKey && (cfg.provider === 'openai' || cfg.provider === 'openai-compat')) {
      const baseUrl = cfg.provider === 'openai' ? 'https://api.openai.com/v1' : cfg.baseUrl;
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.model || 'gpt-4o-mini',
            messages: [{
              role: 'user',
              content: `Summarize this conversation in 2–4 sentences. Capture key facts about the user (name, role, preferences, goals), decisions made, and outcomes. Focus on information useful in future conversations.\n\n${digest}`,
            }],
            max_tokens: 300,
            stream: false,
          }),
          signal: AbortSignal.timeout(30_000),
        });
        const data = await res.json();
        summary = data.choices?.[0]?.message?.content?.trim();
      } catch (err) {
        console.warn('[memory] Summarization failed, using fallback:', err.message);
      }
    }
    // Fallback: concatenate all user messages
    if (!summary) {
      summary = userMsgs.map(m => extractText(m).trim()).filter(Boolean).map(t => t.slice(0, 200)).join(' | ').slice(0, 800);
    }

    if (!summary?.trim()) return;

    // Embed
    let embedding = null;
    try {
      const embModel = getEmbeddingFn();
      if (embModel) {
        const embedPromise = embed({ model: embModel, value: summary });
        const embedTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Embedding timed out')), 15_000)
        );
        const { embedding: emb } = await Promise.race([embedPromise, embedTimeout]);
        embedding = emb;
      }
    } catch (err) {
      console.warn('[memory] Embedding failed, saving without vector:', err.message);
    }

    saveMemory(conversationId, summary.trim(), embedding);
    console.log(`[memory] Consolidated conv=${conversationId} turns=${userMsgs.length}: "${summary.slice(0, 80)}…"`);
  } catch (err) {
    console.warn('[memory] Consolidation failed:', err.message);
    // Roll back turn counter so next turn retries
    consolidatedAtTurn.set(conversationId, consolidatedAtTurn.get(conversationId) - CONSOLIDATE_EVERY_N_TURNS);
  }
}
