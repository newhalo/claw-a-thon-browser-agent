import React, { useEffect, useState } from 'react';
import {
  getAgentServiceConfig, checkAgentServiceHealthFull,
  pushProviderConfig, pushNativeConfigToAgentService, pushSystemPrompt,
  fetchModels, fetchSkills, fetchSkillFromUrl,
  loadCustomSkills, saveCustomSkills, loadDisabledSkills, saveDisabledSkills,
  loadCustomMcpServers, saveCustomMcpServers, pushExternalMcpServers, parseMcpConfigJson, testMcpServer,
  type PredefinedModel, type Skill, type CustomSkill, type CustomMcpServer,
} from '../sidepanel/lib/agentServiceClient';

type Tab = 'general' | 'provider' | 'skills' | 'mcp' | 'security';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'general',  label: 'General',  icon: '⚙️' },
  { id: 'provider', label: 'Provider', icon: '🤖' },
  { id: 'skills',   label: 'Skills',   icon: '🎯' },
  { id: 'mcp',      label: 'MCP',      icon: '🔌' },
  { id: 'security', label: 'Security', icon: '🔑' },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function Msg({ msg }: { msg: { type: 'success' | 'error'; text: string } | null }) {
  if (!msg) return null;
  return (
    <div style={{
      marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: 12,
      background: msg.type === 'error' ? 'rgba(239,68,68,0.07)' : 'rgba(16,185,129,0.07)',
      border: `1px solid ${msg.type === 'error' ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
      color: msg.type === 'error' ? '#ef4444' : '#10b981',
    }}>{msg.text}</div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: '#1a1a2e' }}>{children}</h2>;
}

function Divider() {
  return <div style={{ borderTop: '1px solid #e5e7eb', margin: '24px 0' }} />;
}

function Label({ children }: { children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 5 }}>{children}</label>;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 11px', border: '1px solid #e5e7eb', borderRadius: 8,
  fontSize: 13, background: '#fff', color: '#1a1a2e', fontFamily: 'inherit',
  outline: 'none',
};

const btnStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', border: '1px solid #4f46e5', background: '#4f46e5', color: '#fff',
};

const btnSecStyle: React.CSSProperties = {
  ...btnStyle, background: 'transparent', color: '#4f46e5',
};

// ── General tab ───────────────────────────────────────────────────────────────

function GeneralTab() {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [agentUrl, setAgentUrl] = useState('http://localhost:3000');
  const [customPrompt, setCustomPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [promptMsg, setPromptMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, r => {
      setUrl(r?.config?.nativeServerUrl || '');
      setToken(r?.config?.authToken || '');
    });
    getAgentServiceConfig().then(c => setAgentUrl(c.url));
    chrome.storage.sync.get(['agentCustomSystemPrompt'], r => setCustomPrompt(r.agentCustomSystemPrompt || ''));
  }, []);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setMsg(null);
    chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config: { nativeServerUrl: url, authToken: token } }, r => {
      setLoading(false);
      setMsg(r?.success ? { type: 'success', text: '✅ Đã lưu cấu hình!' } : { type: 'error', text: '❌ Lưu thất bại' });
    });
  };

  const test = () => {
    setLoading(true); setMsg(null);
    chrome.runtime.sendMessage({ type: 'TEST_CONNECTION', config: { nativeServerUrl: url, authToken: token } }, r => {
      setLoading(false);
      setMsg(r?.success ? { type: 'success', text: '✅ Kết nối thành công!' } : { type: 'error', text: `❌ ${r?.error || 'Kết nối thất bại'}` });
    });
  };

  const saveAgentUrl = () => {
    chrome.storage.sync.set({ agentServiceUrl: agentUrl });
    setMsg({ type: 'success', text: '✅ Đã lưu Agent Service URL' });
  };

  const savePrompt = async () => {
    setPromptSaving(true); setPromptMsg(null);
    try {
      const { url: aUrl } = await getAgentServiceConfig();
      await pushSystemPrompt(aUrl, customPrompt.trim());
      chrome.storage.sync.set({ agentCustomSystemPrompt: customPrompt.trim() });
      setPromptMsg({ type: 'success', text: '✅ Đã lưu!' });
    } catch {
      setPromptMsg({ type: 'error', text: '❌ Lưu thất bại' });
    } finally {
      setPromptSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle>Native Server</SectionTitle>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <Label>Server URL</Label>
          <input style={inputStyle} type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="http://localhost:8080" required />
        </div>
        <div>
          <Label>Auth Token</Label>
          <input style={inputStyle} type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="your-strong-token-here" required />
        </div>
        <Msg msg={msg} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={test} disabled={!url || !token || loading} style={btnSecStyle}>🔗 Test</button>
          <button type="submit" disabled={!url || !token || loading} style={btnStyle}>{loading ? 'Saving…' : '💾 Save'}</button>
        </div>
      </form>

      <Divider />

      <SectionTitle>Agent Service</SectionTitle>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Label>Service URL</Label>
          <input style={inputStyle} type="url" value={agentUrl} onChange={e => setAgentUrl(e.target.value)} placeholder="http://localhost:3000" />
        </div>
        <button onClick={saveAgentUrl} style={btnStyle}>Save</button>
      </div>

      <Divider />

      <SectionTitle>Custom Instructions</SectionTitle>
      <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10, lineHeight: 1.6 }}>
        Append thêm hướng dẫn riêng vào system prompt mặc định.
      </p>
      <textarea
        value={customPrompt}
        onChange={e => setCustomPrompt(e.target.value)}
        placeholder={'Ví dụ: Luôn trả lời bằng tiếng Việt.\nKhi tóm tắt trang, dùng bullet points.'}
        rows={6}
        style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
      />
      <Msg msg={promptMsg} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={savePrompt} disabled={promptSaving} style={btnStyle}>{promptSaving ? 'Đang lưu…' : '💾 Save Instructions'}</button>
        {customPrompt && <button onClick={() => { setCustomPrompt(''); }} style={btnSecStyle}>Xoá</button>}
      </div>
    </div>
  );
}

// ── Provider tab ──────────────────────────────────────────────────────────────

function CapBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
      background: active ? 'rgba(16,185,129,0.1)' : 'rgba(156,163,175,0.1)',
      color: active ? '#10b981' : '#9ca3af',
      border: `1px solid ${active ? 'rgba(16,185,129,0.3)' : 'rgba(156,163,175,0.2)'}`,
    }}>
      {active ? '✓' : '✗'} {label}
    </span>
  );
}

function ProviderTab() {
  const [models, setModels] = useState<PredefinedModel[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<{ configured: boolean; provider?: string | null; model?: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    getAgentServiceConfig().then(({ url }) => {
      fetchModels(url).then(list => {
        setModels(list);
        chrome.storage.sync.get(['agentProviderConfig'], r => {
          const saved = r.agentProviderConfig;
          const id = saved?.modelId || saved?.model;
          const match = list.find(m => m.id === id);
          const def = list.find(m => m.default) ?? list[0];
          setSelectedId(match?.id ?? def?.id ?? '');
          if (saved?.apiKey) setApiKey(saved.apiKey);
        });
      });
      checkAgentServiceHealthFull(url).then(h => { if (h?.provider) setStatus(h.provider); });
    });
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!apiKey.trim()) { setMsg({ type: 'error', text: 'API key là bắt buộc' }); return; }
    const m = models.find(x => x.id === selectedId);
    if (!m) { setMsg({ type: 'error', text: 'Chọn model trước' }); return; }
    setSaving(true);
    try {
      const { url } = await getAgentServiceConfig();
      chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, async r => {
        const cfg = r?.config;
        if (cfg?.nativeServerUrl) await pushNativeConfigToAgentService(url, cfg.nativeServerUrl, cfg.authToken);
      });
      const ok = await pushProviderConfig(url, m.provider, apiKey.trim(), m.id, m.baseUrl, m.toolsSupported, m.visionSupported);
      if (!ok) { setMsg({ type: 'error', text: 'Agent service không phản hồi' }); return; }
      chrome.storage.sync.set({ agentProviderConfig: { modelId: m.id, provider: m.provider, apiKey: apiKey.trim(), model: m.id, baseUrl: m.baseUrl ?? '', toolsSupported: m.toolsSupported, visionSupported: m.visionSupported } });
      setStatus({ configured: true, provider: m.provider, model: m.id });
      setMsg({ type: 'success', text: '✅ Provider đã cập nhật!' });
    } finally { setSaving(false); }
  };

  const selected = models.find(m => m.id === selectedId);
  const categories = Array.from(new Set(models.map(m => m.category)));

  return (
    <div>
      <SectionTitle>LLM Provider</SectionTitle>

      {status && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 20,
          background: status.configured ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.07)',
          border: `1px solid ${status.configured ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
          color: status.configured ? '#10b981' : '#ef4444',
        }}>
          {status.configured ? `✓ Active: ${status.model || status.provider}` : '⚠️ Chưa cấu hình provider'}
        </div>
      )}

      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Label>Model</Label>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{ ...inputStyle }}>
            {categories.map(cat => (
              <optgroup key={cat} label={cat}>
                {models.filter(m => m.category === cat).map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {selected && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <CapBadge label="Tools" active={selected.toolsSupported} />
              <CapBadge label="Vision" active={selected.visionSupported} />
            </div>
          )}
        </div>
        <div>
          <Label>API Key</Label>
          <input style={inputStyle} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="your-api-key" autoComplete="off" />
        </div>
        <Msg msg={msg} />
        <div>
          <button type="submit" disabled={saving || !apiKey.trim()} style={btnStyle}>{saving ? 'Đang lưu…' : '💾 Save Provider'}</button>
        </div>
      </form>
    </div>
  );
}

// ── Skills tab ────────────────────────────────────────────────────────────────

type SkillFormMode = 'none' | 'url' | 'create';

function SkillRow({ icon, name, subtitle, disabled, onToggle, onDelete }: {
  icon: string; name: string; subtitle: string;
  disabled: boolean; onToggle: () => void; onDelete?: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #e5e7eb' }}>
      <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: disabled ? '#9ca3af' : '#1a1a2e' }}>{name}</div>
        <div style={{ fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>
      </div>
      <button onClick={onToggle} style={{
        flexShrink: 0, fontSize: 11, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontWeight: 600,
        background: disabled ? 'transparent' : 'rgba(16,185,129,0.1)',
        border: `1px solid ${disabled ? '#e5e7eb' : 'rgba(16,185,129,0.3)'}`,
        color: disabled ? '#9ca3af' : '#10b981',
      }}>{disabled ? 'Off' : 'On'}</button>
      {onDelete && (
        <button onClick={onDelete} title="Xoá" style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 6, border: '1px solid #e5e7eb', background: 'transparent', cursor: 'pointer', color: '#9ca3af', fontSize: 13 }}>✕</button>
      )}
    </div>
  );
}

function SkillsTab() {
  const [builtins, setBuiltins] = useState<Skill[]>([]);
  const [customs, setCustoms] = useState<CustomSkill[]>([]);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [mode, setMode] = useState<SkillFormMode>('none');

  // URL form
  const [skillUrl, setSkillUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [urlMsg, setUrlMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create form
  const [form, setForm] = useState({ name: '', description: '', icon: '🔧', category: 'custom', instructions: '' });
  const [createMsg, setCreateMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    getAgentServiceConfig().then(({ url }) => fetchSkills(url).then(setBuiltins));
    loadCustomSkills().then(setCustoms);
    loadDisabledSkills().then(setDisabled);
  }, []);

  const toggle = async (id: string) => {
    const next = disabled.includes(id) ? disabled.filter(x => x !== id) : [...disabled, id];
    setDisabled(next);
    await saveDisabledSkills(next);
  };

  const deleteCustom = async (id: string) => {
    const next = customs.filter(s => s.id !== id);
    setCustoms(next);
    await saveCustomSkills(next);
    const nd = disabled.filter(x => x !== id);
    setDisabled(nd);
    await saveDisabledSkills(nd);
  };

  const addFromUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setUrlMsg(null);
    if (!skillUrl.trim()) return;
    setFetching(true);
    try {
      const skill = await fetchSkillFromUrl(skillUrl.trim());
      if (customs.find(s => s.id === skill.id)) { setUrlMsg({ type: 'error', text: 'Skill này đã được thêm' }); return; }
      const next = [...customs, { ...skill, addedAt: Date.now() }];
      setCustoms(next);
      await saveCustomSkills(next);
      setSkillUrl('');
      setUrlMsg({ type: 'success', text: `✅ Đã thêm "${skill.name}"${skill.hasScripts ? ' · ⚠️ Skill có scripts/ — không chạy được trong browser' : ''}` });
      setMode('none');
    } catch (err) {
      setUrlMsg({ type: 'error', text: `❌ ${err instanceof Error ? err.message : 'Không tải được SKILL.md'}` });
    } finally { setFetching(false); }
  };

  const createManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateMsg(null);
    if (!form.name.trim() || !form.instructions.trim()) {
      setCreateMsg({ type: 'error', text: 'Name và Instructions là bắt buộc' }); return;
    }
    const id = `custom-manual-${form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now()}`;
    if (customs.find(s => s.id === id)) { setCreateMsg({ type: 'error', text: 'Đã tồn tại skill tên này' }); return; }
    const skill: CustomSkill = {
      id, name: form.name.trim(), description: form.description.trim(),
      icon: form.icon || '🔧', category: form.category || 'custom',
      systemPrompt: form.instructions.trim(), sourceUrl: 'manual',
      hasScripts: false, addedAt: Date.now(),
    };
    const next = [...customs, skill];
    setCustoms(next);
    await saveCustomSkills(next);
    setForm({ name: '', description: '', icon: '🔧', category: 'custom', instructions: '' });
    setCreateMsg({ type: 'success', text: `✅ Đã tạo skill "${skill.name}"` });
    setMode('none');
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <SectionTitle>Agent Skills</SectionTitle>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setMode(mode === 'url' ? 'none' : 'url')} style={{ ...btnSecStyle, fontSize: 12, padding: '6px 12px' }}>
            + Từ URL
          </button>
          <button onClick={() => setMode(mode === 'create' ? 'none' : 'create')} style={{ ...btnStyle, fontSize: 12, padding: '6px 12px' }}>
            + Tạo mới
          </button>
        </div>
      </div>

      {/* Add from URL form */}
      {mode === 'url' && (
        <div style={{ background: '#f8f9fa', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Thêm skill từ URL</div>
          <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10, lineHeight: 1.6 }}>
            Hỗ trợ: <strong>skills.sh</strong> URL, GitHub directory, hoặc raw link đến <code>SKILL.md</code>.
            Tự động fetch cả thư mục <code>references/</code> nếu có.
          </p>
          <p style={{ fontSize: 11, color: '#f59e0b', marginBottom: 10 }}>
            ⚠️ Nếu skill có thư mục <code>scripts/</code>, các script sẽ không thể thực thi trong browser extension.
          </p>
          <form onSubmit={addFromUrl} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              style={inputStyle} type="url" value={skillUrl}
              onChange={e => { setSkillUrl(e.target.value); setUrlMsg(null); }}
              placeholder="https://www.skills.sh/owner/repo/skill-name"
            />
            <Msg msg={urlMsg} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="submit" disabled={fetching || !skillUrl.trim()} style={btnStyle}>{fetching ? 'Đang tải…' : 'Thêm'}</button>
              <button type="button" onClick={() => { setMode('none'); setUrlMsg(null); setSkillUrl(''); }} style={btnSecStyle}>Huỷ</button>
            </div>
          </form>
        </div>
      )}

      {/* Create manual form */}
      {mode === 'create' && (
        <div style={{ background: '#f8f9fa', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Tạo skill mới</div>
          <form onSubmit={createManual} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr', gap: 8 }}>
              <div>
                <Label>Icon</Label>
                <input style={{ ...inputStyle, textAlign: 'center', fontSize: 18 }} value={form.icon}
                  onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} maxLength={2} />
              </div>
              <div>
                <Label>Name *</Label>
                <input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Skill" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <input style={inputStyle} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Mô tả ngắn — agent dùng để biết khi nào activate skill này" />
            </div>
            <div>
              <Label>Category</Label>
              <select style={inputStyle} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <option value="custom">custom</option>
                <option value="work">work</option>
                <option value="research">research</option>
                <option value="productivity">productivity</option>
                <option value="dev">dev</option>
              </select>
            </div>
            <div>
              <Label>Instructions * (Markdown)</Label>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
                rows={8}
                value={form.instructions}
                onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                placeholder={'Mô tả cách agent nên hành động khi skill này được bật.\n\nVí dụ:\nKhi user yêu cầu tạo báo cáo:\n1. Navigate đến tool.company.com/reports\n2. Điền các trường: ...\n3. Xác nhận với user trước khi submit'}
              />
            </div>
            <Msg msg={createMsg} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="submit" style={btnStyle}>Tạo skill</button>
              <button type="button" onClick={() => { setMode('none'); setCreateMsg(null); }} style={btnSecStyle}>Huỷ</button>
            </div>
          </form>
        </div>
      )}

      {/* Built-in skills */}
      {builtins.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Built-in</div>
          {builtins.map(s => (
            <SkillRow key={s.id} icon={s.icon} name={s.name} subtitle={s.description}
              disabled={disabled.includes(s.id)} onToggle={() => toggle(s.id)} />
          ))}
        </div>
      )}

      {/* Custom skills */}
      {customs.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Custom</div>
          {customs.map(s => (
            <div key={s.id}>
              <SkillRow
                icon={s.icon} name={s.name}
                subtitle={s.sourceUrl === 'manual' ? `Tạo thủ công · ${s.category}` : s.sourceUrl}
                disabled={disabled.includes(s.id)}
                onToggle={() => toggle(s.id)}
                onDelete={() => deleteCustom(s.id)}
              />
              {s.hasScripts && (
                <div style={{ fontSize: 11, color: '#f59e0b', padding: '3px 0 6px 34px' }}>
                  ⚠️ Skill này có <code>scripts/</code> — không thể chạy script trong browser extension
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {builtins.length === 0 && customs.length === 0 && (
        <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, padding: '40px 0' }}>
          Chưa có skill nào. Thêm từ URL hoặc tạo mới.
        </div>
      )}
    </div>
  );
}

// ── MCP tab ───────────────────────────────────────────────────────────────────

type McpStatus = 'idle' | 'testing' | 'ok' | 'error';
type AddMode = 'none' | 'paste' | 'manual';

function StatusBadge({ status }: { status: McpStatus }) {
  const map: Record<McpStatus, { bg: string; color: string; border: string; label: string }> = {
    idle:    { bg: 'rgba(156,163,175,0.1)', color: '#9ca3af', border: 'rgba(156,163,175,0.2)', label: '—' },
    testing: { bg: 'rgba(245,158,11,0.1)',  color: '#f59e0b', border: 'rgba(245,158,11,0.25)', label: 'Testing…' },
    ok:      { bg: 'rgba(16,185,129,0.1)',  color: '#10b981', border: 'rgba(16,185,129,0.25)', label: 'Connected' },
    error:   { bg: 'rgba(239,68,68,0.07)',  color: '#ef4444', border: 'rgba(239,68,68,0.25)', label: 'Error' },
  };
  const s = map[status];
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {s.label}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const isStdio = type === 'stdio';
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 6,
      background: isStdio ? 'rgba(245,158,11,0.1)' : 'rgba(79,70,229,0.08)',
      color: isStdio ? '#d97706' : '#4f46e5',
      border: `1px solid ${isStdio ? 'rgba(245,158,11,0.3)' : 'rgba(79,70,229,0.2)'}`,
    }}>
      {type}
    </span>
  );
}

function HeadersEditor({ headers, onChange }: {
  headers: Record<string, string>;
  onChange: (h: Record<string, string>) => void;
}) {
  const entries = Object.entries(headers);
  const update = (idx: number, key: string, val: string) => {
    const next = [...entries];
    next[idx] = [key, val];
    onChange(Object.fromEntries(next.filter(([k]) => k)));
  };
  const remove = (idx: number) => {
    const next = entries.filter((_, i) => i !== idx);
    onChange(Object.fromEntries(next));
  };
  const add = () => onChange({ ...headers, '': '' });

  return (
    <div>
      {entries.map(([k, v], i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            style={{ ...inputStyle, flex: '0 0 160px', fontFamily: 'monospace', fontSize: 12 }}
            value={k} placeholder="Header name"
            onChange={e => update(i, e.target.value, v)}
          />
          <input
            style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', fontSize: 12 }}
            value={v} placeholder="value or ${input:var}"
            onChange={e => update(i, k, e.target.value)}
          />
          <button type="button" onClick={() => remove(i)} style={{ flexShrink: 0, width: 28, height: 34, borderRadius: 6, border: '1px solid #e5e7eb', background: 'transparent', cursor: 'pointer', color: '#9ca3af', fontSize: 13 }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={add} style={{ ...btnSecStyle, fontSize: 11, padding: '4px 10px' }}>+ Add header</button>
    </div>
  );
}

const BLANK_MANUAL = { name: '', type: 'http' as CustomMcpServer['type'], url: '', headers: {} as Record<string, string>, description: '' };

function McpTab() {
  const [servers, setServers] = useState<CustomMcpServer[]>([]);
  const [addMode, setAddMode] = useState<AddMode>('none');
  const [pasteJson, setPasteJson] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [parsedPaste, setParsedPaste] = useState<Omit<CustomMcpServer, 'id' | 'enabled'>[]>([]);
  const [manual, setManual] = useState(BLANK_MANUAL);
  const [statuses, setStatuses] = useState<Record<string, McpStatus>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pushing, setPushing] = useState(false);

  useEffect(() => { loadCustomMcpServers().then(setServers); }, []);

  const persist = async (next: CustomMcpServer[]) => { setServers(next); await saveCustomMcpServers(next); };

  const testServer = async (server: CustomMcpServer) => {
    if (!server.url) return;
    setStatuses(p => ({ ...p, [server.id]: 'testing' }));
    setTestErrors(p => { const n = { ...p }; delete n[server.id]; return n; });
    const { url: agentUrl } = await getAgentServiceConfig();
    const result = await testMcpServer(agentUrl, server.url, server.headers);
    setStatuses(p => ({ ...p, [server.id]: result.ok ? 'ok' : 'error' }));
    if (!result.ok) {
      const detail = result.error
        ?? `HTTP ${result.status} ${result.statusText}${result.body ? ` — ${result.body.slice(0, 120)}` : ''}`;
      setTestErrors(p => ({ ...p, [server.id]: detail }));
    }
  };

  const pushAll = async () => {
    setPushing(true); setMsg(null);
    const { url } = await getAgentServiceConfig();
    const ok = await pushExternalMcpServers(url, servers);
    setMsg(ok ? { type: 'success', text: '✅ Đã đẩy config lên agent-service' } : { type: 'error', text: '❌ Không thể kết nối agent-service' });
    setPushing(false);
  };

  const onPasteChange = (raw: string) => {
    setPasteJson(raw);
    setPasteError('');
    setParsedPaste([]);
    if (!raw.trim()) return;
    try {
      const parsed = parseMcpConfigJson(raw);
      if (parsed.length === 0) { setPasteError('Không tìm thấy server nào trong JSON'); return; }
      setParsedPaste(parsed);
    } catch (e) {
      setPasteError(`JSON không hợp lệ: ${(e as Error).message}`);
    }
  };

  const importParsed = async () => {
    const toAdd: CustomMcpServer[] = parsedPaste.map(p => ({
      ...p, id: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, enabled: true,
    }));
    const next = [...servers, ...toAdd];
    await persist(next);
    setPasteJson(''); setParsedPaste([]); setAddMode('none');
    setMsg({ type: 'success', text: `✅ Đã thêm ${toAdd.length} server` });
    toAdd.forEach(s => testServer(s));
  };

  const addManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manual.name.trim()) return;
    const server: CustomMcpServer = {
      id: `ext-${Date.now()}`, enabled: true,
      name: manual.name.trim(),
      type: manual.type,
      url: manual.url.trim() || undefined,
      headers: Object.keys(manual.headers).length > 0 ? manual.headers : undefined,
      description: manual.description.trim() || undefined,
    };
    const next = [...servers, server];
    await persist(next);
    setManual(BLANK_MANUAL);
    setAddMode('none');
    if (server.url) testServer(server);
  };

  const toggle = async (id: string) => persist(servers.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  const remove = async (id: string) => {
    await persist(servers.filter(s => s.id !== id));
    setStatuses(p => { const n = { ...p }; delete n[id]; return n; });
  };

  const closeAdd = () => { setAddMode('none'); setPasteJson(''); setParsedPaste([]); setPasteError(''); setManual(BLANK_MANUAL); };

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <SectionTitle>External MCP Servers</SectionTitle>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={pushAll} disabled={pushing || servers.length === 0} style={{ ...btnSecStyle, fontSize: 12, padding: '6px 12px' }}>
            {pushing ? 'Pushing…' : '↑ Push to agent'}
          </button>
          {addMode === 'none' ? (
            <>
              <button onClick={() => setAddMode('paste')} style={{ ...btnSecStyle, fontSize: 12, padding: '6px 12px' }}>📋 Paste JSON</button>
              <button onClick={() => setAddMode('manual')} style={{ ...btnStyle, fontSize: 12, padding: '6px 12px' }}>+ Manual</button>
            </>
          ) : (
            <button onClick={closeAdd} style={{ ...btnSecStyle, fontSize: 12, padding: '6px 12px' }}>Huỷ</button>
          )}
        </div>
      </div>
      <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 20, lineHeight: 1.6 }}>
        Kết nối thêm MCP server ngoài native-server. Hỗ trợ format JSON của Cursor/Claude/VS Code.
      </p>

      {/* Paste JSON */}
      {addMode === 'paste' && (
        <div style={{ background: '#f8f9fa', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Paste MCP config JSON</div>
          <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10, lineHeight: 1.6 }}>
            Hỗ trợ format <code>mcpServers</code> của Cursor/Claude, hoặc paste trực tiếp một server object.
          </p>
          <textarea
            value={pasteJson}
            onChange={e => onPasteChange(e.target.value)}
            rows={8}
            placeholder={`// Ví dụ — paste từ Cursor/Claude config:\n{\n  "n8n-mcp": {\n    "type": "http",\n    "url": "https://example.com/mcp",\n    "headers": {\n      "Authorization": "Bearer your-token"\n    }\n  }\n}`}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5 }}
          />
          {pasteError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>⚠️ {pasteError}</div>}
          {parsedPaste.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                Sẽ thêm {parsedPaste.length} server:
              </div>
              {parsedPaste.map((p, i) => (
                <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#fff', border: '1px solid #e5e7eb', marginBottom: 6, fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{p.name || '(unnamed)'}</span>
                  {' '}<TypeBadge type={p.type} />
                  {p.url && <span style={{ color: '#9ca3af', marginLeft: 8 }}>{p.url}</span>}
                  {p.headers && Object.keys(p.headers).length > 0 && (
                    <span style={{ color: '#9ca3af', marginLeft: 8 }}>🔑 {Object.keys(p.headers).join(', ')}</span>
                  )}
                </div>
              ))}
              <button onClick={importParsed} style={{ ...btnStyle, marginTop: 4 }}>Import {parsedPaste.length} server</button>
            </div>
          )}
        </div>
      )}

      {/* Manual form */}
      {addMode === 'manual' && (
        <div style={{ background: '#f8f9fa', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Thêm MCP server thủ công</div>
          <form onSubmit={addManual} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 8 }}>
              <div>
                <Label>Name *</Label>
                <input style={inputStyle} value={manual.name} onChange={e => setManual(f => ({ ...f, name: e.target.value }))} placeholder="my-mcp-server" required />
              </div>
              <div>
                <Label>Transport type</Label>
                <select style={inputStyle} value={manual.type} onChange={e => setManual(f => ({ ...f, type: e.target.value as CustomMcpServer['type'] }))}>
                  <option value="http">http</option>
                  <option value="streamable-http">streamable-http</option>
                  <option value="sse">sse</option>
                  <option value="stdio">stdio</option>
                </select>
              </div>
            </div>
            {manual.type !== 'stdio' && (
              <div>
                <Label>URL *</Label>
                <input style={inputStyle} type="url" value={manual.url} onChange={e => setManual(f => ({ ...f, url: e.target.value }))} placeholder="https://example.com/mcp" />
              </div>
            )}
            {manual.type !== 'stdio' && (
              <div>
                <Label>Headers</Label>
                <HeadersEditor headers={manual.headers} onChange={h => setManual(f => ({ ...f, headers: h }))} />
              </div>
            )}
            {manual.type === 'stdio' && (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', fontSize: 12, color: '#d97706' }}>
                ⚠️ stdio transport chạy process local — agent-service chỉ hỗ trợ HTTP. Cấu hình sẽ được lưu nhưng không kết nối được.
              </div>
            )}
            <div>
              <Label>Description (optional)</Label>
              <input style={inputStyle} value={manual.description} onChange={e => setManual(f => ({ ...f, description: e.target.value }))} placeholder="Mô tả ngắn về server này" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={!manual.name.trim()} style={btnStyle}>Add server</button>
              <button type="button" onClick={closeAdd} style={btnSecStyle}>Huỷ</button>
            </div>
          </form>
        </div>
      )}

      <Msg msg={msg} />

      {servers.length === 0 && addMode === 'none' && (
        <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔌</div>
          Chưa có external MCP server nào.<br />
          Paste JSON config từ Cursor/Claude hoặc thêm thủ công.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {servers.map(s => (
          <div key={s.id} style={{
            padding: '12px 16px', borderRadius: 10, background: '#fff',
            border: `1px solid ${s.enabled ? '#e5e7eb' : '#f3f4f6'}`,
            opacity: s.enabled ? 1 : 0.65,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: '#1a1a2e' }}>{s.name}</span>
              <TypeBadge type={s.type} />
              <StatusBadge status={statuses[s.id] ?? 'idle'} />
              {s.url && <button onClick={() => testServer(s)} style={{ ...btnSecStyle, fontSize: 11, padding: '3px 10px' }}>Test</button>}
              <button onClick={() => toggle(s.id)} style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 20, cursor: 'pointer', fontWeight: 600,
                background: s.enabled ? 'rgba(16,185,129,0.1)' : 'transparent',
                border: `1px solid ${s.enabled ? 'rgba(16,185,129,0.3)' : '#e5e7eb'}`,
                color: s.enabled ? '#10b981' : '#9ca3af',
              }}>{s.enabled ? 'On' : 'Off'}</button>
              <button onClick={() => remove(s.id)} title="Xoá" style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e5e7eb', background: 'transparent', cursor: 'pointer', color: '#9ca3af', fontSize: 13 }}>✕</button>
            </div>
            {s.url && <div style={{ fontSize: 11, color: '#9ca3af', wordBreak: 'break-all' }}>{s.url}</div>}
            {s.headers && Object.keys(s.headers).length > 0 && (
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>
                🔑 {Object.keys(s.headers).map(k => <code key={k} style={{ marginRight: 6 }}>{k}</code>)}
              </div>
            )}
            {s.description && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{s.description}</div>}
            {testErrors[s.id] && (
              <div style={{ fontSize: 11, color: '#ef4444', marginTop: 5, padding: '4px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', wordBreak: 'break-all' }}>
                ⚠️ {testErrors[s.id]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Security tab ──────────────────────────────────────────────────────────────

interface TokenEntry { id: string; name: string; clientId: string; createdAt: string; lastUsedAt: string | null; tokenPrefix: string; }
interface CreatedToken extends TokenEntry { token: string; }
const PRESET_CLIENTS = [{ label: 'Cursor', clientId: 'cursor' }, { label: 'ChatGPT', clientId: 'chatgpt' }, { label: 'Claude', clientId: 'claude' }];

function SecurityTab() {
  const [tokens, setTokens] = useState<TokenEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createClientId, setCreateClientId] = useState('');
  const [newToken, setNewToken] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  const load = () => {
    setLoading(true);
    chrome.runtime.sendMessage({ type: 'LIST_TOKENS' }, r => {
      setLoading(false);
      if (r?.success) setTokens(r.tokens ?? []);
      else setError(r?.error ?? 'Failed to load tokens');
    });
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const name = createName.trim();
    if (!name) return;
    setCreating(true);
    chrome.runtime.sendMessage({ type: 'CREATE_TOKEN', name, clientId: createClientId.trim() || name }, r => {
      setCreating(false);
      if (r?.success) { setNewToken(r.token); setShowCreate(false); setCreateName(''); setCreateClientId(''); load(); }
      else setError(r?.error ?? 'Failed to create token');
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Revoke token "${name}"?`)) return;
    setDeletingId(id);
    chrome.runtime.sendMessage({ type: 'DELETE_TOKEN', id }, r => {
      setDeletingId(null);
      if (r?.success) setTokens(p => p.filter(t => t.id !== id));
      else setError(r?.error ?? 'Failed to delete token');
    });
  };

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString() : '—';

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <SectionTitle>MCP Client Tokens</SectionTitle>
        <button onClick={() => { setShowCreate(v => !v); setNewToken(null); }} style={btnStyle}>
          {showCreate ? 'Huỷ' : '+ New Token'}
        </button>
      </div>
      <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 20, lineHeight: 1.6 }}>
        Tạo token cho từng MCP client (Cursor, ChatGPT, Claude). Dùng admin token từ native-server để quản lý.
      </p>

      {error && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', fontSize: 12, marginBottom: 16 }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}

      {newToken && (
        <div style={{ padding: 16, borderRadius: 10, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.25)', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>✅ Token created: {newToken.name}</span>
            <button onClick={() => setNewToken(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16 }}>×</button>
          </div>
          <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 10 }}>⚠️ Copy token này ngay — sẽ không hiển thị lại.</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <code style={{ flex: 1, padding: '8px 12px', borderRadius: 7, background: '#1e1e2e', color: '#a6e3a1', fontSize: 12, wordBreak: 'break-all', fontFamily: 'monospace' }}>{newToken.token}</code>
            <button onClick={() => { navigator.clipboard.writeText(newToken.token).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }} style={{ ...btnStyle, flexShrink: 0 }}>{copied ? 'Copied!' : 'Copy'}</button>
          </div>
          <div>
            <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 6, fontWeight: 600 }}>Cursor MCP config:</p>
            <pre style={{ padding: '10px 12px', borderRadius: 7, background: '#1e1e2e', color: '#cdd6f4', fontSize: 11, fontFamily: 'monospace', overflowX: 'auto', whiteSpace: 'pre' }}>{JSON.stringify({ webmcp: { type: 'http', url: 'http://127.0.0.1:18080/mcp', headers: { Authorization: `Bearer ${newToken.token}` } } }, null, 2)}</pre>
          </div>
        </div>
      )}

      {showCreate && (
        <div style={{ padding: 16, borderRadius: 10, background: '#f8f9fa', border: '1px solid #e5e7eb', marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Create Token</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {PRESET_CLIENTS.map(p => (
              <button key={p.clientId} type="button" onClick={() => { setCreateClientId(p.clientId); setCreateName(p.label); }}
                style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid', cursor: 'pointer', fontSize: 12, fontWeight: 500, background: createClientId === p.clientId ? '#4f46e5' : 'transparent', color: createClientId === p.clientId ? '#fff' : '#4f46e5', borderColor: '#4f46e5' }}>
                {p.label}
              </button>
            ))}
          </div>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <Label>Name *</Label>
              <input style={inputStyle} value={createName} onChange={e => setCreateName(e.target.value)} placeholder="e.g. Cursor" required />
            </div>
            <div>
              <Label>Client ID (optional)</Label>
              <input style={inputStyle} value={createClientId} onChange={e => setCreateClientId(e.target.value)} placeholder="defaults to name" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={creating || !createName.trim()} style={btnStyle}>{creating ? 'Creating…' : 'Create'}</button>
              <button type="button" onClick={() => setShowCreate(false)} style={btnSecStyle}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ color: '#9ca3af', fontSize: 13, padding: '20px 0' }}>Loading tokens…</div>
      ) : tokens.length === 0 && !showCreate ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔑</div>
          Chưa có token nào. Tạo token cho Cursor, ChatGPT hoặc Claude.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tokens.map(t => (
            <div key={t.id} style={{ padding: '12px 16px', borderRadius: 10, background: '#fff', border: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f1f3f5', color: '#6b7280' }}>{t.clientId}</span>
                </div>
                <button onClick={() => handleDelete(t.id, t.name)} disabled={deletingId === t.id}
                  style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                  {deletingId === t.id ? '…' : 'Revoke'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#9ca3af' }}>
                <code style={{ color: '#6b7280' }}>{t.tokenPrefix}…</code>
                <span>Created: {fmt(t.createdAt)}</span>
                <span>Last used: {fmt(t.lastUsedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState<Tab>('general');

  return (
    <div style={{ display: 'flex', width: '100%', minHeight: '100vh', background: '#f8f9fa', fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif", fontSize: 13, color: '#1a1a2e' }}>

      {/* Sidebar */}
      <aside style={{ width: 200, background: '#fff', borderRight: '1px solid #e5e7eb', padding: '24px 0', flexShrink: 0 }}>
        <div style={{ padding: '0 20px 20px', borderBottom: '1px solid #e5e7eb', marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>🤖 Browser Agent</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Settings</div>
        </div>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '10px 20px', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 13,
            background: tab === t.id ? '#f0f0ff' : 'transparent',
            color: tab === t.id ? '#4f46e5' : '#374151',
            fontWeight: tab === t.id ? 600 : 400,
            borderRight: tab === t.id ? '3px solid #4f46e5' : '3px solid transparent',
          }}>
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </aside>

      {/* Content */}
      <main style={{ flex: 1, minWidth: 0, padding: '40px 48px', overflowX: 'hidden' }}>
        {tab === 'general'  && <GeneralTab />}
        {tab === 'provider' && <ProviderTab />}
        {tab === 'skills'   && <SkillsTab />}
        {tab === 'mcp'      && <McpTab />}
        {tab === 'security' && <SecurityTab />}
      </main>
    </div>
  );
}
