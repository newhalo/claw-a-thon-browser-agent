import React, { useEffect, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  getAgentServiceConfig, checkAgentServiceHealthFull,
  pushProviderConfig, pushSystemPrompt,
  fetchSkills, fetchSkillFromUrl, detectProviderCapabilities,
  loadCustomSkills, saveCustomSkills, loadDisabledSkills, saveDisabledSkills,
  loadCustomMcpServers, saveCustomMcpServers, pushExternalMcpServers, parseMcpConfigJson, testMcpServer,
  getMemoryConfig, pushMemoryConfig,
  listModelsFromProvider, listModelsForConfiguredProvider, fetchProviderConfig, fetchModelCatalog,
  getAuthHeaders,
  DEFAULT_AGENT_SERVICE_URL,
  type Skill, type CustomSkill, type CustomMcpServer, type ModelInfo, type ModelCatalogItem,
} from '../sidepanel/lib/agentServiceClient';
import { AgentLogo } from '../sidepanel/components/Icons';
import ModelSelector from '../sidepanel/components/ModelSelector';

type Tab = 'general' | 'provider' | 'skills' | 'mcp' | 'memory' | 'security';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'general',  label: 'General',  icon: '⚙️' },
  { id: 'provider', label: 'Provider', icon: '🤖' },
  { id: 'skills',   label: 'Skills',   icon: '🎯' },
  { id: 'mcp',      label: 'MCP',      icon: '🔌' },
  { id: 'memory',   label: 'Memory',   icon: '🧠' },
  { id: 'security', label: 'Security', icon: '🔑' },
];

const DEFAULT_EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';

// ── helpers ───────────────────────────────────────────────────────────────────

function Msg({ msg }: { msg: { type: 'success' | 'error'; text: string } | null }) {
  if (!msg) return null;
  return (
    <div style={{
      marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: 12,
      background: msg.type === 'error' ? 'rgba(239,68,68,0.07)' : 'rgba(16,185,129,0.07)',
      border: `1px solid ${msg.type === 'error' ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
      color: msg.type === 'error' ? 'var(--error, #ef4444)' : 'var(--success, #10b981)',
    }}>{msg.text}</div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: 'var(--text-primary)', margin: '0 0 16px' }}>{children}</h2>;
}

function Divider() {
  return <div style={{ borderTop: '1px solid var(--border)', margin: '24px 0' }} />;
}

function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5, ...style }}>{children}</label>;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 8,
  fontSize: 13, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontFamily: 'inherit',
  outline: 'none', boxSizing: 'border-box',
};

const btnStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff',
};

const btnSecStyle: React.CSSProperties = {
  ...btnStyle, background: 'transparent', color: 'var(--accent)',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10,
};

const formCardStyle: React.CSSProperties = {
  ...cardStyle, padding: 16, marginBottom: 20,
};

// ── General tab ───────────────────────────────────────────────────────────────

function GeneralTab() {
  const [agentUrl, setAgentUrl] = useState(DEFAULT_AGENT_SERVICE_URL);
  const [agentToken, setAgentTokenState] = useState('');
  const [hasJwt, setHasJwt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [promptMsg, setPromptMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    getAgentServiceConfig().then(c => { setAgentUrl(c.url); setAgentTokenState(c.token); });
    chrome.storage.sync.get(['agentCustomSystemPrompt'], r => setCustomPrompt(r.agentCustomSystemPrompt || ''));
    chrome.storage.local.get(['auth_jwt'], r => setHasJwt(!!r.auth_jwt));
  }, []);

  const saveConnection = async () => {
    setConnectionSaving(true); setMsg(null);
    try {
      const trimmedUrl = agentUrl.trim().replace(/\/+$/, '');
      const { saveAgentServiceConfig, setAgentToken } = await import('../sidepanel/lib/agentServiceClient');
      await saveAgentServiceConfig({ url: trimmedUrl, token: agentToken.trim() });
      setAgentToken(agentToken.trim());
      setMsg({ type: 'success', text: '✅ Đã lưu cấu hình kết nối' });
    } catch {
      setMsg({ type: 'error', text: '❌ Lưu thất bại' });
    } finally {
      setConnectionSaving(false);
    }
  };

  const savePrompt = async () => {
    setPromptSaving(true); setPromptMsg(null);
    try {
      await pushSystemPrompt(agentUrl, customPrompt.trim());
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
      <SectionTitle>Agent Service</SectionTitle>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
        Địa chỉ và token xác thực để kết nối với agent-service.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <Label>Service URL</Label>
          <input style={inputStyle} type="url" value={agentUrl} onChange={e => setAgentUrl(e.target.value)} placeholder="http://localhost:3000" />
        </div>
        {!hasJwt && (
          <div>
            <Label>Auth Token <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(để trống nếu không cần)</span></Label>
            <input style={inputStyle} type="password" value={agentToken} onChange={e => setAgentTokenState(e.target.value)} placeholder="your-secret-token" autoComplete="off" />
          </div>
        )}
        {hasJwt && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 10px', background: 'var(--surface-alt, color-mix(in srgb, var(--border) 50%, transparent))', borderRadius: 6 }}>
            ✓ Đã đăng nhập qua Google — không cần Auth Token
          </div>
        )}
        <Msg msg={msg} />
        <div>
          <button onClick={saveConnection} disabled={connectionSaving} style={btnStyle}>
            {connectionSaving ? 'Đang lưu…' : '💾 Save'}
          </button>
        </div>
      </div>

      <Divider />

      <SectionTitle>Custom Instructions</SectionTitle>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
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

// model_type values that represent chat/LLM models (not embedding/rerank/etc.)
const CHAT_MODEL_TYPES = new Set(['chat', 'messages', 'responses', 'generateContent']);

// Human-readable labels for model_type capability badges
const MODEL_TYPE_LABEL: Record<string, string> = {
  chat: 'Chat', messages: 'Messages', responses: 'Responses',
  generateContent: 'Generate', embedding: 'Embedding', rerank: 'Rerank',
  image: 'Image', tts: 'TTS', stt: 'STT', ocr: 'OCR',
};

function isChatModel(m: ModelInfo) {
  // If model_type is unknown (null/undefined), include it (non-VNGCloud providers)
  return !m.model_type || CHAT_MODEL_TYPES.has(m.model_type);
}
function isEmbeddingModel(m: ModelInfo) {
  return m.model_type === 'embedding';
}
function isEnabled(m: ModelInfo) {
  return !m.status || m.status === 'enabled';
}

function ModelTypeBadge({ type }: { type: string | null }) {
  if (!type || !MODEL_TYPE_LABEL[type]) return null;
  const colors: Record<string, { bg: string; color: string }> = {
    chat:            { bg: 'rgba(79,70,229,0.1)',   color: 'var(--accent)' },
    messages:        { bg: 'rgba(79,70,229,0.1)',   color: 'var(--accent)' },
    responses:       { bg: 'rgba(79,70,229,0.1)',   color: 'var(--accent)' },
    generateContent: { bg: 'rgba(79,70,229,0.1)',   color: 'var(--accent)' },
    embedding:       { bg: 'rgba(16,185,129,0.1)',  color: 'var(--success, #10b981)' },
    rerank:          { bg: 'rgba(245,158,11,0.1)',  color: '#d97706' },
    image:           { bg: 'rgba(236,72,153,0.1)',  color: '#db2777' },
    tts:             { bg: 'rgba(14,165,233,0.1)',  color: '#0284c7' },
    stt:             { bg: 'rgba(14,165,233,0.1)',  color: '#0284c7' },
    ocr:             { bg: 'rgba(156,163,175,0.1)', color: 'var(--text-muted)' },
  };
  const c = colors[type] ?? { bg: 'rgba(156,163,175,0.1)', color: 'var(--text-muted)' };
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 5,
      background: c.bg, color: c.color, border: `1px solid ${c.bg}`, marginLeft: 5, verticalAlign: 'middle',
    }}>{MODEL_TYPE_LABEL[type]}</span>
  );
}

type ProviderType = 'vngcloud' | 'openai' | 'gemini' | 'anthropic' | 'openai-compat';

const PROVIDER_LABEL: Record<string, string> = {
  vngcloud: 'VNGCloud', openai: 'OpenAI', gemini: 'Gemini',
  anthropic: 'Anthropic', 'openai-compat': 'OpenAI-compatible',
};

const PROVIDER_PRESETS: Record<ProviderType, { label: string; baseUrl: string; placeholder: string }> = {
  vngcloud:        { label: 'VNGCloud',         baseUrl: 'https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1',           placeholder: 'vn-…' },
  openai:          { label: 'OpenAI',           baseUrl: 'https://api.openai.com/v1',                                     placeholder: 'sk-…' },
  gemini:          { label: 'Gemini',           baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',       placeholder: 'AIza…' },
  anthropic:       { label: 'Anthropic',        baseUrl: '',                                                              placeholder: 'sk-ant-…' },
  'openai-compat': { label: 'OpenAI-compatible', baseUrl: '',                                                             placeholder: 'your-api-key' },
};

function ProviderTab() {
  // Current provider models list (from configured server provider)
  const [currentModels, setCurrentModels] = useState<ModelInfo[]>([]);
  const [currentModelId, setCurrentModelId] = useState('');
  const [loadingCurrentModels, setLoadingCurrentModels] = useState(true);
  const [embeddingModelId, setEmbeddingModelId] = useState(DEFAULT_EMBEDDING_MODEL);
  const [status, setStatus] = useState<{ configured: boolean; provider?: string | null; model?: string | null } | null>(null);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [switchMsg, setSwitchMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [catalogModels, setCatalogModels] = useState<ModelCatalogItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  // Add provider form
  const [showAddForm, setShowAddForm] = useState(false);
  const [providerType, setProviderType] = useState<ProviderType>('vngcloud');
  const [addBaseUrl, setAddBaseUrl] = useState('');
  const [addApiKey, setAddApiKey] = useState('');
  const [showAddApiKey, setShowAddApiKey] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ModelInfo[]>([]);
  const [fetchMsg, setFetchMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [addSelectedModel, setAddSelectedModel] = useState('');
  const [addTools, setAddTools] = useState(true);
  const [addVision, setAddVision] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [addEmbedding, setAddEmbedding] = useState('');
  const [saving, setSaving] = useState(false);
  const [addMsg, setAddMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    getAgentServiceConfig().then(async ({ url }) => {
      checkAgentServiceHealthFull(url).then(h => { if (h?.provider) setStatus(h.provider); });

      // Load server config to seed chrome.storage if not yet saved (covers VNGCLOUD env-only setup)
      const [serverCfg, list, catalog] = await Promise.all([
        fetchProviderConfig(url),
        listModelsForConfiguredProvider(url),
        fetchModelCatalog(url),
      ]);
      setCurrentModels(list);
      setCatalogModels(catalog);
      setLoadingCurrentModels(false);
      setLoadingCatalog(false);

      chrome.storage.sync.get(['agentProviderConfig'], r => {
        const saved = r.agentProviderConfig ?? {};
        const savedId = saved.modelId || saved.model;
        if (saved.embeddingModel) setEmbeddingModelId(saved.embeddingModel);

        // If storage has no baseUrl but server has one (e.g. from VNGCLOUD env), seed it
        if (serverCfg && !saved.baseUrl && serverCfg.baseUrl) {
          const merged = { ...saved, baseUrl: serverCfg.baseUrl, provider: serverCfg.provider ?? saved.provider };
          chrome.storage.sync.set({ agentProviderConfig: merged });
        }

        const match = list.find(m => m.id === savedId) ?? list.find(m => m.id === serverCfg?.model);
        setCurrentModelId(match?.id ?? list[0]?.id ?? savedId ?? serverCfg?.model ?? '');
      });
    });

    // Sync model selection when chat changes it
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.agentProviderConfig) {
        const cfg = changes.agentProviderConfig.newValue;
        if (cfg?.modelId || cfg?.model) setCurrentModelId(cfg.modelId || cfg.model);
        if (cfg?.embeddingModel) setEmbeddingModelId(cfg.embeddingModel);
      }
    };
    chrome.storage.sync.onChanged.addListener(onChanged);
    return () => chrome.storage.sync.onChanged.removeListener(onChanged);
  }, []);

  // Pre-fill baseUrl when switching provider type
  useEffect(() => {
    const preset = PROVIDER_PRESETS[providerType];
    if (preset.baseUrl) setAddBaseUrl(preset.baseUrl);
    else if (providerType !== 'openai-compat') setAddBaseUrl('');
    setFetchedModels([]);
    setFetchMsg(null);
    setAddSelectedModel('');
  }, [providerType]);

  const resolvedBaseUrl = addBaseUrl.trim() || PROVIDER_PRESETS[providerType].baseUrl;

  const handleFetchModels = async () => {
    setFetchingModels(true); setFetchMsg(null); setFetchedModels([]);
    try {
      const { url } = await getAgentServiceConfig();
      const prov = providerType === 'anthropic' ? 'anthropic' : providerType;
      const list = await listModelsFromProvider(url, resolvedBaseUrl, addApiKey.trim() || undefined, prov);
      if (list.length === 0) { setFetchMsg({ type: 'error', text: 'Provider không trả về model nào' }); }
      else { setFetchedModels(list); setAddSelectedModel(prev => prev || list[0].id); setFetchMsg({ type: 'success', text: `✅ ${list.length} models` }); }
    } catch (err) {
      setFetchMsg({ type: 'error', text: `❌ ${err instanceof Error ? err.message : 'Lỗi kết nối'}` });
    } finally { setFetchingModels(false); }
  };

  const autoDetect = async () => {
    if (!addSelectedModel.trim()) { setAddMsg({ type: 'error', text: 'Chọn model trước' }); return; }
    setDetecting(true); setAddMsg(null);
    try {
      const { url } = await getAgentServiceConfig();
      const prov = providerType === 'anthropic' ? 'anthropic' : providerType;
      const result = await detectProviderCapabilities(url, prov, addApiKey.trim(), addSelectedModel.trim(), resolvedBaseUrl || undefined);
      setAddTools(result.toolsSupported); setAddVision(result.visionSupported);
      setAddMsg({ type: 'success', text: `✅ Tools: ${result.toolsSupported ? 'có' : 'không'} · Vision: ${result.visionSupported ? 'có' : 'không'}` });
    } finally { setDetecting(false); }
  };

  const saveProvider = async (e: React.FormEvent) => {
    e.preventDefault(); setAddMsg(null);
    const modelId = addSelectedModel.trim();
    if (!modelId) { setAddMsg({ type: 'error', text: 'Chọn hoặc nhập Model ID' }); return; }
    if (!addApiKey.trim()) { setAddMsg({ type: 'error', text: 'API key là bắt buộc' }); return; }
    const prov = providerType === 'anthropic' ? 'anthropic'
      : providerType === 'openai' ? 'openai'
      : providerType;  // vngcloud, gemini, openai-compat — keep as-is, server handles them
    const baseUrl = prov !== 'anthropic' ? (resolvedBaseUrl || undefined) : undefined;
    const tools = prov === 'anthropic' || prov === 'openai' ? true : addTools;
    const vision = prov === 'anthropic' || prov === 'openai' ? true : addVision;
    const embModel = addEmbedding.trim() || undefined;

    setSaving(true);
    try {
      const { url } = await getAgentServiceConfig();
      const ok = await pushProviderConfig(url, prov, addApiKey.trim(), modelId, baseUrl, tools, vision, embModel);
      if (!ok) { setAddMsg({ type: 'error', text: '❌ Agent service không phản hồi' }); return; }
      chrome.storage.sync.set({ agentProviderConfig: { modelId, model: modelId, provider: prov, apiKey: addApiKey.trim(), baseUrl: baseUrl ?? '', toolsSupported: tools, visionSupported: vision, embeddingModel: embModel } });
      setStatus({ configured: true, provider: prov, model: modelId });
      // Refresh current models list from new provider
      setLoadingCurrentModels(true);
      const list = await listModelsForConfiguredProvider(url);
      setCurrentModels(list);
      setCurrentModelId(modelId);
      setLoadingCurrentModels(false);
      setShowAddForm(false);
      setAddMsg(null);
    } finally { setSaving(false); }
  };

  const saveModelSwitch = async () => {
    if (!currentModelId) return;
    setSwitchingModel(true); setSwitchMsg(null);
    const { url } = await getAgentServiceConfig();
    const embModel = embeddingModelId.trim() || undefined;
    // Read full saved config and just swap model
    chrome.storage.sync.get(['agentProviderConfig'], async r => {
      const saved = r.agentProviderConfig ?? {};
      let provider = saved.provider || 'vngcloud';
      if (provider === 'openai-compat' && typeof saved.baseUrl === 'string' && saved.baseUrl.includes('vngcloud')) provider = 'vngcloud';
      const ok = await pushProviderConfig(url, provider, saved.apiKey || '', currentModelId, saved.baseUrl || undefined, saved.toolsSupported ?? false, saved.visionSupported ?? false, embModel);
      if (ok) {
        chrome.storage.sync.set({ agentProviderConfig: { ...saved, modelId: currentModelId, model: currentModelId, embeddingModel: embModel } });
        setStatus(s => s ? { ...s, model: currentModelId } : s);
        setSwitchMsg({ type: 'success', text: '✅ Đã cập nhật model' });
      } else {
        setSwitchMsg({ type: 'error', text: '❌ Không thể kết nối agent-service' });
      }
      setSwitchingModel(false);
    });
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <SectionTitle>LLM Provider</SectionTitle>

      {/* Current provider status */}
      {status && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 20,
          background: status.configured ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.07)',
          border: `1px solid ${status.configured ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
          color: status.configured ? 'var(--success, #10b981)' : 'var(--error, #ef4444)',
        }}>
          {status.configured ? `✓ Provider: ${PROVIDER_LABEL[status.provider ?? ''] ?? status.provider}` : '⚠️ Chưa cấu hình provider'}
        </div>
      )}

      {/* Model selector for current provider */}
      {!loadingCurrentModels && currentModels.length > 0 && (() => {
        const embeddingModels = currentModels.filter(m => isEmbeddingModel(m) && isEnabled(m));
        return (
          <div style={{ ...formCardStyle, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Model đang dùng</div>
            <ModelSelector
              liveModels={currentModels}
              catalog={catalogModels}
              activeModelId={currentModelId}
              onSelect={setCurrentModelId}
              loading={loadingCatalog}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" onClick={saveModelSwitch} disabled={switchingModel} style={{ ...btnStyle, flexShrink: 0 }}>
                {switchingModel ? 'Đang lưu…' : 'Apply'}
              </button>
            </div>
            <Msg msg={switchMsg} />

            <div style={{ marginTop: 14 }}>
              <Label>Embedding Model <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></Label>
              {embeddingModels.length > 0 ? (
                <select value={embeddingModelId} onChange={e => setEmbeddingModelId(e.target.value)} style={inputStyle}>
                  <option value="">— Không dùng —</option>
                  {embeddingModels.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                </select>
              ) : (
                <input style={inputStyle} value={embeddingModelId} onChange={e => setEmbeddingModelId(e.target.value)} placeholder={DEFAULT_EMBEDDING_MODEL} />
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Dùng cho long-term memory.</div>
            </div>
          </div>
        );
      })()}

      {loadingCurrentModels && status?.configured && (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }}>Đang tải danh sách model…</div>
      )}

      {/* Add / Change Provider */}
      <div style={{ marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setShowAddForm(v => !v)}
          style={{ ...btnSecStyle, fontSize: 12, padding: '7px 16px' }}
        >
          {showAddForm ? '✕ Đóng' : (status?.configured ? '↺ Đổi Provider' : '+ Thêm Provider')}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={saveProvider} style={{ ...formCardStyle, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Cấu hình Provider</div>

          {/* Provider type selector */}
          <div>
            <Label>Provider</Label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(Object.keys(PROVIDER_PRESETS) as ProviderType[]).map(p => (
                <button
                  key={p} type="button"
                  onClick={() => setProviderType(p)}
                  style={{
                    padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                    background: providerType === p ? 'var(--accent)' : 'transparent',
                    color: providerType === p ? '#fff' : 'var(--accent)',
                    border: '1px solid var(--accent)',
                  }}
                >{PROVIDER_PRESETS[p].label}</button>
              ))}
            </div>
          </div>

          {/* Base URL — hide for pure Anthropic */}
          {providerType !== 'anthropic' && (
            <div>
              <Label>Base URL</Label>
              <input
                style={inputStyle}
                value={addBaseUrl}
                onChange={e => { setAddBaseUrl(e.target.value); setFetchedModels([]); setFetchMsg(null); }}
                placeholder={PROVIDER_PRESETS[providerType].baseUrl || 'https://api.example.com/v1'}
              />
            </div>
          )}

          {/* API Key */}
          <div>
            <Label>API Key</Label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                type={showAddApiKey ? 'text' : 'password'}
                value={addApiKey}
                onChange={e => setAddApiKey(e.target.value)}
                placeholder={PROVIDER_PRESETS[providerType].placeholder}
                autoComplete="off"
              />
              <button type="button" onClick={() => setShowAddApiKey(v => !v)}
                style={{ ...btnSecStyle, flexShrink: 0, padding: '8px 12px', fontSize: 12 }}>
                {showAddApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Model picker */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Label style={{ margin: 0, flex: 1 }}>Model</Label>
              <button
                type="button"
                onClick={handleFetchModels}
                disabled={fetchingModels || !addApiKey.trim()}
                style={{ ...btnSecStyle, fontSize: 12, padding: '5px 12px' }}
              >
                {fetchingModels ? '⏳ Đang tải…' : '🔍 Fetch Models'}
              </button>
            </div>
            <Msg msg={fetchMsg} />
            {fetchedModels.length > 0 ? (
              <div style={{ marginTop: 6 }}>
                <ModelSelector
                  liveModels={fetchedModels}
                  catalog={catalogModels}
                  activeModelId={addSelectedModel}
                  onSelect={setAddSelectedModel}
                />
              </div>
            ) : (
              <input
                style={{ ...inputStyle, marginTop: fetchMsg ? 6 : 0 }}
                value={addSelectedModel}
                onChange={e => setAddSelectedModel(e.target.value)}
                placeholder="Nhập Model ID hoặc Fetch Models để chọn"
              />
            )}
          </div>

          {/* Capabilities — only relevant for openai-compat */}
          {(providerType === 'openai-compat') && (
            <div>
              <Label>Capabilities</Label>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={addTools} onChange={e => setAddTools(e.target.checked)} /><span>Tool calls</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={addVision} onChange={e => setAddVision(e.target.checked)} /><span>Vision</span>
                </label>
                <button type="button" onClick={autoDetect} disabled={detecting || !addSelectedModel.trim()} style={{ ...btnSecStyle, fontSize: 11, padding: '3px 10px' }}>
                  {detecting ? '⏳' : '🔍 Auto-detect'}
                </button>
              </div>
            </div>
          )}

          {/* Embedding model */}
          <div>
            <Label>Embedding Model <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></Label>
            {fetchedModels.length > 0 ? (() => {
              const embModels = fetchedModels.filter(m => isEmbeddingModel(m) && isEnabled(m));
              return embModels.length > 0 ? (
                <select value={addEmbedding} onChange={e => setAddEmbedding(e.target.value)} style={inputStyle}>
                  <option value="">— Không dùng —</option>
                  {embModels.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                </select>
              ) : (
                <input style={inputStyle} value={addEmbedding} onChange={e => setAddEmbedding(e.target.value)} placeholder={DEFAULT_EMBEDDING_MODEL} />
              );
            })() : (
              <input style={inputStyle} value={addEmbedding} onChange={e => setAddEmbedding(e.target.value)} placeholder={DEFAULT_EMBEDDING_MODEL} />
            )}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Dùng cho long-term memory.</div>
          </div>

          <Msg msg={addMsg} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving || !addApiKey.trim() || !addSelectedModel.trim()} style={btnStyle}>
              {saving ? 'Đang lưu…' : '💾 Save Provider'}
            </button>
            <button type="button" onClick={() => { setShowAddForm(false); setAddMsg(null); }} style={btnSecStyle}>Huỷ</button>
          </div>
        </form>
      )}
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: disabled ? 'var(--text-muted)' : 'var(--text-primary)' }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>
      </div>
      <button onClick={onToggle} style={{
        flexShrink: 0, fontSize: 11, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontWeight: 600,
        background: disabled ? 'transparent' : 'rgba(16,185,129,0.1)',
        border: `1px solid ${disabled ? 'var(--border)' : 'rgba(16,185,129,0.3)'}`,
        color: disabled ? 'var(--text-muted)' : 'var(--success, #10b981)',
      }}>{disabled ? 'Off' : 'On'}</button>
      {onDelete && (
        <button onClick={onDelete} title="Xoá" style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13 }}>✕</button>
      )}
    </div>
  );
}

function SkillsTab({ prefillOnMount }: { prefillOnMount?: boolean }) {
  const [builtins, setBuiltins] = useState<Skill[]>([]);
  const [customs, setCustoms] = useState<CustomSkill[]>([]);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [mode, setMode] = useState<SkillFormMode>('none');

  const [skillUrl, setSkillUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [urlMsg, setUrlMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [form, setForm] = useState({ name: '', description: '', icon: '🔧', category: 'custom', instructions: '' });
  const [createMsg, setCreateMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    getAgentServiceConfig().then(({ url }) => fetchSkills(url).then(setBuiltins));
    loadCustomSkills().then(setCustoms);
    loadDisabledSkills().then(setDisabled);
  }, []);

  useEffect(() => {
    if (!prefillOnMount) return;
    chrome.storage.session.get(['skillDraft'], (result) => {
      const draft = result.skillDraft;
      if (!draft) return;
      setMode('create');
      setForm({
        name: draft.name ?? '',
        icon: draft.icon ?? '🔧',
        description: draft.description ?? '',
        category: draft.category ?? 'custom',
        instructions: draft.instructions ?? '',
      });
      chrome.storage.session.remove(['skillDraft']);
    });
  }, [prefillOnMount]);

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
          <button onClick={() => setMode(mode === 'url' ? 'none' : 'url')} style={{ ...btnSecStyle, fontSize: 12, padding: '6px 12px' }}>+ Từ URL</button>
          <button onClick={() => setMode(mode === 'create' ? 'none' : 'create')} style={{ ...btnStyle, fontSize: 12, padding: '6px 12px' }}>+ Tạo mới</button>
        </div>
      </div>

      {mode === 'url' && (
        <div style={formCardStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text-primary)' }}>Thêm skill từ URL</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
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

      {mode === 'create' && (
        <div style={formCardStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>Tạo skill mới</div>
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

      {builtins.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Built-in</div>
          {builtins.map(s => (
            <SkillRow key={s.id} icon={s.icon} name={s.name} subtitle={s.description}
              disabled={disabled.includes(s.id)} onToggle={() => toggle(s.id)} />
          ))}
        </div>
      )}

      {customs.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Custom</div>
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
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '40px 0' }}>
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
    idle:    { bg: 'rgba(156,163,175,0.1)', color: 'var(--text-muted)', border: 'rgba(156,163,175,0.2)', label: '—' },
    testing: { bg: 'rgba(245,158,11,0.1)',  color: '#f59e0b', border: 'rgba(245,158,11,0.25)', label: 'Testing…' },
    ok:      { bg: 'rgba(16,185,129,0.1)',  color: 'var(--success, #10b981)', border: 'rgba(16,185,129,0.25)', label: 'Connected' },
    error:   { bg: 'rgba(239,68,68,0.07)',  color: 'var(--error, #ef4444)', border: 'rgba(239,68,68,0.25)', label: 'Error' },
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
      color: isStdio ? '#d97706' : 'var(--accent)',
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
          <button type="button" onClick={() => remove(i)} style={{ flexShrink: 0, width: 28, height: 34, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13 }}>✕</button>
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
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
        Kết nối thêm MCP server ngoài native-server. Hỗ trợ format JSON của Cursor/Claude/VS Code.
      </p>

      {addMode === 'paste' && (
        <div style={formCardStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>Paste MCP config JSON</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
            Hỗ trợ format <code>mcpServers</code> của Cursor/Claude, hoặc paste trực tiếp một server object.
          </p>
          <textarea
            value={pasteJson}
            onChange={e => onPasteChange(e.target.value)}
            rows={8}
            placeholder={`// Ví dụ — paste từ Cursor/Claude config:\n{\n  "n8n-mcp": {\n    "type": "http",\n    "url": "https://example.com/mcp",\n    "headers": {\n      "Authorization": "Bearer your-token"\n    }\n  }\n}`}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5 }}
          />
          {pasteError && <div style={{ color: 'var(--error, #ef4444)', fontSize: 12, marginTop: 6 }}>⚠️ {pasteError}</div>}
          {parsedPaste.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Sẽ thêm {parsedPaste.length} server:
              </div>
              {parsedPaste.map((p, i) => (
                <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)', marginBottom: 6, fontSize: 12, color: 'var(--text-primary)' }}>
                  <span style={{ fontWeight: 600 }}>{p.name || '(unnamed)'}</span>
                  {' '}<TypeBadge type={p.type} />
                  {p.url && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{p.url}</span>}
                  {p.headers && Object.keys(p.headers).length > 0 && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>🔑 {Object.keys(p.headers).join(', ')}</span>
                  )}
                </div>
              ))}
              <button onClick={importParsed} style={{ ...btnStyle, marginTop: 4 }}>Import {parsedPaste.length} server</button>
            </div>
          )}
        </div>
      )}

      {addMode === 'manual' && (
        <div style={formCardStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>Thêm MCP server thủ công</div>
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
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔌</div>
          Chưa có external MCP server nào.<br />
          Paste JSON config từ Cursor/Claude hoặc thêm thủ công.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {servers.map(s => (
          <div key={s.id} style={{
            padding: '12px 16px', borderRadius: 10, ...cardStyle,
            opacity: s.enabled ? 1 : 0.65,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{s.name}</span>
              <TypeBadge type={s.type} />
              <StatusBadge status={statuses[s.id] ?? 'idle'} />
              {s.url && <button onClick={() => testServer(s)} style={{ ...btnSecStyle, fontSize: 11, padding: '3px 10px' }}>Test</button>}
              <button onClick={() => toggle(s.id)} style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 20, cursor: 'pointer', fontWeight: 600,
                background: s.enabled ? 'rgba(16,185,129,0.1)' : 'transparent',
                border: `1px solid ${s.enabled ? 'rgba(16,185,129,0.3)' : 'var(--border)'}`,
                color: s.enabled ? 'var(--success, #10b981)' : 'var(--text-muted)',
              }}>{s.enabled ? 'On' : 'Off'}</button>
              <button onClick={() => remove(s.id)} title="Xoá" style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13 }}>✕</button>
            </div>
            {s.url && <div style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{s.url}</div>}
            {s.headers && Object.keys(s.headers).length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                🔑 {Object.keys(s.headers).map(k => <code key={k} style={{ marginRight: 6 }}>{k}</code>)}
              </div>
            )}
            {s.description && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.description}</div>}
            {testErrors[s.id] && (
              <div style={{ fontSize: 11, color: 'var(--error, #ef4444)', marginTop: 5, padding: '4px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', wordBreak: 'break-all' }}>
                ⚠️ {testErrors[s.id]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Memory tab ────────────────────────────────────────────────────────────────

interface MemoryEntry { id: number; conversation_id: string; content: string; importance: number; created_at: number; }

function MemoryTab() {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [stats, setStats] = useState<{ total: number; withEmbeddings: number; maxEntries?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [maxEntries, setMaxEntries] = useState(200);
  const [savingConfig, setSavingConfig] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { url } = await getAgentServiceConfig();
      const [memRes, cfgRes] = await Promise.all([
        fetch(`${url}/memories?limit=100`, { headers: getAuthHeaders() }),
        getMemoryConfig(url),
      ]);
      if (memRes.ok) {
        const data = await memRes.json();
        setMemories(data.memories ?? []);
        setStats(data.stats ?? null);
      }
      if (cfgRes) setMaxEntries(cfgRes.maxEntries);
    } catch { /* service down */ } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const deleteOne = async (id: number) => {
    const { url } = await getAgentServiceConfig();
    await fetch(`${url}/memories/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    setMemories(p => p.filter(m => m.id !== id));
    if (stats) setStats(s => s ? { ...s, total: s.total - 1 } : s);
  };

  const clearAll = async () => {
    if (!confirm('Xóa toàn bộ long-term memory?')) return;
    const { url } = await getAgentServiceConfig();
    const res = await fetch(`${url}/memories/clear`, { method: 'POST', headers: getAuthHeaders() });
    if (res.ok) { setMemories([]); setStats(s => s ? { ...s, total: 0, withEmbeddings: 0 } : s); setMsg({ type: 'success', text: '✅ Đã xóa toàn bộ memory' }); }
    else setMsg({ type: 'error', text: '❌ Xóa thất bại' });
  };

  const [optimizing, setOptimizing] = useState(false);

  const optimizeMemory = async () => {
    setOptimizing(true);
    try {
      const { url } = await getAgentServiceConfig();
      const res = await fetch(`${url}/memories/optimize`, { method: 'POST', headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        const { merged = 0, deleted = 0 } = data.dedup ?? {};
        const parts = [];
        if (merged > 0) parts.push(`gộp ${merged} cặp trùng`);
        if (deleted > 0) parts.push(`xóa ${deleted} entries`);
        setMsg({ type: 'success', text: `✅ Optimize xong${parts.length ? ': ' + parts.join(', ') : ' — không có gì cần dọn'}` });
        void load();
      } else {
        setMsg({ type: 'error', text: '❌ Optimize thất bại' });
      }
    } finally {
      setOptimizing(false);
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      const { url } = await getAgentServiceConfig();
      const ok = await pushMemoryConfig(url, maxEntries);
      await chrome.storage.sync.set({ memoryMaxEntries: maxEntries });
      setMsg({ type: ok ? 'success' : 'error', text: ok ? '✅ Đã lưu cấu hình memory' : '❌ Lưu thất bại' });
    } finally { setSavingConfig(false); }
  };

  const fmt = (ts: number) => new Date(ts).toLocaleString('vi-VN');

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <SectionTitle>Long-term Memory</SectionTitle>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={load} style={{ ...btnSecStyle, fontSize: 12, padding: '6px 12px' }}>↻ Refresh</button>
          <button onClick={optimizeMemory} disabled={optimizing || memories.length < 2} style={{ ...btnSecStyle, fontSize: 12, padding: '6px 12px' }} title="Gộp memories trùng, dọn dẹp entries thừa">
            {optimizing ? '⏳ Optimizing…' : '✨ Optimize Memory'}
          </button>
          <button onClick={clearAll} disabled={memories.length === 0} style={{ ...btnStyle, fontSize: 12, padding: '6px 12px', background: 'var(--error, #ef4444)', borderColor: 'var(--error, #ef4444)' }}>🗑 Clear all</button>
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
        Agent tự động tóm tắt các cuộc hội thoại và lưu vào đây. Memories có nội dung tương tự được gộp lại. Khi bắt đầu chat mới, nội dung liên quan sẽ được inject vào context.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '10px 14px', borderRadius: 10, ...cardStyle }}>
        <Label style={{ margin: 0, whiteSpace: 'nowrap' }}>Max entries</Label>
        <input
          type="number" min={10} max={10000} value={maxEntries}
          onChange={e => setMaxEntries(parseInt(e.target.value) || 200)}
          style={{ width: 80, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
        />
        <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>Entries vượt quá giới hạn sẽ tự động bị xóa (ưu tiên giữ lại entries quan trọng và mới nhất)</span>
        <button onClick={saveConfig} disabled={savingConfig} style={{ ...btnSecStyle, fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap' }}>
          {savingConfig ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>

      {stats && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total memories', value: stats.total },
            { label: 'With embeddings', value: stats.withEmbeddings },
            { label: 'Keyword-only', value: stats.total - stats.withEmbeddings },
          ].map(s => (
            <div key={s.label} style={{ padding: '10px 16px', borderRadius: 10, ...cardStyle, textAlign: 'center', minWidth: 100 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <Msg msg={msg} />

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>Đang tải…</div>
      ) : memories.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🧠</div>
          Chưa có memory nào. Agent sẽ tự động tạo sau khi hoàn thành hội thoại.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {memories.map(m => (
            <div key={m.id} style={{ padding: '12px 16px', borderRadius: 10, ...cardStyle }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6 }}>{m.content}</div>
                <button onClick={() => deleteOne(m.id)} title="Xóa" style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}>✕</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'flex', gap: 12 }}>
                <span>🕐 {fmt((m as any).updated_at || m.created_at)}</span>
                <span style={{ fontFamily: 'monospace' }}>conv: {m.conversation_id.slice(0, 8)}…</span>
                {(m as any).importance != null && <span>⭐ {((m as any).importance as number).toFixed(2)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
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
  const [nativeServerUrl, setNativeServerUrl] = useState('');

  useEffect(() => {
    load();
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (r) => {
      if (r?.config?.nativeServerUrl) setNativeServerUrl(r.config.nativeServerUrl);
    });
  }, []);

  const load = () => {
    setLoading(true);
    chrome.runtime.sendMessage({ type: 'LIST_TOKENS' }, r => {
      setLoading(false);
      if (r?.success) setTokens(r.tokens ?? []);
      else setError(r?.error ?? 'Không thể tải danh sách token');
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
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
        Tạo token cho từng MCP client (Cursor, ChatGPT, Claude). Dùng admin token từ native-server để quản lý.
      </p>

      {error && (
        error.includes('chưa được cấu hình') ? (
          <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', color: 'var(--warning, #f59e0b)', fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
            ⚠️ Native server chưa kết nối. Mở sidepanel và kết nối với agent-service trước.
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--error, #ef4444)', fontSize: 12, marginBottom: 16 }}>
            {error}
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error, #ef4444)', fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
        )
      )}

      {newToken && (
        <div style={{ padding: 16, borderRadius: 10, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.25)', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>✅ Token created: {newToken.name}</span>
            <button onClick={() => setNewToken(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16 }}>×</button>
          </div>
          <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 10 }}>⚠️ Copy token này ngay — sẽ không hiển thị lại.</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <code style={{ flex: 1, padding: '8px 12px', borderRadius: 7, background: '#1e1e2e', color: '#a6e3a1', fontSize: 12, wordBreak: 'break-all', fontFamily: 'monospace' }}>{newToken.token}</code>
            <button onClick={() => { navigator.clipboard.writeText(newToken.token).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }} style={{ ...btnStyle, flexShrink: 0 }}>{copied ? 'Copied!' : 'Copy'}</button>
          </div>
          <div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>Cursor MCP config:</p>
            <pre style={{ padding: '10px 12px', borderRadius: 7, background: '#1e1e2e', color: '#cdd6f4', fontSize: 11, fontFamily: 'monospace', overflowX: 'auto', whiteSpace: 'pre' }}>{JSON.stringify({ "browser-agent": { type: 'http', description: 'Browser Agent — control Chrome with AI', url: `${(nativeServerUrl || 'http://127.0.0.1:18080').replace(/\/$/, '')}/mcp`, headers: { Authorization: `Bearer ${newToken.token}` } } }, null, 2)}</pre>
          </div>
        </div>
      )}

      {showCreate && (
        <div style={formCardStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>Create Token</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {PRESET_CLIENTS.map(p => (
              <button key={p.clientId} type="button" onClick={() => { setCreateClientId(p.clientId); setCreateName(p.label); }}
                style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid', cursor: 'pointer', fontSize: 12, fontWeight: 500, background: createClientId === p.clientId ? 'var(--accent)' : 'transparent', color: createClientId === p.clientId ? '#fff' : 'var(--accent)', borderColor: 'var(--accent)' }}>
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
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>Loading tokens…</div>
      ) : tokens.length === 0 && !showCreate ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔑</div>
          Chưa có token nào. Tạo token cho Cursor, ChatGPT hoặc Claude.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tokens.map(t => (
            <div key={t.id} style={{ padding: '12px 16px', borderRadius: 10, ...cardStyle }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{t.name}</span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'var(--bg-active)', color: 'var(--text-secondary)' }}>{t.clientId}</span>
                </div>
                <button onClick={() => handleDelete(t.id, t.name)} disabled={deletingId === t.id}
                  style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'var(--error, #ef4444)', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                  {deletingId === t.id ? '…' : 'Revoke'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)' }}>
                <code style={{ color: 'var(--text-secondary)' }}>{t.tokenPrefix}…</code>
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
  const params = new URLSearchParams(window.location.search);
  const prefillSkill = params.get('prefill') === '1' && params.get('tab') === 'skills';
  const [tab, setTab] = useState<Tab>(prefillSkill ? 'skills' : 'general');

  // Load JWT into module-level cache so all API calls in options page are authenticated
  useEffect(() => {
    chrome.storage.local.get(['auth_jwt'], async (r) => {
      if (r.auth_jwt) {
        const { setJwt } = await import('../sidepanel/lib/agentServiceClient');
        setJwt(r.auth_jwt);
      }
    });
  }, []);

  return (
    <Tooltip.Provider delayDuration={300}>
    <div style={{
      display: 'flex', width: '100%', minHeight: '100vh',
      background: 'var(--bg-secondary)',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif",
      fontSize: 13, color: 'var(--text-primary)',
    }}>

      {/* Sidebar */}
      <aside style={{
        width: 200, background: 'var(--bg-elevated)',
        borderRight: '1px solid var(--border)', padding: '24px 0', flexShrink: 0,
      }}>
        <div style={{ padding: '0 20px 20px', borderBottom: '1px solid var(--border)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AgentLogo size={20} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Browser Agent</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Settings</div>
          </div>
        </div>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '10px 20px', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 13,
            background: tab === t.id ? 'var(--bg-active)' : 'transparent',
            color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
            fontWeight: tab === t.id ? 600 : 400,
            borderRight: tab === t.id ? '3px solid var(--accent)' : '3px solid transparent',
            transition: 'background 0.1s, color 0.1s',
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
        {tab === 'skills'   && <SkillsTab prefillOnMount={prefillSkill} />}
        {tab === 'mcp'      && <McpTab />}
        {tab === 'memory'   && <MemoryTab />}
        {tab === 'security' && <SecurityTab />}
      </main>
    </div>
    </Tooltip.Provider>
  );
}
