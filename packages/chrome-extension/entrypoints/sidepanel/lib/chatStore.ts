import { create } from 'zustand';

export interface ToolInvocation {
  toolCallId: string;
  toolName: string;
  state: 'call' | 'result';
  args?: unknown;
  result?: unknown;
}

export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'tool'; inv: ToolInvocation }

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;            // concatenated text, used for history sent to server
  segments?: MessageSegment[]; // ordered segments for display (assistant only)
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  conversationId: string;
}

const MAX_SESSIONS = 50;

export function sessionTitle(messages: ChatMessage[]): string {
  const first = messages.find(m => m.role === 'user');
  if (!first) return 'New chat';
  return first.content.trim().slice(0, 40) + (first.content.length > 40 ? '…' : '');
}

interface ChatStore {
  messages: ChatMessage[];
  conversationId: string;
  currentSessionId: string;
  isLoading: boolean;
  streamError: string | null;
  activeSkills: string[];

  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (msg: ChatMessage) => void;
  updateLastAssistant: (updater: (msg: ChatMessage) => ChatMessage) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  clearHistory: () => void;
  newSession: () => void;
  loadSession: (session: ChatSession) => void;
  toggleSkill: (id: string) => void;
}

function makeSessionId() { return crypto.randomUUID(); }

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  conversationId: crypto.randomUUID(),
  currentSessionId: makeSessionId(),
  isLoading: false,
  streamError: null,
  activeSkills: [],

  setMessages: (messages) => set({ messages }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  updateLastAssistant: (updater) =>
    set((s) => {
      const idx = [...s.messages].reverse().findIndex((m) => m.role === 'assistant');
      if (idx === -1) return {};
      const realIdx = s.messages.length - 1 - idx;
      const updated = [...s.messages];
      updated[realIdx] = updater(updated[realIdx]);
      return { messages: updated };
    }),
  setLoading: (v) => set({ isLoading: v }),
  setError: (e) => set({ streamError: e }),
  clearHistory: () =>
    set({ messages: [], conversationId: crypto.randomUUID(), currentSessionId: makeSessionId(), streamError: null }),
  newSession: () =>
    set({ messages: [], conversationId: crypto.randomUUID(), currentSessionId: makeSessionId(), streamError: null }),
  loadSession: (session) =>
    set({ messages: session.messages, conversationId: session.conversationId, currentSessionId: session.id, streamError: null }),
  toggleSkill: (id) =>
    set((s) => ({
      activeSkills: s.activeSkills.includes(id)
        ? s.activeSkills.filter((x) => x !== id)
        : [...s.activeSkills, id],
    })),
}));

// ── Session persistence helpers ───────────────────────────────────────────────

export function loadSessionsFromStorage(): Promise<ChatSession[]> {
  return new Promise(resolve => {
    chrome.storage.local.get(['chatSessions'], r => resolve(r.chatSessions || []));
  });
}

export function saveSessionsToStorage(sessions: ChatSession[]): Promise<void> {
  // Keep newest MAX_SESSIONS, sorted by updatedAt desc
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
  return new Promise(resolve => chrome.storage.local.set({ chatSessions: sorted }, resolve));
}

export function upsertSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  const idx = sessions.findIndex(s => s.id === session.id);
  if (idx >= 0) {
    const next = [...sessions];
    next[idx] = session;
    return next;
  }
  return [session, ...sessions];
}
