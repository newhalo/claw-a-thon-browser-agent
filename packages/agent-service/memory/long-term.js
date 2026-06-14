/**
 * Long-term memory — SQLite-backed, per-conversation summaries with optional vector search.
 *
 * Storage:  packages/agent-service/data/memories.db
 * Search:   cosine similarity over stored embeddings (JS), fallback to SQLite FTS5
 * Trigger:  consolidateConversation() called async after chat completion
 * Inject:   searchRelevantMemories() called at start of each chat to build context block
 */

import Database from 'better-sqlite3';
import { embed, generateText } from 'ai';
import path from 'path';
import { fileURLToPath } from 'url';

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'memories.db');

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
      created_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_conv ON memories(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_memories_time ON memories(created_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
      USING fts5(content, content='memories', content_rowid='id', tokenize='unicode61');
  `);

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

export function saveMemory(conversationId, content, embedding = null, importance = 0.5) {
  const d = getDb();
  d.prepare(`
    INSERT INTO memories (conversation_id, content, embedding, importance, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    conversationId,
    content,
    embedding ? JSON.stringify(embedding) : null,
    importance,
    Date.now(),
  );
}

/**
 * Search memories relevant to a query.
 *
 * Strategy:
 *   1. If queryEmbedding provided → cosine similarity over all stored embeddings
 *   2. Fallback to FTS5 keyword search
 *
 * Returns top-K memory objects { id, content, similarity, created_at }.
 */
export function searchMemories(query, queryEmbedding = null, topK = 5) {
  const d = getDb();

  if (queryEmbedding) {
    // Vector search — load all embeddings, rank by cosine similarity
    const rows = d.prepare('SELECT id, content, embedding, created_at FROM memories WHERE embedding IS NOT NULL ORDER BY created_at DESC LIMIT 500').all();
    const scored = rows
      .map(r => {
        let emb;
        try { emb = JSON.parse(r.embedding); } catch { return null; }
        return { ...r, similarity: cosineSimilarity(queryEmbedding, emb) };
      })
      .filter(Boolean)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    // If best similarity is too low, fall through to FTS
    if (scored.length > 0 && scored[0].similarity > 0.3) return scored;
  }

  // FTS5 keyword fallback
  if (!query?.trim()) return [];
  try {
    const rows = d.prepare(`
      SELECT m.id, m.content, m.created_at, fts.rank AS similarity
      FROM memories_fts fts
      JOIN memories m ON fts.rowid = m.id
      WHERE memories_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `).all(query.trim().split(/\s+/).map(w => w + '*').join(' OR '), topK);
    return rows;
  } catch {
    // FTS query syntax error — return recent memories
    return d.prepare('SELECT id, content, created_at, 0.0 AS similarity FROM memories ORDER BY created_at DESC LIMIT ?').all(topK);
  }
}

export function getRecentMemories(limit = 10) {
  return getDb().prepare('SELECT id, conversation_id, content, importance, created_at FROM memories ORDER BY created_at DESC LIMIT ?').all(limit);
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
  return { total: count, withEmbeddings };
}

// ── Consolidation ─────────────────────────────────────────────────────────────

// Track recently consolidated conversations (avoid duplicating within 5 min)
const recentlyConsolidated = new Map(); // conversationId → timestamp

/**
 * Summarize a completed conversation and save to long-term memory.
 * Called async after chat completion — never blocks the response stream.
 *
 * @param {string} conversationId
 * @param {import('ai').Message[]} messages
 * @param {() => import('ai').LanguageModel} getModelFn   — lazy to avoid circular import
 * @param {() => import('ai').EmbeddingModel | null} getEmbeddingFn
 */
export async function consolidateConversation(conversationId, messages, getModelFn, getEmbeddingFn) {
  // Skip if too few messages (< 4 = 2 exchanges)
  const userMsgs = messages.filter(m => m.role === 'user');
  if (userMsgs.length < 2) return;

  // Debounce — don't consolidate the same conversation within 5 minutes
  const last = recentlyConsolidated.get(conversationId);
  if (last && Date.now() - last < 5 * 60 * 1000) return;
  recentlyConsolidated.set(conversationId, Date.now());

  try {
    // Build a text digest of the conversation (trim large tool results)
    const digest = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        const text = typeof m.content === 'string'
          ? m.content
          : (Array.isArray(m.content)
              ? m.content.filter(p => p.type === 'text').map(p => p.text).join(' ')
              : JSON.stringify(m.content));
        return `${m.role === 'user' ? 'User' : 'Assistant'}: ${text.slice(0, 400)}`;
      })
      .join('\n')
      .slice(0, 6000);

    // Summarize
    const { text: summary } = await generateText({
      model: getModelFn(),
      messages: [{
        role: 'user',
        content: `Summarize this conversation in 2–3 sentences, capturing key facts, decisions, and outcomes that would be useful context in future conversations. Be concise and specific.\n\n${digest}`,
      }],
      maxTokens: 200,
      maxRetries: 0,
    });

    if (!summary?.trim()) return;

    // Embed
    let embedding = null;
    try {
      const embModel = getEmbeddingFn();
      if (embModel) {
        const { embedding: emb } = await embed({ model: embModel, value: summary });
        embedding = emb;
      }
    } catch (err) {
      console.warn('[memory] Embedding failed, saving without vector:', err.message);
    }

    saveMemory(conversationId, summary.trim(), embedding);
    console.log(`[memory] Saved memory for ${conversationId}: "${summary.slice(0, 80)}…"`);
  } catch (err) {
    console.warn('[memory] Consolidation failed:', err.message);
    // Remove from debounce map so it can retry next turn
    recentlyConsolidated.delete(conversationId);
  }
}
