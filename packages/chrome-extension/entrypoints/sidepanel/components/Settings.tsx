import React, { useEffect, useState } from 'react';
import { getAgentServiceConfig, checkAgentServiceHealthFull, pushProviderConfig, pushNativeConfigToAgentService, pushSystemPrompt, fetchModels, type PredefinedModel } from '../lib/agentServiceClient';
import TokensPanel from './TokensPanel';

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

  // Provider config
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [providerStatus, setProviderStatus] = useState<{ configured: boolean; provider?: string | null; model?: string | null } | null>(null);
  const [models, setModels] = useState<PredefinedModel[]>([]);
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
        // Set default selection if none saved yet
        const def = list.find(m => m.default) ?? list[0];
        if (def) setSelectedModelId(prev => prev || def.id);
      });
    });
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
    const selectedModel = models.find(m => m.id === selectedModelId);
    if (!selectedModel) { setProviderMsg({ type: 'error', text: 'Chọn model trước' }); return; }

    setProviderSaving(true);
    try {
      const { url: agentUrl } = await getAgentServiceConfig();

      chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, async (response) => {
        const cfg = response?.config;
        if (cfg?.nativeServerUrl) {
          await pushNativeConfigToAgentService(agentUrl, cfg.nativeServerUrl, cfg.authToken);
        }
      });

      const ok = await pushProviderConfig(
        agentUrl,
        selectedModel.provider,
        apiKey.trim(),
        selectedModel.id,
        selectedModel.baseUrl,
        selectedModel.toolsSupported,
        selectedModel.visionSupported,
      );

      if (!ok) { setProviderMsg({ type: 'error', text: 'Agent service không phản hồi' }); return; }

      chrome.storage.sync.set({
        agentProviderConfig: {
          modelId: selectedModel.id,
          provider: selectedModel.provider,
          apiKey: apiKey.trim(),
          model: selectedModel.id,
          baseUrl: selectedModel.baseUrl ?? '',
          toolsSupported: selectedModel.toolsSupported,
          visionSupported: selectedModel.visionSupported,
        }
      });
      setProviderStatus({ configured: true, provider: selectedModel.provider, model: selectedModel.id });
      setProviderMsg({ type: 'success', text: '✅ Provider đã cập nhật!' });
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
              onClick={() => { setShowProviderForm(v => !v); setProviderMsg(null); }}
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

          {showProviderForm && (() => {
            const selectedModel = models.find(m => m.id === selectedModelId);
            const categories = Array.from(new Set(models.map(m => m.category)));
            return (
              <form onSubmit={handleSaveProvider} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Model</label>
                  <select
                    value={selectedModelId}
                    onChange={e => setSelectedModelId(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontFamily: 'inherit' }}
                  >
                    {categories.map(cat => (
                      <optgroup key={cat} label={cat}>
                        {models.filter(m => m.category === cat).map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {selectedModel && (
                    <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                      <CapBadge label="Tools" active={selectedModel.toolsSupported} />
                      <CapBadge label="Vision" active={selectedModel.visionSupported} />
                    </div>
                  )}
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
                  <button type="submit" disabled={providerSaving || !apiKey.trim()}>
                    {providerSaving ? 'Đang lưu…' : '💾 Lưu Provider'}
                  </button>
                </div>
              </form>
            );
          })()}
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

        {/* ── MCP Client Tokens ─────────────────────────────── */}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 18 }}>
          <TokensPanel />
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
