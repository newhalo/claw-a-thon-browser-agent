import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useChat, type Message } from '@ai-sdk/react';
function uuidv4() {
  return crypto.randomUUID();
}
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

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 12,
    }}>
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

      {/* Tool invocations (assistant messages only) */}
      {!isUser && message.toolInvocations && message.toolInvocations.length > 0 && (
        <div style={{ maxWidth: '95%', width: '100%', marginTop: 4 }}>
          {(message.toolInvocations as ToolInvocation[]).map(inv => (
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
      <span style={{ color: online === null ? '#f59e0b' : online ? '#22c55e' : '#ef4444' }}>
        {online === null ? '●' : online ? '●' : '●'}
      </span>
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
  const [conversationId] = useState(() => uuidv4());
  const [serviceUrl, setServiceUrl] = useState('http://localhost:3000');
  const [online, setOnline] = useState<boolean | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load agent-service config
  useEffect(() => {
    getAgentServiceConfig().then(cfg => {
      setServiceUrl(cfg.url);
      checkAgentServiceHealth(cfg.url).then(ok => setOnline(ok));
    });
  }, []);

  // Ping every 15s
  useEffect(() => {
    const id = setInterval(() => {
      checkAgentServiceHealth(serviceUrl).then(ok => setOnline(ok));
    }, 15_000);
    return () => clearInterval(id);
  }, [serviceUrl]);

  const { messages, input, handleInputChange, handleSubmit, isLoading, error, setInput } = useChat({
    api: `${serviceUrl}/chat`,
    body: { conversationId },
    onError: (err) => console.error('[chat] Error:', err),
  });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isLoading) {
        handleSubmit(e as unknown as React.FormEvent);
      }
    }
  }, [input, isLoading, handleSubmit]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--bg-primary)',
    }}>
      <StatusBar serviceUrl={serviceUrl} online={online} />

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 12px 4px',
      }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center',
            marginTop: 40,
            color: 'var(--text-secondary)',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🤖</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>
              Browser Agent
            </div>
            <div style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.5 }}>
              Hỏi tôi bất cứ điều gì về trình duyệt.<br/>
              Tôi có thể mở tab, điều hướng, đọc trang web và tự động hóa các tác vụ của bạn.
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8 }}>
            <span style={{ animation: 'pulse 1s infinite' }}>●●●</span>
          </div>
        )}

        {error && (
          <div style={{
            padding: '8px 12px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8,
            color: '#ef4444',
            fontSize: 12,
            marginBottom: 8,
          }}>
            ⚠️ {error.message || 'Lỗi kết nối tới agent-service'}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
      }}>
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
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Nhắn tin cho agent… (Enter để gửi, Shift+Enter xuống dòng)"
            rows={1}
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
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: 'none',
              background: isLoading || !input.trim() ? 'var(--border)' : 'var(--accent)',
              color: isLoading || !input.trim() ? 'var(--text-secondary)' : 'white',
              cursor: isLoading || !input.trim() ? 'default' : 'pointer',
              fontSize: 16,
              transition: 'background 0.15s',
              flexShrink: 0,
              alignSelf: 'flex-end',
            }}
          >
            {isLoading ? '⏳' : '↑'}
          </button>
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
