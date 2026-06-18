import React, { useEffect, useState } from 'react';
import { getAgentServiceConfig, checkAgentServiceHealthFull, pushProviderConfig, pushNativeConfigToAgentService, pushSystemPrompt, fetchModels, fetchModelCatalog, listModelsForConfiguredProvider, fetchSkills, fetchSkillFromUrl, loadCustomSkills, saveCustomSkills, loadDisabledSkills, saveDisabledSkills, type PredefinedModel, type ModelCatalogItem, type ModelInfo, type Skill, type CustomSkill } from '../lib/agentServiceClient';
import TokensPanel from './TokensPanel';
import ModelSelector from './ModelSelector';

interface SettingsProps {
  onConfigSaved: () => void;
}

function Settings({ onConfigSaved }: SettingsProps) {
  // Native server config
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Custom system prompt
  const [customPrompt, setCustomPrompt] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptMsg, setPromptMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Skills management
  const [builtinSkills, setBuiltinSkills] = useState<Skill[]>([]);
  const [customSkills, setCustomSkills] = useState<CustomSkill[]>([]);
  const [disabledSkills, setDisabledSkills] = useState<string[]>([]);
  const [skillUrl, setSkillUrl] = useState('');
  const [skillFetching, setSkillFetching] = useState(false);
  const [skillMsg, setSkillMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Provider config
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [providerStatus, setProviderStatus] = useState<{ configured: boolean; provider?: string | null; model?: string | null } | null>(null);
  const [models, setModels] = useState<PredefinedModel[]>([]);
  const [catalogModels, setCatalogModels] = useState<ModelCatalogItem[]>([]);
  const [liveModels, setLiveModels] = useState<ModelInfo[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerMsg, setProviderMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadConfig();
    loadProviderStatus();
    loadSavedProviderConfig();
    loadSavedCustomPrompt();
    getAgentServiceConfig().then(({ url }) => {
      fetchModels(url).then(list => {
        setModels(list);
        const def = list.find(m => m.default) ?? list[0];
        if (def) setSelectedModelId(prev => prev || def.id);
      });
      fetchSkills(url).then(setBuiltinSkills);
      // Pre-load catalog for model selector
      Promise.all([fetchModelCatalog(url), listModelsForConfiguredProvider(url)]).then(([cat, live]) => {
        setCatalogModels(cat);
        setLiveModels(live);
      });
    });
    loadCustomSkills().then(setCustomSkills);
    loadDisabledSkills().then(setDisabledSkills);
  }, []);

  const loadConfig = () => {
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
      if (response?.config) {
        setUrl(response.config.nativeServerUrl || '');
        setToken(response.config.authToken || '');
      }
    });
  };

  const loadProviderStatus = async () => {
    const { url: agentUrl } = await getAgentServiceConfig();
    const health = await checkAgentServiceHealthFull(agentUrl);
    if (health?.provider) setProviderStatus(health.provider);
  };

  const loadSavedCustomPrompt = () => {
    chrome.storage.sync.get(['agentCustomSystemPrompt'], (result) => {
      setCustomPrompt(result.agentCustomSystemPrompt || '');
    });
  };

  const handleSaveCustomPrompt = async () => {
    setPromptMsg(null);
    setPromptSaving(true);
    try {
      const { url: agentUrl } = await getAgentServiceConfig();
      await pushSystemPrompt(agentUrl, customPrompt.trim());
      chrome.storage.sync.set({ agentCustomSystemPrompt: customPrompt.trim() });
      setPromptMsg({ type: 'success', text: '✅ Đã lưu!' });
    } catch {
      setPromptMsg({ type: 'error', text: '❌ Lưu thất bại' });
    } finally {
      setPromptSaving(false);
    }
  };

  const loadSavedProviderConfig = () => {
    chrome.storage.sync.get(['agentProviderConfig'], (result) => {
      const saved = result.agentProviderConfig;
      if (saved) {
        setApiKey(saved.apiKey || '');
        if (saved.modelId || saved.model) setSelectedModelId(saved.modelId || saved.model);
      }
    });
  };

  const handleToggleSkill = async (id: string) => {
    const next = disabledSkills.includes(id)
      ? disabledSkills.filter(x => x !== id)
      : [...disabledSkills, id];
    setDisabledSkills(next);
    await saveDisabledSkills(next);
  };

  const handleAddCustomSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    setSkillMsg(null);
    if (!skillUrl.trim()) return;
    setSkillFetching(true);
    try {
      const skill = await fetchSkillFromUrl(skillUrl.trim());
      if (customSkills.find(s => s.id === skill.id)) {
        setSkillMsg({ type: 'error', text: 'Skill này đã được thêm' });
        return;
      }
      const next = [...customSkills, { ...skill, addedAt: Date.now() }];
      setCustomSkills(next);
      await saveCustomSkills(next);
      setSkillUrl('');
      setSkillMsg({ type: 'success', text: `✅ Đã thêm skill "${skill.name}"` });
    } catch (err) {
      setSkillMsg({ type: 'error', text: `❌ ${err instanceof Error ? err.message : 'Không tải được SKILL.md'}` });
    } finally {
      setSkillFetching(false);
    }
  };

  const handleDeleteCustomSkill = async (id: string) => {
    const next = customSkills.filter(s => s.id !== id);
    setCustomSkills(next);
    await saveCustomSkills(next);
    // also remove from disabled if present
    const nextDisabled = disabledSkills.filter(x => x !== id);
    setDisabledSkills(nextDisabled);
    await saveDisabledSkills(nextDisabled);
    // also remove from activeSkills in storage so ChatView deselects it
    chrome.storage.local.get(['activeSkills'], r => {
      const active: string[] = Array.isArray(r.activeSkills) ? r.activeSkills : [];
      if (active.includes(id)) chrome.storage.local.set({ activeSkills: active.filter(x => x !== id) });
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    chrome.runtime.sendMessage(
      { type: 'SAVE_CONFIG', config: { nativeServerUrl: url, authToken: token } },
      (response) => {
        setLoading(false);
        if (response?.success) {
          setMessage({ type: 'success', text: '✅ Đã lưu cấu hình!' });
          setTimeout(() => onConfigSaved(), 800);
        } else {
          setMessage({ type: 'error', text: '❌ Lưu thất bại' });
        }
      }
    );
  };

  const handleTestConnection = async () => {
    setLoading(true);
    setMessage(null);
    chrome.runtime.sendMessage(
      { type: 'TEST_CONNECTION', config: { nativeServerUrl: url, authToken: token } },
      (response) => {
        setLoading(false);
        if (response?.success) {
          setMessage({ type: 'success', text: '✅ Kết nối thành công!' });
        } else {
          setMessage({ type: 'error', text: `❌ Kết nối thất bại: ${response?.error || 'Unknown error'}` });
        }
      }
    );
  };

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setProviderMsg(null);
    if (!apiKey.trim()) { setProviderMsg({ type: 'error', text: 'API key là bắt buộc' }); return; }
    if (!selectedModelId) { setProviderMsg({ type: 'error', text: 'Chọn model trước' }); return; }

    // Try PredefinedModel first (for non-vngcloud), then fall back to catalog/live
    const selectedModel = models.find(m => m.id === selectedModelId);
    const catalogEntry = catalogModels.find(c => c.id === selectedModelId);

    setProviderSaving(true);
    try {
      const { url: agentUrl } = await getAgentServiceConfig();

      chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, async (response) => {
        const cfg = response?.config;
        if (cfg?.nativeServerUrl) {
          await pushNativeConfigToAgentService(agentUrl, cfg.nativeServerUrl, cfg.authToken);
        }
      });

      // Resolve provider config — prefer PredefinedModel, fallback to saved config
      const savedConfig: Record<string, unknown> = await new Promise(res =>
        chrome.storage.sync.get(['agentProviderConfig'], r => res(r.agentProviderConfig ?? {}))
      );
      const provider = selectedModel?.provider ?? (savedConfig.provider as string) ?? 'openai-compat';
      const baseUrl = selectedModel?.baseUrl ?? (savedConfig.baseUrl as string) ?? '';
      const toolsSupported = selectedModel?.toolsSupported ?? (savedConfig.toolsSupported as boolean) ?? true;
      const visionSupported = selectedModel?.visionSupported ?? (savedConfig.visionSupported as boolean) ?? false;

      const ok = await pushProviderConfig(agentUrl, provider, apiKey.trim(), selectedModelId, baseUrl || undefined, toolsSupported, visionSupported);
      if (!ok) { setProviderMsg({ type: 'error', text: 'Agent service không phản hồi' }); return; }

      chrome.storage.sync.set({
        agentProviderConfig: {
          modelId: selectedModelId,
          provider,
          apiKey: apiKey.trim(),
          model: selectedModelId,
          baseUrl: baseUrl ?? '',
          toolsSupported,
          visionSupported,
        }
      });
      const displayName = selectedModel?.name ?? catalogEntry?.name ?? selectedModelId;
      setProviderStatus({ configured: true, provider, model: selectedModelId });
      setProviderMsg({ type: 'success', text: `✅ Đã chọn: ${displayName}` });
      setShowProviderForm(false);
    } catch (err) {
      setProviderMsg({ type: 'error', text: err instanceof Error ? err.message : 'Lỗi không xác định' });
    } finally {
      setProviderSaving(false);
    }
  };

  return (
    <div className="settings">
      <div className="settings-container">

        {/* ── Native Server ─────────────────────────────────────── */}
        <h2>Native Server</h2>
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label htmlFor="url">Server URL</label>
            <input id="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:8080" required />
          </div>
          <div className="form-group">
            <label htmlFor="token">Auth Token</label>
            <input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)}
              placeholder="your-strong-token-here" required />
          </div>
          {message && <div className={`message message-${message.type}`}>{message.text}</div>}
          <div className="button-group">
            <button type="button" onClick={handleTestConnection} disabled={!url || !token || loading}>🔗 Test</button>
            <button type="submit" disabled={!url || !token || loading}>{loading ? 'Saving…' : '💾 Save'}</button>
          </div>
        </form>

        {/* ── LLM Provider ──────────────────────────────────────── */}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>LLM Provider</h2>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => {
                const opening = !showProviderForm;
                setShowProviderForm(v => !v);
                setProviderMsg(null);
                if (opening) {
                  // Reload live models + catalog when form opens to get fresh data
                  setCatalogLoading(true);
                  getAgentServiceConfig().then(({ url: agentUrl }) =>
                    Promise.all([fetchModelCatalog(agentUrl), listModelsForConfiguredProvider(agentUrl)])
                      .then(([cat, live]) => { setCatalogModels(cat); if (live.length > 0) setLiveModels(live); })
                      .finally(() => setCatalogLoading(false))
                  );
                }
              }}
            >
              {showProviderForm ? 'Đóng' : providerStatus?.configured ? '✏️ Đổi' : '+ Cấu hình'}
            </button>
          </div>

          {/* Status badge */}
          {providerStatus && !showProviderForm && (
            <div style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 12,
              background: providerStatus.configured ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.07)',
              border: `1px solid ${providerStatus.configured ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
              color: providerStatus.configured ? 'var(--success, #10b981)' : 'var(--error)',
            }}>
              {providerStatus.configured
                ? `✓ ${providerStatus.model || providerStatus.provider}`
                : '⚠️ Chưa cấu hình provider'}
            </div>
          )}

          {showProviderForm && (
            <form onSubmit={handleSaveProvider} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Model</label>
                <ModelSelector
                  liveModels={liveModels.length > 0 ? liveModels : models.map(m => ({ id: m.id, name: m.name, model_type: null, status: 'enabled' }))}
                  catalog={catalogModels}
                  activeModelId={selectedModelId}
                  onSelect={setSelectedModelId}
                  loading={catalogLoading}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>API Key</label>
                <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                  placeholder="your-api-key" autoComplete="off" />
              </div>

              {providerMsg && (
                <div style={{
                  padding: '7px 11px', borderRadius: 7, fontSize: 12,
                  background: providerMsg.type === 'error' ? 'rgba(239,68,68,0.07)' : 'rgba(16,185,129,0.07)',
                  border: `1px solid ${providerMsg.type === 'error' ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
                  color: providerMsg.type === 'error' ? 'var(--error)' : 'var(--success, #10b981)',
                }}>{providerMsg.text}</div>
              )}

              <div className="button-group">
                <button type="submit" disabled={providerSaving || !apiKey.trim() || !selectedModelId}>
                  {providerSaving ? 'Đang lưu…' : '💾 Lưu Provider'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* ── Custom System Prompt ──────────────────────────────── */}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 18 }}>
          <h2 style={{ marginBottom: 8 }}>Custom Instructions</h2>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
            Thêm hướng dẫn riêng cho agent — sẽ được append vào system prompt mặc định.
          </p>
          <textarea
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            placeholder={'Ví dụ: Luôn trả lời bằng tiếng Việt.\nKhi tóm tắt trang, dùng bullet points.'}
            rows={5}
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 7,
              border: '1px solid var(--border)', background: 'var(--bg-elevated)',
              color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 12,
              resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box',
            }}
          />
          {promptMsg && (
            <div style={{
              marginTop: 6, padding: '6px 10px', borderRadius: 6, fontSize: 11,
              background: promptMsg.type === 'error' ? 'rgba(239,68,68,0.07)' : 'rgba(16,185,129,0.07)',
              border: `1px solid ${promptMsg.type === 'error' ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
              color: promptMsg.type === 'error' ? 'var(--error)' : 'var(--success, #10b981)',
            }}>{promptMsg.text}</div>
          )}
          <div className="button-group" style={{ marginTop: 8 }}>
            <button type="button" onClick={handleSaveCustomPrompt} disabled={promptSaving}>
              {promptSaving ? 'Đang lưu…' : '💾 Lưu Instructions'}
            </button>
            {customPrompt && (
              <button type="button" className="btn-secondary" onClick={() => { setCustomPrompt(''); handleSaveCustomPrompt(); }}>
                Xoá
              </button>
            )}
          </div>
        </div>

        <div className="settings-info">
          <h3>Setup</h3>
          <ol>
            <li>Start native server: <code>cd packages/native-server && pnpm start</code></li>
            <li>Enter server URL + token → Save</li>
            <li>Cấu hình LLM provider ở trên</li>
          </ol>
        </div>

        {/* ── Agent Skills ──────────────────────────────────── */}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 18 }}>
          <h2 style={{ marginBottom: 12 }}>Agent Skills</h2>

          {/* Built-in skills */}
          {builtinSkills.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Built-in</div>
              {builtinSkills.map(skill => {
                const disabled = disabledSkills.includes(skill.id);
                return (
                  <div key={skill.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 16 }}>{skill.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: disabled ? 'var(--text-muted)' : 'var(--text-primary)' }}>{skill.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.description}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleSkill(skill.id)}
                      style={{
                        flexShrink: 0, fontSize: 11, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                        background: disabled ? 'transparent' : 'rgba(16,185,129,0.1)',
                        border: `1px solid ${disabled ? 'var(--border)' : 'rgba(16,185,129,0.3)'}`,
                        color: disabled ? 'var(--text-muted)' : 'var(--success, #10b981)',
                      }}
                    >
                      {disabled ? 'Off' : 'On'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Custom skills */}
          {customSkills.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Custom</div>
              {customSkills.map(skill => {
                const disabled = disabledSkills.includes(skill.id);
                return (
                  <div key={skill.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 16 }}>{skill.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: disabled ? 'var(--text-muted)' : 'var(--text-primary)' }}>{skill.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.sourceUrl}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleSkill(skill.id)}
                      style={{
                        flexShrink: 0, fontSize: 11, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                        background: disabled ? 'transparent' : 'rgba(16,185,129,0.1)',
                        border: `1px solid ${disabled ? 'var(--border)' : 'rgba(16,185,129,0.3)'}`,
                        color: disabled ? 'var(--text-muted)' : 'var(--success, #10b981)',
                      }}
                    >
                      {disabled ? 'Off' : 'On'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCustomSkill(skill.id)}
                      title="Xoá skill"
                      style={{ flexShrink: 0, fontSize: 11, padding: '3px 7px', borderRadius: 6, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add custom skill from URL */}
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Thêm từ URL</div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
            Nhập URL trỏ đến file <code>SKILL.md</code> — hỗ trợ GitHub, GitLab, hoặc URL raw bất kỳ.
          </p>
          <form onSubmit={handleAddCustomSkill} style={{ display: 'flex', gap: 6 }}>
            <input
              type="url"
              value={skillUrl}
              onChange={e => { setSkillUrl(e.target.value); setSkillMsg(null); }}
              placeholder="https://github.com/user/repo/blob/main/SKILL.md"
              style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontFamily: 'inherit' }}
            />
            <button type="submit" disabled={skillFetching || !skillUrl.trim()} style={{ flexShrink: 0 }}>
              {skillFetching ? '…' : '+ Add'}
            </button>
          </form>
          {skillMsg && (
            <div style={{
              marginTop: 6, padding: '6px 10px', borderRadius: 6, fontSize: 11,
              background: skillMsg.type === 'error' ? 'rgba(239,68,68,0.07)' : 'rgba(16,185,129,0.07)',
              border: `1px solid ${skillMsg.type === 'error' ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
              color: skillMsg.type === 'error' ? 'var(--error)' : 'var(--success, #10b981)',
            }}>{skillMsg.text}</div>
          )}
        </div>

        {/* ── MCP Client Tokens ─────────────────────────────── */}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 18 }}>
          <TokensPanel nativeServerUrl={url} />
        </div>
      </div>
    </div>
  );
}

function CapBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
      background: active ? 'rgba(16,185,129,0.1)' : 'rgba(156,163,175,0.1)',
      color: active ? 'var(--success, #10b981)' : 'var(--text-muted)',
      border: `1px solid ${active ? 'rgba(16,185,129,0.25)' : 'rgba(156,163,175,0.2)'}`,
    }}>
      {active ? '✓' : '✗'} {label}
    </span>
  );
}

export default Settings;
