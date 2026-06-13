import React, { useCallback, useEffect, useRef, useState } from 'react';
import ToolsPopover from '../components/ToolsPopover';
import { getAgentServiceConfig, checkAgentServiceHealth } from '../lib/agentServiceClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToolInvocation {
  toolCallId: string;
  toolName: string;
  state: 'call' | 'result';
  args?: unknown;
  result?: unknown;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolInvocations?: ToolInvocation[];
}

// ─── Stream parser (Vercel AI SDK v4 data stream protocol) ────────────────────

function parseDataStreamChunk(raw: string): {
  type: 'text' | 'tool-call' | 'tool-result' | 'finish' | 'error' | 'unknown';
  data?: unknown;
} {
  if (!raw || !raw.includes(':')) return { type: 'unknown' };
  const colon = raw.indexOf(':');
  const prefix = raw.slice(0, colon);
  const payload = raw.slice(colon + 1);

  try {
    switch (prefix) {
      case '0': return { type: 'text', data: JSON.parse(payload) };
      case '9': return { type: 'tool-call', data: JSON.parse(payload) };
      case 'a': return { type: 'tool-result', data: JSON.parse(payload) };
      case 'd': return { type: 'finish', data: JSON.parse(payload) };
      case '3': return { type: 'error', data: JSON.parse(payload) };
      default:  return { type: 'unknown' };
    }
  } catch {
    return { type: 'unknown' };
  }
}

// ─── Tool Call UI ─────────────────────────────────────────────────────────────

function ToolCallBlock({ invocation }: { invocation: ToolInvocation }) {
  const [collapsed, setCollapsed] = useState(true);
  const isRunning = invocation.state === 'call';

  return (
    <div style={{
      margin: '6px 0',
      border: '1px solid var(--border)',
      borderRadius: 8,
      overflow: 'hidden',
      fontSize: 12,
    }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: '100%',
          background: isRunning ? 'rgba(99,102,241,0.08)' : 'rgba(34,197,94,0.06)',
          border: 'none',
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          textAlign: 'left',
        }}
      >
        <span>{isRunning ? '⚙️' : '✅'}</span>
        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>
          {invocation.toolName}
        </span>
        {isRunning && <span style={{ fontSize: 11, opacity: 0.7 }}>running…</span>}
        <span style={{ marginLeft: 'auto', opacity: 0.5 }}>{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div style={{ padding: '8px 10px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)' }}>
          {invocation.args && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 2 }}>Input</div>
              <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
                {JSON.stringify(invocation.args, null, 2)}
              </pre>
            </div>
          )}
          {invocation.state === 'result' && invocation.result !== undefined && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 2 }}>Result</div>
              <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)', maxHeight: 120, overflow: 'auto' }}>
                {typeof invocation.result === 'string' ? invocation.result : JSON.stringify(invocation.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 12,
    }}>
      {message.content && (
        <div style={{
          maxWidth: '85%',
          padding: '8px 12px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: isUser ? 'var(--accent)' : 'var(--bg-secondary)',
          color: isUser ? 'white' : 'var(--text-primary)',
          fontSize: 14,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {message.content}
        </div>
      )}

      {!isUser && message.toolInvocations && message.toolInvocations.length > 0 && (
        <div style={{ maxWidth: '95%', width: '100%', marginTop: message.content ? 4 : 0 }}>
          {message.toolInvocations.map(inv => (
            <ToolCallBlock key={inv.toolCallId} invocation={inv} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

function StatusBar({ serviceUrl, online }: { serviceUrl: string; online: boolean | null }) {
  return (
    <div style={{
      padding: '4px 12px',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 11,
      color: 'var(--text-secondary)',
      background: 'var(--bg-secondary)',
    }}>
      <span style={{ color: online === null ? '#f59e0b' : online ? '#22c55e' : '#ef4444' }}>●</span>
      <span>agent-service</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span style={{ opacity: 0.6 }}>{serviceUrl}</span>
    </div>
  );
}

// ─── ChatView ─────────────────────────────────────────────────────────────────

interface ChatViewProps {
  onOpenSettings: () => void;
}

export default function ChatView({ onOpenSettings }: ChatViewProps) {
  const conversationId = useRef(crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [serviceUrl, setServiceUrl] = useState('http://localhost:3000');
  const [online, setOnline] = useState<boolean | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getAgentServiceConfig().then(cfg => {
      setServiceUrl(cfg.url);
      checkAgentServiceHealth(cfg.url).then(ok => setOnline(ok));
    });
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      checkAgentServiceHealth(serviceUrl).then(ok => setOnline(ok));
    }, 15_000);
    return () => clearInterval(id);
  }, [serviceUrl]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    setStreamError(null);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };
    const assistantId = crypto.randomUUID();
    const newMessages = [...messages, userMessage];

    setMessages([...newMessages, {
      id: assistantId,
      role: 'assistant',
      content: '',
      toolInvocations: [],
    }]);
    setInput('');
    setIsLoading(true);

    abortRef.current = new AbortController();

    try {
      const res = await fetch(`${serviceUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          conversationId: conversationId.current,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server error: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Per-message state accumulated during streaming
      let accContent = '';
      const accTools: Map<string, ToolInvocation> = new Map();

      const flush = () => {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: accContent, toolInvocations: Array.from(accTools.values()) }
            : m
        ));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const { type, data } = parseDataStreamChunk(trimmed);

          if (type === 'text' && typeof data === 'string') {
            accContent += data;
            flush();
          } else if (type === 'tool-call' && data && typeof data === 'object') {
            const tc = data as { toolCallId: string; toolName: string; args: unknown };
            accTools.set(tc.toolCallId, {
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              state: 'call',
              args: tc.args,
            });
            flush();
          } else if (type === 'tool-result' && data && typeof data === 'object') {
            const tr = data as { toolCallId: string; result: unknown };
            const existing = accTools.get(tr.toolCallId);
            if (existing) {
              accTools.set(tr.toolCallId, { ...existing, state: 'result', result: tr.result });
              flush();
            }
          } else if (type === 'error' && typeof data === 'string') {
            setStreamError(data);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setStreamError(msg);
      setMessages(prev => prev.filter(m => m.id !== assistantId));
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [messages, isLoading, serviceUrl]);

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    sendMessage(input);
  }, [input, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }, [input, sendMessage]);

  const stopStreaming = () => {
    abortRef.current?.abort();
    setIsLoading(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      <StatusBar serviceUrl={serviceUrl} online={online} />

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 4px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 40, color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🤖</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>
              Browser Agent
            </div>
            <div style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.5 }}>
              Hỏi tôi bất cứ điều gì về trình duyệt.<br />
              Tôi có thể mở tab, điều hướng, đọc trang web<br />
              và tự động hóa các tác vụ của bạn.
            </div>
          </div>
        )}

        {messages.map(m => <MessageBubble key={m.id} message={m} />)}

        {isLoading && !messages.find(m => m.id && m.role === 'assistant' && m.content === '' && (m.toolInvocations?.length ?? 0) === 0) && (
          <div style={{ color: 'var(--text-secondary)', fontSize: 20, marginBottom: 8, paddingLeft: 4 }}>
            <span style={{ animation: 'pulse 1.2s infinite' }}>●●●</span>
          </div>
        )}

        {streamError && (
          <div style={{
            padding: '8px 12px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8,
            color: '#ef4444',
            fontSize: 12,
            marginBottom: 8,
          }}>
            ⚠️ {streamError}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <ToolsPopover />
          <button
            title="Settings"
            onClick={onOpenSettings}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 14,
              color: 'var(--text-secondary)',
            }}
          >
            ⚙️
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Nhắn tin cho agent… (Enter gửi, Shift+Enter xuống dòng)"
            rows={1}
            disabled={isLoading}
            style={{
              flex: 1,
              resize: 'none',
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: 14,
              fontFamily: 'inherit',
              lineHeight: 1.4,
              outline: 'none',
              maxHeight: 120,
              overflow: 'auto',
              opacity: isLoading ? 0.6 : 1,
            }}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
          />
          {isLoading ? (
            <button
              type="button"
              onClick={stopStreaming}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                border: 'none',
                background: '#ef4444',
                color: 'white',
                cursor: 'pointer',
                fontSize: 16,
                flexShrink: 0,
                alignSelf: 'flex-end',
              }}
            >
              ■
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                border: 'none',
                background: !input.trim() ? 'var(--border)' : 'var(--accent)',
                color: !input.trim() ? 'var(--text-secondary)' : 'white',
                cursor: !input.trim() ? 'default' : 'pointer',
                fontSize: 16,
                transition: 'background 0.15s',
                flexShrink: 0,
                alignSelf: 'flex-end',
              }}
            >
              ↑
            </button>
          )}
        </form>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1 }
          50% { opacity: 0.3 }
        }
      `}</style>
    </div>
  );
}
