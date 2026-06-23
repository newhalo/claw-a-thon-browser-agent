import React, { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { MoreHorizontal } from 'lucide-react';
import { summarizeSkillFromSession, type SkillDraft } from '../lib/agentServiceClient';
import type { ChatMessage } from '../lib/chatStore';

interface Props {
  messages: ChatMessage[];
  serviceUrl: string;
  disabled?: boolean;
}

function extractToolCalls(messages: ChatMessage[]): { toolName: string; args: unknown }[] {
  const calls: { toolName: string; args: unknown }[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.segments) continue;
    for (const seg of msg.segments) {
      if (seg.type === 'tool' && seg.inv) {
        calls.push({ toolName: seg.inv.toolName, args: seg.inv.args });
      }
    }
  }
  return calls;
}

export default function MoreActionsMenu({ messages, serviceUrl, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasMessages = messages.length > 0;

  const handleCreateSkill = async () => {
    setOpen(false);
    setError(null);
    setLoading(true);
    try {
      const plainMessages = messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
      }));
      const toolCalls = extractToolCalls(messages);
      const draft: SkillDraft = await summarizeSkillFromSession(serviceUrl, plainMessages, toolCalls);
      await chrome.storage.session.set({ skillDraft: draft });
      chrome.tabs.create({
        url: chrome.runtime.getURL('options.html') + '?tab=skills&prefill=1',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi không xác định');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled || loading}
            title="More actions"
            style={{
              width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg-elevated)', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: disabled || loading ? 'not-allowed' : 'pointer',
              opacity: disabled || loading ? 0.5 : 1, flexShrink: 0,
            }}
          >
            {loading
              ? <span style={{ fontSize: 10, animation: 'spin 1s linear infinite' }}>⏳</span>
              : <MoreHorizontal size={14} />
            }
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            side="top"
            align="end"
            sideOffset={6}
            style={{
              minWidth: 190, background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', borderRadius: 10,
              padding: 4, boxShadow: 'var(--shadow-md)', zIndex: 9999,
            }}
          >
            <button
              type="button"
              disabled={!hasMessages}
              onClick={handleCreateSkill}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '7px 10px', borderRadius: 6, border: 'none',
                background: 'transparent', cursor: hasMessages ? 'pointer' : 'not-allowed',
                opacity: hasMessages ? 1 : 0.4, textAlign: 'left',
                fontSize: 13, color: 'var(--text-primary)', fontFamily: 'inherit',
              }}
              onMouseEnter={e => { if (hasMessages) (e.currentTarget as HTMLElement).style.background = 'var(--accent-light)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 15 }}>🪄</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Tạo skill từ session</div>
                {!hasMessages && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Cần có tin nhắn trong session</div>
                )}
              </div>
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {error && (
        <div style={{
          position: 'absolute', bottom: '110%', right: 0,
          background: 'var(--bg-elevated)', border: '1px solid rgba(239,68,68,0.4)',
          borderRadius: 8, padding: '6px 10px', fontSize: 11,
          color: 'var(--error)', whiteSpace: 'nowrap', zIndex: 9999,
          boxShadow: 'var(--shadow-md)',
        }}>
          ❌ {error}
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11 }}
          >✕</button>
        </div>
      )}
    </div>
  );
}
