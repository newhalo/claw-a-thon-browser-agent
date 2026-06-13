import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import ToolsPopover from '../components/ToolsPopover';
import { getAgentServiceConfig, checkAgentServiceHealth } from '../lib/agentServiceClient';
import { useChatStore, type ChatMessage, type ToolInvocation } from '../lib/chatStore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip browser_ / website_tool_{domain}_tab{n}_ prefixes for display */
function shortToolName(name: string): string {
  if (name.startsWith('browser_')) return name.slice(8).replace(/_/g, ' ');
  const m = name.match(/^website_tool_[^_]+_tab\d+_(.+)$/);
  if (m) return m[1].replace(/_/g, ' ');
  return name.replace(/_/g, ' ');
}

function parseDataStreamChunk(raw: string) {
  const colon = raw.indexOf(':');
  if (colon === -1) return null;
  const prefix = raw.slice(0, colon);
  const payload = raw.slice(colon + 1);
  try {
    switch (prefix) {
      case '0': return { type: 'text',        data: JSON.parse(payload) as string };
      case '9': return { type: 'tool-call',   data: JSON.parse(payload) };
      case 'a': return { type: 'tool-result', data: JSON.parse(payload) };
      case 'd': return { type: 'finish',      data: JSON.parse(payload) };
      case '3': return { type: 'error',       data: JSON.parse(payload) as string };
      default:  return null;
    }
  } catch { return null; }
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function Markdown({ content, isUser }: { content: string; isUser: boolean }) {
  return (
    <div className={`md ${isUser ? 'md-user' : ''}`}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

// ─── Tool call block ──────────────────────────────────────────────────────────

function ToolCallBlock({ inv }: { inv: ToolInvocation }) {
  const [open, setOpen] = useState(false);
  const done = inv.state === 'result';
  const label = shortToolName(inv.toolName);

  return (
    <div style={{
      margin: '4px 0',
      borderRadius: 8,
      border: '1px solid var(--border)',
      overflow: 'hidden',
      fontSize: 12,
      animation: 'fadeIn 0.2s ease',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          background: done ? 'rgba(16,185,129,0.05)' : 'rgba(79,70,229,0.06)',
          border: 'none',
          padding: '5px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 13 }}>{done ? '✅' : '⚙️'}</span>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1, textTransform: 'capitalize' }}>
          {label}
        </span>
        {!done && (
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            border: '2px solid var(--accent)',
            borderTopColor: 'transparent',
            animation: 'spin 0.8s linear infinite',
            display: 'inline-block',
          }} />
        )}
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div style={{ padding: '8px 10px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)' }}>
          {inv.args && Object.keys(inv.args as object).length > 0 && (
            <div style={{ marginBottom: done ? 8 : 0 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Args</div>
              <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
                {JSON.stringify(inv.args, null, 2)}
              </pre>
            </div>
          )}
          {done && inv.result !== undefined && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Result</div>
              <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)', maxHeight: 140, overflow: 'auto' }}>
                {typeof inv.result === 'string' ? inv.result : JSON.stringify(inv.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 14,
      animation: 'fadeIn 0.2s ease',
    }}>
      {msg.content && (
        <div style={{
          maxWidth: '84%',
          padding: '9px 13px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
          background: isUser ? 'var(--accent)' : 'var(--bg-surface)',
          color: isUser ? '#fff' : 'var(--text-primary)',
          border: isUser ? 'none' : '1px solid var(--border)',
          boxShadow: 'var(--shadow-sm)',
          wordBreak: 'break-word',
        }}>
          <Markdown content={msg.content} isUser={isUser} />
        </div>
      )}

      {!isUser && msg.toolInvocations && msg.toolInvocations.length > 0 && (
        <div style={{ maxWidth: '92%', width: '100%', marginTop: msg.content ? 5 : 0 }}>
          {msg.toolInvocations.map(inv => (
            <ToolCallBlock key={inv.toolCallId} inv={inv} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '8px 4px', marginBottom: 14 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: 'var(--text-muted)',
          animation: `pulse 1.2s ease ${i * 0.2}s infinite`,
          display: 'inline-block',
        }} />
      ))}
    </div>
  );
}

// ─── ChatView ─────────────────────────────────────────────────────────────────

interface Props { onOpenSettings: () => void }

export default function ChatView({ onOpenSettings }: Props) {
  const { messages, conversationId, isLoading, streamError, addMessage, updateLastAssistant, setLoading, setError, clearHistory } = useChatStore();
  const [input, setInput] = useState('');
  const [serviceUrl, setServiceUrl] = useState('http://localhost:3000');
  const [online, setOnline] = useState<boolean | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getAgentServiceConfig().then(cfg => {
      setServiceUrl(cfg.url);
      checkAgentServiceHealth(cfg.url).then(ok => setOnline(ok));
    });
  }, []);

  useEffect(() => {
    const id = setInterval(() => checkAgentServiceHealth(serviceUrl).then(ok => setOnline(ok)), 15_000);
    return () => clearInterval(id);
  }, [serviceUrl]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    setError(null);

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    const assistantId = crypto.randomUUID();
    addMessage(userMsg);
    addMessage({ id: assistantId, role: 'assistant', content: '', toolInvocations: [] });
    setInput('');
    setLoading(true);
    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }

    abortRef.current = new AbortController();

    // Snapshot messages BEFORE adding user turn (store is async)
    const historyForRequest = messages.map(m => ({ role: m.role, content: m.content }));
    historyForRequest.push({ role: 'user', content: text });

    try {
      const res = await fetch(`${serviceUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: historyForRequest, conversationId }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) throw new Error(`Server error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accContent = '';
      const accTools = new Map<string, ToolInvocation>();

      const flush = () => {
        updateLastAssistant(m => ({
          ...m,
          content: accContent,
          toolInvocations: Array.from(accTools.values()),
        }));
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
          const chunk = parseDataStreamChunk(trimmed);
          if (!chunk) continue;
          if (chunk.type === 'text' && typeof chunk.data === 'string') {
            accContent += chunk.data; flush();
          } else if (chunk.type === 'tool-call') {
            const tc = chunk.data as { toolCallId: string; toolName: string; args: unknown };
            accTools.set(tc.toolCallId, { toolCallId: tc.toolCallId, toolName: tc.toolName, state: 'call', args: tc.args });
            flush();
          } else if (chunk.type === 'tool-result') {
            const tr = chunk.data as { toolCallId: string; result: unknown };
            const ex = accTools.get(tr.toolCallId);
            if (ex) { accTools.set(tr.toolCallId, { ...ex, state: 'result', result: tr.result }); flush(); }
          } else if (chunk.type === 'error' && typeof chunk.data === 'string') {
            setError(chunk.data);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Unknown error');
      // Remove empty placeholder assistant message
      updateLastAssistant(m => m.content === '' ? { ...m, content: '_(error)_' } : m);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [messages, isLoading, serviceUrl, conversationId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}>

      {/* Status bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px',
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
        fontSize: 11, color: 'var(--text-muted)',
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: online === null ? 'var(--warning)' : online ? 'var(--success)' : 'var(--error)',
        }} />
        <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>agent-service</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{serviceUrl}</span>
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            title="Clear conversation"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11, padding: '1px 4px', borderRadius: 4 }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px 8px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 48 }}>
            <div style={{ fontSize: 36, marginBottom: 14 }}>🤖</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
              Browser Agent
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, maxWidth: 240, margin: '0 auto' }}>
              Tôi có thể mở tab, điều hướng, đọc trang web và tự động hóa tác vụ của bạn.
            </div>
          </div>
        )}

        {messages.map(m => <MessageBubble key={m.id} msg={m} />)}

        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && <TypingDots />}

        {streamError && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginBottom: 10,
            background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)',
            color: 'var(--error)', fontSize: 12,
          }}>
            ⚠️ {streamError}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '8px 12px 10px',
        background: 'var(--bg-elevated)',
        borderTop: '1px solid var(--border)',
      }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          <ToolsPopover />
          <button
            onClick={onOpenSettings}
            title="Settings"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
              fontSize: 12, color: 'var(--text-secondary)',
            }}
          >
            <span style={{ fontSize: 13 }}>⚙️</span>
            <span>Settings</span>
          </button>
        </div>

        {/* Text input row */}
        <div style={{
          display: 'flex', gap: 6, alignItems: 'flex-end',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '6px 6px 6px 12px',
          transition: 'border-color 0.15s',
        }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Nhắn tin cho agent…"
            rows={1}
            disabled={isLoading}
            style={{
              flex: 1, resize: 'none', border: 'none', background: 'transparent',
              color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit',
              lineHeight: 1.5, outline: 'none', maxHeight: 120, overflow: 'auto',
              padding: 0, opacity: isLoading ? 0.7 : 1,
            }}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
          />
          {isLoading ? (
            <button
              onClick={() => { abortRef.current?.abort(); setLoading(false); }}
              title="Stop"
              style={{
                width: 30, height: 30, borderRadius: 8, border: 'none',
                background: 'var(--error)', color: 'white',
                cursor: 'pointer', fontSize: 12, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >■</button>
          ) : (
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim()}
              title="Send (Enter)"
              style={{
                width: 30, height: 30, borderRadius: 8, border: 'none',
                background: input.trim() ? 'var(--accent)' : 'var(--bg-active)',
                color: input.trim() ? 'white' : 'var(--text-muted)',
                cursor: input.trim() ? 'pointer' : 'default',
                fontSize: 14, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.15s',
              }}
            >↑</button>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5, textAlign: 'center' }}>
          Enter gửi · Shift+Enter xuống dòng
        </div>
      </div>
    </div>
  );
}
