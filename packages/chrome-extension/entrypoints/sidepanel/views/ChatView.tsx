import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as Popover from '@radix-ui/react-popover';
import {
  ArrowUp, Square, ArrowLeft, ChevronUp, ChevronDown, X, Plus,
  History, Check, Loader2, CheckCircle2, Wrench, Target, AlertTriangle,
  Bot,
} from 'lucide-react';
import ToolsPopover from '../components/ToolsPopover';
import { getAgentServiceConfig, checkAgentServiceHealth, setAgentToken, pushProviderConfig, listModelsForConfiguredProvider, fetchProviderConfig, fetchSkills, loadCustomSkills, loadDisabledSkills, loadCustomMcpServers, pushExternalMcpServers, pushMemoryConfig, DEFAULT_AGENT_SERVICE_URL, type Skill, type CustomSkill, type ModelInfo } from '../lib/agentServiceClient';
import { useChatStore, type ChatMessage, type ToolInvocation, type MessageSegment, type ChatSession, sessionTitle, loadSessionsFromStorage, saveSessionsToStorage, upsertSession } from '../lib/chatStore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Re-push saved provider config to agent-service after a restart */
async function repushProviderConfig(agentServiceUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['agentProviderConfig'], async (result) => {
      try {
        const saved = result.agentProviderConfig;
        if (!saved?.provider || !saved?.apiKey) { resolve(false); return; }
        // Normalize legacy 'openai-compat' saved before 'vngcloud' provider type existed
        let provider = saved.provider;
        if (provider === 'openai-compat' && typeof saved.baseUrl === 'string' && saved.baseUrl.includes('vngcloud')) {
          provider = 'vngcloud';
          chrome.storage.sync.set({ agentProviderConfig: { ...saved, provider } });
        }
        const ok = await pushProviderConfig(agentServiceUrl, provider, saved.apiKey, saved.model, saved.baseUrl, saved.toolsSupported, saved.visionSupported, saved.embeddingModel);
        resolve(ok);
      } catch {
        resolve(false);
      }
    });
  });
}

/** Strip browser_ / wt_{domain}_t{n}_ prefixes for display */
function shortToolName(name: string): string {
  if (name.startsWith('browser_')) return name.slice(8).replace(/_/g, ' ');
  const m = name.match(/^wt_.+_t\d+_(.+)$/) || name.match(/^website_tool_[^_]+_tab\d+_(.+)$/);
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
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

// ─── Tool call block ──────────────────────────────────────────────────────────

function ToolResultContent({ result, serviceUrl }: { result: unknown; serviceUrl: string }) {
  // Extract screenshot ID from either string or vision content array
  let screenshotId: string | undefined;
  if (typeof result === 'string') {
    screenshotId = result.match(/^\[screenshot:([a-f0-9-]+)\]$/)?.[1];
  } else if (Array.isArray(result)) {
    // Vision content array: [{type:'image',...}, {type:'text',text:'[screenshot:id]'}]
    const textPart = (result as Array<{ type: string; text?: string }>).find(p => p.type === 'text');
    screenshotId = textPart?.text?.match(/^\[screenshot:([a-f0-9-]+)\]$/)?.[1];
  }

  if (screenshotId) {
    return (
      <img
        src={`${serviceUrl}/screenshot/${screenshotId}`}
        alt="screenshot"
        style={{ maxWidth: '100%', borderRadius: 4, display: 'block' }}
      />
    );
  }

  return (
    <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)', maxHeight: 140, overflow: 'auto' }}>
      {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
    </pre>
  );
}

function ToolCallBlock({ inv, serviceUrl }: { inv: ToolInvocation; serviceUrl: string }) {
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
        <span style={{ display: 'flex', alignItems: 'center', color: done ? 'var(--success)' : 'var(--accent)', flexShrink: 0 }}>
          {done
            ? <CheckCircle2 size={14} />
            : <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} />}
        </span>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1, textTransform: 'capitalize' }}>
          {label}
        </span>
        <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {open && (
        <div style={{ padding: '8px 10px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)' }}>
          {!!(inv.args && Object.keys(inv.args as object).length > 0) && (
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
              <ToolResultContent result={inv.result} serviceUrl={serviceUrl} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Assistant message — flat, no bubble ─────────────────────────────────────

function AssistantMessage({ msg, serviceUrl }: { msg: ChatMessage; serviceUrl: string }) {
  // Fall back to plain text segment if segments not populated yet
  const segs: MessageSegment[] = msg.segments?.length
    ? msg.segments
    : msg.content
      ? [{ type: 'text', content: msg.content }]
      : [];

  if (segs.length === 0) return null;

  return (
    <div style={{ marginBottom: 16, animation: 'fadeIn 0.2s ease' }}>
      {segs.map((seg, i) =>
        seg.type === 'text' ? (
          !seg.content ? null : (
            <div key={i} className="md" style={{ lineHeight: 1.6, color: 'var(--text-primary)' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.content}</ReactMarkdown>
            </div>
          )
        ) : (
          <ToolCallBlock key={seg.inv.toolCallId} inv={seg.inv} serviceUrl={serviceUrl} />
        )
      )}
    </div>
  );
}

// ─── User message bubble ──────────────────────────────────────────────────────

function UserBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'flex-end',
      marginBottom: 14,
      animation: 'fadeIn 0.2s ease',
    }}>
      <div style={{
        maxWidth: '84%',
        padding: '9px 13px',
        borderRadius: '16px 16px 4px 16px',
        background: 'var(--accent)',
        color: '#fff',
        boxShadow: 'var(--shadow-sm)',
        wordBreak: 'break-word',
      }}>
        <Markdown content={msg.content} isUser={true} />
      </div>
    </div>
  );
}

// ─── Skills popover ───────────────────────────────────────────────────────────

function SkillsPopover({ skills, activeIds, onToggle, disabled }: {
  skills: Skill[];
  activeIds: string[];
  onToggle: (id: string) => void;
  disabled: boolean;
}) {
  if (skills.length === 0) return null;
  const activeCount = activeIds.length;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          title="Agent skills"
          disabled={disabled}
          style={{
            background: activeCount > 0 ? 'rgba(79,70,229,0.1)' : 'none',
            border: `1px solid ${activeCount > 0 ? 'rgba(79,70,229,0.4)' : 'var(--border)'}`,
            borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
            fontSize: 14, color: activeCount > 0 ? 'var(--accent)' : 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <Target size={14} /> <span style={{ fontSize: 12 }}>Skills{activeCount > 0 ? ` · ${activeCount}` : ''}</span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={8} style={{
          width: 260, background: 'var(--bg-secondary)',
          border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.24)', zIndex: 1000,
        }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Agent Skills</span>
            <Popover.Close asChild>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', padding: 2 }}><X size={14} /></button>
            </Popover.Close>
          </div>
          <div style={{ padding: '6px 8px' }}>
            {skills.map(skill => {
              const active = activeIds.includes(skill.id);
              return (
                <button
                  key={skill.id}
                  onClick={() => onToggle(skill.id)}
                  title={skill.description}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', borderRadius: 7, border: 'none',
                    background: active ? 'rgba(79,70,229,0.1)' : 'transparent',
                    cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                    transition: 'background 0.12s',
                  }}
                >
                  <span style={{ fontSize: 15, flexShrink: 0 }}>{skill.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: active ? 600 : 500, color: active ? 'var(--accent)' : 'var(--text-primary)' }}>{skill.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.description}</div>
                  </div>
                  {active && <Check size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
          <Popover.Arrow style={{ fill: 'var(--border)' }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Skeleton loading ─────────────────────────────────────────────────────────

function SkeletonMessage() {
  const shimmer: React.CSSProperties = {
    background: 'linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-active) 50%, var(--bg-surface) 75%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.4s infinite',
    borderRadius: 6,
    height: 13,
    marginBottom: 8,
  };
  return (
    <div style={{ marginBottom: 16, paddingTop: 4 }}>
      <div style={{ ...shimmer, width: '80%' }} />
      <div style={{ ...shimmer, width: '60%' }} />
      <div style={{ ...shimmer, width: '40%', marginBottom: 0 }} />
    </div>
  );
}

// ─── History panel ────────────────────────────────────────────────────────────

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} giờ trước`;
  const days = Math.floor(hrs / 24);
  return `${days} ngày trước`;
}

function HistoryPanel({ sessions, currentId, onLoad, onDelete, onClose }: {
  sessions: ChatSession[];
  currentId: string;
  onLoad: (s: ChatSession) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 100,
      background: 'var(--bg-base)', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)',
      }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0 4px', display: 'flex', alignItems: 'center' }}><ArrowLeft size={16} /></button>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>Lịch sử chat</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sorted.length} phiên</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {sorted.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 24 }}>
            Chưa có phiên chat nào được lưu
          </div>
        )}
        {sorted.map(s => {
          const isCurrent = s.id === currentId;
          return (
            <div
              key={s.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', cursor: 'pointer',
                background: isCurrent ? 'rgba(79,70,229,0.08)' : 'transparent',
                borderLeft: isCurrent ? '3px solid var(--accent)' : '3px solid transparent',
                transition: 'background 0.12s',
              }}
              onClick={() => onLoad(s)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: isCurrent ? 600 : 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.title}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  {s.messages.length} tin · {formatRelativeTime(s.updatedAt)}
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onDelete(s.id); }}
                title="Xoá phiên"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 4px', borderRadius: 4, flexShrink: 0, opacity: 0.6, display: 'flex', alignItems: 'center' }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Send button ──────────────────────────────────────────────────────────────

function SendButton({ input, onSend }: { input: string; onSend: () => void }) {
  const [hovered, setHovered] = React.useState(false);
  const active = input.trim().length > 0;
  return (
    <button
      onClick={onSend}
      disabled={!active}
      title="Send (Enter)"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
        border: active ? '1px solid transparent' : '1px solid transparent',
        background: active && hovered ? 'var(--accent)' : active ? 'rgba(79,70,229,0.12)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        cursor: active ? 'pointer' : 'default',
        fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      <ArrowUp size={15} style={{ color: active && hovered ? 'white' : undefined, transition: 'color 0.15s' }} />
    </button>
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
  const { messages, conversationId, currentSessionId, isLoading, streamError, activeSkills, addMessage, updateLastAssistant, setLoading, setError, newSession, loadSession, toggleSkill } = useChatStore();
  const [input, setInput] = useState('');
  const [serviceUrl, setServiceUrl] = useState(DEFAULT_AGENT_SERVICE_URL);
  const [online, setOnline] = useState<boolean | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [activeModelId, setActiveModelId] = useState('');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [disabledSkillIds, setDisabledSkillIds] = useState<string[]>([]);
  const [disabledExternalTools, setDisabledExternalTools] = useState<string[]>([]);
  const [customSkills, setCustomSkills] = useState<CustomSkill[]>([]);
  const [isWaitingFirstChunk, setIsWaitingFirstChunk] = useState(false);
  const [sentHistory, setSentHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [isMultiline, setIsMultiline] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getAgentServiceConfig().then(cfg => {
      setServiceUrl(cfg.url);
      setAgentToken(cfg.token); // ensure module-level cache is fresh
      checkAgentServiceHealth(cfg.url).then(ok => setOnline(ok));
      Promise.all([
        listModelsForConfiguredProvider(cfg.url),
        fetchProviderConfig(cfg.url),
      ]).then(([list, serverCfg]) => {
        setModels(list);
        chrome.storage.sync.get(['agentProviderConfig'], result => {
          const saved = result.agentProviderConfig;
          const savedId = saved?.modelId || saved?.model;
          // Priority: saved local match → server env default → first in list
          const match = list.find(m => m.id === savedId)
            ?? list.find(m => m.id === serverCfg?.model);
          setActiveModelId(match?.id ?? list[0]?.id ?? serverCfg?.model ?? '');
        });
      });
      // Load skills + custom skills + saved activeSkills together, then validate
      Promise.all([
        fetchSkills(cfg.url),
        loadCustomSkills(),
        new Promise<string[]>(res => chrome.storage.local.get(['activeSkills'], r => res(Array.isArray(r.activeSkills) ? r.activeSkills : []))),
      ]).then(([builtinSkills, customSkillList, savedActive]) => {
        setSkills(builtinSkills);
        setCustomSkills(customSkillList);
        // Only restore IDs that still exist
        const validIds = new Set([...builtinSkills.map(s => s.id), ...customSkillList.map(s => s.id)]);
        const validActive = savedActive.filter(id => validIds.has(id));
        if (validActive.length !== savedActive.length) {
          chrome.storage.local.set({ activeSkills: validActive });
        }
        validActive.forEach((id: string) => {
          if (!useChatStore.getState().activeSkills.includes(id)) toggleSkill(id);
        });
      });
    });
    loadDisabledSkills().then(setDisabledSkillIds);
    chrome.storage.sync.get('disabledExternalMcpTools', r => {
      setDisabledExternalTools(Array.isArray(r.disabledExternalMcpTools) ? r.disabledExternalMcpTools : []);
    });

    // Sync skill settings changed from options page
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.disabledSkills)           setDisabledSkillIds(changes.disabledSkills.newValue ?? []);
      if (changes.customSkills)             setCustomSkills(changes.customSkills.newValue ?? []);
      if (changes.activeSkills) {
        const next: string[] = changes.activeSkills.newValue ?? [];
        // Sync Zustand: toggle any IDs that differ from current state
        const cur = useChatStore.getState().activeSkills;
        cur.filter((id: string) => !next.includes(id)).forEach((id: string) => toggleSkill(id));
        next.filter((id: string) => !cur.includes(id)).forEach((id: string) => toggleSkill(id));
      }
      if (changes.customMcpServers)         doPushMcp();
      if (changes.disabledExternalMcpTools) setDisabledExternalTools(changes.disabledExternalMcpTools.newValue ?? []);
      if (changes.agentProviderConfig) {
        const cfg = changes.agentProviderConfig.newValue;
        const newId = cfg?.modelId || cfg?.model;
        if (newId) setActiveModelId(newId);
      }
    };
    chrome.storage.sync.onChanged.addListener(onStorageChanged);
    chrome.storage.local.onChanged.addListener(onStorageChanged);

    // Restore sent message history
    chrome.storage.local.get(['chatSentHistory'], r => {
      if (Array.isArray(r.chatSentHistory)) setSentHistory(r.chatSentHistory);
    });

    // Load session history
    loadSessionsFromStorage().then(setSessions);

    // Push external MCP servers + memory config to agent-service on mount
    const doPushMcp = async () => {
      const cfg = await getAgentServiceConfig();
      const mcpServers = await loadCustomMcpServers();
      pushExternalMcpServers(cfg.url, mcpServers);
      chrome.storage.sync.get(['memoryMaxEntries'], r => {
        if (r.memoryMaxEntries) pushMemoryConfig(cfg.url, r.memoryMaxEntries);
      });
    };
    doPushMcp();

    return () => {
      chrome.storage.sync.onChanged.removeListener(onStorageChanged);
      chrome.storage.local.onChanged.removeListener(onStorageChanged);
    };
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
    addMessage({ id: assistantId, role: 'assistant', content: '', segments: [] });
    setInput('');
    setIsMultiline(false);
    setHistoryIdx(-1);
    setSentHistory(prev => {
      const next = [text, ...prev.filter(s => s !== text)].slice(0, 50);
      chrome.storage.local.set({ chatSentHistory: next });
      return next;
    });
    setLoading(true);
    setIsWaitingFirstChunk(true);
    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }

    abortRef.current = new AbortController();

    // Snapshot messages BEFORE adding user turn (store is async)
    const historyForRequest = messages.map(m => ({ role: m.role, content: m.content }));
    historyForRequest.push({ role: 'user', content: text });

    try {
      const chatBody = { messages: historyForRequest, conversationId, activeSkills, customSkills: customSkills.filter(s => activeSkills.includes(s.id)), ...(disabledExternalTools.length ? { disabledTools: disabledExternalTools } : {}) };

      const { getAuthHeaders } = await import('../lib/agentServiceClient');
      let res = await fetch(`${serviceUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(chatBody),
        signal: abortRef.current.signal,
      });

      // Service restarted and lost provider config — re-push from storage and retry once
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'provider_not_configured') {
          const repushed = await repushProviderConfig(serviceUrl);
          if (repushed) {
            res = await fetch(`${serviceUrl}/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
              body: JSON.stringify(chatBody),
              signal: abortRef.current?.signal,
            });
          }
        }
      }

      if (!res.ok || !res.body) throw new Error(`Server error: ${res.status}`);

      if (res.headers.get('X-Context-Compressed') === 'true') {
        updateLastAssistant(m => ({
          ...m,
          segments: [{ type: 'text', content: '> 🗜 **Context đã được nén** — lịch sử hội thoại cũ đã được tóm tắt để tiết kiệm context window.\n\n' }],
        }));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // Ordered segments — text segments are coalesced, tools appear in arrival order
      const segments: MessageSegment[] = [];
      // toolCallId → index in segments array for in-place result updates
      const toolSegIdx = new Map<string, number>();

      const flush = () => {
        const content = segments
          .filter((s): s is { type: 'text'; content: string } => s.type === 'text')
          .map(s => s.content)
          .join('');
        updateLastAssistant(m => ({ ...m, content, segments: [...segments] }));
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
            setIsWaitingFirstChunk(false);
            const last = segments[segments.length - 1];
            if (last?.type === 'text') {
              (last as { type: 'text'; content: string }).content += chunk.data;
            } else {
              segments.push({ type: 'text', content: chunk.data });
            }
            flush();
          } else if (chunk.type === 'tool-call') {
            setIsWaitingFirstChunk(false);
            const tc = chunk.data as { toolCallId: string; toolName: string; args: unknown };
            const inv: ToolInvocation = { toolCallId: tc.toolCallId, toolName: tc.toolName, state: 'call', args: tc.args };
            toolSegIdx.set(tc.toolCallId, segments.length);
            segments.push({ type: 'tool', inv });
            flush();
          } else if (chunk.type === 'tool-result') {
            const tr = chunk.data as { toolCallId: string; result: unknown };
            const idx = toolSegIdx.get(tr.toolCallId);
            if (idx !== undefined) {
              const seg = segments[idx] as { type: 'tool'; inv: ToolInvocation };
              segments[idx] = { type: 'tool', inv: { ...seg.inv, state: 'result', result: tr.result } };
              flush();
            }
          } else if (chunk.type === 'finish') {
            const finish = chunk.data as { finishReason?: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } };
            console.log('[stream] finish reason:', finish.finishReason, '| tokens:', finish.usage);
            if (finish.finishReason === 'length') {
              console.warn('[stream] Context limit hit — response was cut off');
              updateLastAssistant(m => {
                const warnSeg: MessageSegment = { type: 'text', content: '\n\n> ⚠️ **Context limit reached** — phản hồi bị cắt do context window đầy. Hãy bắt đầu cuộc trò chuyện mới.' };
                const segs = m.segments?.length ? m.segments : [];
                return { ...m, segments: [...segs, warnSeg] };
              });
            } else if (finish.finishReason === 'tool-calls') {
              console.warn('[stream] Stopped mid-task — agent ran out of steps');
              updateLastAssistant(m => {
                const warnSeg: MessageSegment = { type: 'text', content: '\n\n> ⚠️ **Agent dừng giữa chừng** — đã đạt giới hạn số bước. Hãy thử lại hoặc chia nhỏ yêu cầu.' };
                const segs = m.segments?.length ? m.segments : [];
                return { ...m, segments: [...segs, warnSeg] };
              });
            }
          } else if (chunk.type === 'error' && typeof chunk.data === 'string') {
            setError(chunk.data);
            updateLastAssistant(m => {
              const errSeg: MessageSegment = { type: 'text', content: `_(${chunk.data})_` };
              const segs = m.segments?.length ? m.segments : [];
              return { ...m, segments: [...segs, errSeg] };
            });
          }
        }
        // Yield to the browser event loop after each network chunk so React
        // can flush the batched state updates and repaint before the next chunk.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Unknown error');
      updateLastAssistant(m => {
        if (m.content === '' && !m.segments?.length) {
          const errSeg: MessageSegment = { type: 'text', content: '_(error)_' };
          return { ...m, segments: [errSeg] };
        }
        return m;
      });
    } finally {
      setLoading(false);
      setIsWaitingFirstChunk(false);
      abortRef.current = null;
      // Auto-save session after response completes (use store snapshot via getter)
      const { messages: finalMsgs, conversationId: finalConvId, currentSessionId: finalSessionId } = useChatStore.getState();
      if (finalMsgs.length > 0) {
        const session: ChatSession = {
          id: finalSessionId,
          title: sessionTitle(finalMsgs),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: finalMsgs,
          conversationId: finalConvId,
        };
        setSessions(prev => {
          const existing = prev.find(s => s.id === finalSessionId);
          const updated = upsertSession(prev, { ...session, createdAt: existing?.createdAt ?? session.createdAt });
          saveSessionsToStorage(updated);
          return updated;
        });
      }
    }
  }, [messages, isLoading, serviceUrl, conversationId, activeSkills, customSkills]);

  const switchModel = useCallback((modelId: string) => {
    chrome.storage.sync.get(['agentProviderConfig'], async result => {
      const saved = result.agentProviderConfig ?? {};
      const ok = await pushProviderConfig(serviceUrl, saved.provider || 'openai-compat', saved.apiKey || '', modelId, saved.baseUrl || undefined, saved.toolsSupported ?? false, saved.visionSupported ?? false, saved.embeddingModel);
      if (ok) {
        setActiveModelId(modelId);
        chrome.storage.sync.set({ agentProviderConfig: { ...saved, modelId, model: modelId } });
      }
    });
  }, [serviceUrl]);

  const handleNewChat = useCallback(() => {
    // Save current session before clearing (if it has messages)
    if (messages.length > 0) {
      const session: ChatSession = {
        id: currentSessionId,
        title: sessionTitle(messages),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages,
        conversationId,
      };
      setSessions(prev => {
        const existing = prev.find(s => s.id === currentSessionId);
        const updated = upsertSession(prev, { ...session, createdAt: existing?.createdAt ?? session.createdAt });
        saveSessionsToStorage(updated);
        return updated;
      });
    }
    newSession();
    setShowHistory(false);
  }, [messages, currentSessionId, conversationId, newSession]);

  const handleLoadSession = useCallback((session: ChatSession) => {
    loadSession(session);
    setShowHistory(false);
  }, [loadSession]);

  const handleDeleteSession = useCallback((id: string) => {
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== id);
      saveSessionsToStorage(updated);
      return updated;
    });
    // If deleting current session, start fresh
    if (id === currentSessionId) newSession();
  }, [currentSessionId, newSession]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); return; }
    if (e.key === 'ArrowUp' && sentHistory.length > 0) {
      const next = Math.min(historyIdx + 1, sentHistory.length - 1);
      setHistoryIdx(next);
      setInput(sentHistory[next]);
      e.preventDefault();
    }
    if (e.key === 'ArrowDown' && historyIdx >= 0) {
      const next = historyIdx - 1;
      setHistoryIdx(next);
      setInput(next < 0 ? '' : sentHistory[next]);
      e.preventDefault();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', position: 'relative' }}>

      {/* History overlay */}
      {showHistory && (
        <HistoryPanel
          sessions={sessions}
          currentId={currentSessionId}
          onLoad={handleLoadSession}
          onDelete={handleDeleteSession}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* Status bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px',
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
        fontSize: 11, color: 'var(--text-muted)',
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: online === null ? 'var(--warning)' : online ? 'var(--success)' : 'var(--error)',
        }} />
        <span style={{ flex: 1 }}>agent-service</span>
        <button
          onClick={() => setShowHistory(v => !v)}
          title="Lịch sử chat"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '1px 4px', borderRadius: 4, display: 'flex', alignItems: 'center' }}
        >
          <History size={13} />
        </button>
        <button
          onClick={handleNewChat}
          title="Chat mới"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '1px 4px', borderRadius: 4, display: 'flex', alignItems: 'center' }}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px 8px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 48 }}>
            <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'center' }}><Bot size={40} style={{ color: 'var(--accent)', opacity: 0.7 }} /></div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
              Browser Agent
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, maxWidth: 240, margin: '0 auto' }}>
              Tôi có thể mở tab, điều hướng, đọc trang web và tự động hóa tác vụ của bạn.
            </div>
          </div>
        )}

        {messages.map(m =>
          m.role === 'user'
            ? <UserBubble key={m.id} msg={m} />
            : <AssistantMessage key={m.id} msg={m} serviceUrl={serviceUrl} />
        )}

        {isWaitingFirstChunk && <SkeletonMessage />}
        {isLoading && !isWaitingFirstChunk && messages[messages.length - 1]?.role !== 'assistant' && <TypingDots />}

        {streamError && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginBottom: 10,
            background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)',
            color: 'var(--error)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <AlertTriangle size={13} style={{ flexShrink: 0 }} /> {streamError}
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
        <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center' }}>
          <ToolsPopover />
          <SkillsPopover
            skills={[
              ...skills.filter(s => !disabledSkillIds.includes(s.id)),
              ...customSkills.filter(s => !disabledSkillIds.includes(s.id)),
            ]}
            activeIds={activeSkills}
            onToggle={(id) => {
              toggleSkill(id);
              const next = activeSkills.includes(id)
                ? activeSkills.filter(x => x !== id)
                : [...activeSkills, id];
              chrome.storage.local.set({ activeSkills: next });
            }}
            disabled={isLoading}
          />
          {/* Model selector */}
          {models.length > 0 && (() => {
            const CHAT_TYPES = new Set(['chat', 'messages', 'responses', 'generateContent']);
            const chatModels = models.filter(m =>
              (!m.model_type || CHAT_TYPES.has(m.model_type)) &&
              (!m.status || m.status === 'enabled')
            );
            const opts = chatModels.length > 0 ? chatModels : models.filter(m => !m.status || m.status === 'enabled');
            return (
              <select
                value={activeModelId}
                onChange={e => switchModel(e.target.value)}
                disabled={isLoading}
                title="Chọn model"
                style={{
                  marginLeft: 'auto',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '3px 6px',
                  fontSize: 12, color: 'var(--text-secondary)',
                  fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
                  maxWidth: 160,
                }}
              >
                {opts.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
              </select>
            );
          })()}
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
              padding: 0, margin: 0, display: 'block', opacity: isLoading ? 0.7 : 1,
              alignSelf: isMultiline ? 'flex-start' : 'center',
            }}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              const newHeight = Math.min(el.scrollHeight, 120);
              el.style.height = newHeight + 'px';
              setIsMultiline(el.scrollHeight > el.clientHeight || el.value.includes('\n'));
            }}
          />
          {isLoading ? (
            <button
              onClick={() => { abortRef.current?.abort(); setLoading(false); }}
              title="Stop"
              style={{
                width: 30, height: 30, borderRadius: 8, border: 'none',
                background: 'var(--error)', color: 'white',
                cursor: 'pointer', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            ><Square size={13} fill="white" /></button>
          ) : (
            <SendButton input={input} onSend={() => sendMessage(input)} />
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5, textAlign: 'center' }}>
          Enter gửi · Shift+Enter xuống dòng
        </div>
      </div>
    </div>
  );
}
