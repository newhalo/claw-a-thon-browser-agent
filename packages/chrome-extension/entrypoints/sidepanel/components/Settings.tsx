import React, { useEffect, useState } from 'react';
import { getAgentServiceConfig, checkAgentServiceHealthFull, pushProviderConfig, pushNativeConfigToAgentService } from '../lib/agentServiceClient';

type Provider = 'anthropic' | 'openai' | 'openai-compat';

interface SettingsProps {
  onConfigSaved: () => void;
}

function Settings({ onConfigSaved }: SettingsProps) {
  // Native server config
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Provider config
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [providerStatus, setProviderStatus] = useState<{ configured: boolean; provider?: string | null; model?: string | null } | null>(null);
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerMsg, setProviderMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadConfig();
    loadProviderStatus();
    loadSavedProviderConfig();
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

  const loadSavedProviderConfig = () => {
    chrome.storage.sync.get(['agentProviderConfig'], (result) => {
      const saved = result.agentProviderConfig;
      if (saved?.provider) {
        setProvider(saved.provider as Provider);
        setApiKey(saved.apiKey || '');
        setModel(saved.model || '');
        setBaseUrl(saved.baseUrl || '');
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
    if (provider === 'openai-compat' && !baseUrl.trim()) { setProviderMsg({ type: 'error', text: 'Base URL là bắt buộc cho custom provider' }); return; }

    setProviderSaving(true);
    try {
      const { url: agentUrl } = await getAgentServiceConfig();

      // Also re-push native config while we're at it
      chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, async (response) => {
        const cfg = response?.config;
        if (cfg?.nativeServerUrl) {
          await pushNativeConfigToAgentService(agentUrl, cfg.nativeServerUrl, cfg.authToken);
        }
      });

      const ok = await pushProviderConfig(
        agentUrl, provider, apiKey.trim(),
        model.trim() || undefined,
        provider === 'openai-compat' ? baseUrl.trim() : undefined,
      );

      if (!ok) { setProviderMsg({ type: 'error', text: 'Agent service không phản hồi' }); return; }

      chrome.storage.sync.set({ agentProviderConfig: { provider, apiKey: apiKey.trim(), model: model.trim(), baseUrl: baseUrl.trim() } });
      setProviderStatus({ configured: true, provider, model: model.trim() || null });
      setProviderMsg({ type: 'success', text: '✅ Provider đã cập nhật!' });
      setShowProviderForm(false);
    } catch (err) {
      setProviderMsg({ type: 'error', text: err instanceof Error ? err.message : 'Lỗi không xác định' });
    } finally {
      setProviderSaving(false);
    }
  };

  const PROVIDER_LABELS: Record<string, string> = {
    anthropic: 'Anthropic (Claude)',
    openai: 'OpenAI (GPT)',
    'openai-compat': 'Custom / OpenAI-compat',
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
                ? `✓ ${PROVIDER_LABELS[providerStatus.provider!] || providerStatus.provider}${providerStatus.model ? ` · ${providerStatus.model}` : ''}`
                : '⚠️ Chưa cấu hình provider'}
            </div>
          )}

          {showProviderForm && (
            <form onSubmit={handleSaveProvider} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Provider</label>
                <select
                  value={provider}
                  onChange={e => setProvider(e.target.value as Provider)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontFamily: 'inherit' }}
                >
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI (GPT)</option>
                  <option value="openai-compat">Custom / OpenAI-compat</option>
                </select>
              </div>

              {provider === 'openai-compat' && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Base URL</label>
                  <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.openrouter.ai/v1" />
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>API Key</label>
                <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                  placeholder={provider === 'anthropic' ? 'sk-ant-api03-…' : provider === 'openai' ? 'sk-…' : 'your-api-key'}
                  autoComplete="off" />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Model <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(tuỳ chọn)</span></label>
                <input value={model} onChange={e => setModel(e.target.value)}
                  placeholder={provider === 'anthropic' ? 'claude-sonnet-4-6' : provider === 'openai' ? 'gpt-4o' : 'model-name'} />
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
          )}
        </div>

        <div className="settings-info">
          <h3>Setup</h3>
          <ol>
            <li>Start native server: <code>cd packages/native-server && pnpm start</code></li>
            <li>Enter server URL + token → Save</li>
            <li>Cấu hình LLM provider ở trên</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

export default Settings;
