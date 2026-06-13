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

interface ChatStore {
  messages: ChatMessage[];
  conversationId: string;
  isLoading: boolean;
  streamError: string | null;
  activeSkills: string[];       // skill IDs currently enabled

  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (msg: ChatMessage) => void;
  updateLastAssistant: (updater: (msg: ChatMessage) => ChatMessage) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  clearHistory: () => void;
  toggleSkill: (id: string) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  conversationId: crypto.randomUUID(),
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
    set({ messages: [], conversationId: crypto.randomUUID(), streamError: null }),
  toggleSkill: (id) =>
    set((s) => ({
      activeSkills: s.activeSkills.includes(id)
        ? s.activeSkills.filter((x) => x !== id)
        : [...s.activeSkills, id],
    })),
}));
