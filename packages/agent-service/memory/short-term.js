/**
 * Short-term memory: per-conversation message history.
 * Sliding window of recent messages, auto-expires after idle timeout.
 */

const MAX_MESSAGES = 40;          // max messages to keep per conversation
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes

const sessions = new Map();  // conversationId → { messages, lastActiveAt }

function touch(conversationId) {
  const s = sessions.get(conversationId);
  if (s) s.lastActiveAt = Date.now();
}

export function getHistory(conversationId) {
  const s = sessions.get(conversationId);
  return s ? s.messages : [];
}

export function appendMessages(conversationId, newMessages) {
  if (!sessions.has(conversationId)) {
    sessions.set(conversationId, { messages: [], lastActiveAt: Date.now() });
  }
  const s = sessions.get(conversationId);
  s.messages.push(...newMessages);

  // Trim to sliding window: keep the system message (index 0) + last MAX_MESSAGES
  if (s.messages.length > MAX_MESSAGES + 1) {
    const systemMessages = s.messages.filter(m => m.role === 'system');
    const nonSystem = s.messages.filter(m => m.role !== 'system');
    s.messages = [...systemMessages, ...nonSystem.slice(-MAX_MESSAGES)];
  }

  touch(conversationId);
}

export function clearHistory(conversationId) {
  sessions.delete(conversationId);
}

// Evict idle sessions every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - IDLE_TIMEOUT_MS;
  for (const [id, s] of sessions) {
    if (s.lastActiveAt < cutoff) sessions.delete(id);
  }
}, 5 * 60 * 1000);
