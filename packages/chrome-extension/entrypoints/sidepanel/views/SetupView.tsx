import React, { useState } from 'react';
import { pushNativeConfigToAgentService } from '../lib/agentServiceClient';

type Provider = 'anthropic' | 'openai' | 'openai-compat';

interface ProviderMeta {
  label: string;
  icon: string;
  placeholder: string;
  modelPlaceholder: string;
  defaultModel: string;
  needsBaseUrl: boolean;
  hint?: string;
}

const PROVIDERS: Record<Provider, ProviderMeta> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    icon: '🟣',
    placeholder: 'sk-ant-api03-…',
    modelPlaceholder: 'claude-sonnet-4-6',
    defaultModel: 'claude-sonnet-4-6',
    needsBaseUrl: false,
  },
  openai: {
    label: 'OpenAI (GPT)',
    icon: '🟢',
    placeholder: 'sk-…',
    modelPlaceholder: 'gpt-4o',
    defaultModel: 'gpt-4o',
    needsBaseUrl: false,
  },
  'openai-compat': {
    label: 'Custom / OpenAI-compat',
    icon: '⚙️',
    placeholder: 'your-api-key',
    modelPlaceholder: 'model-name',
    defaultModel: '',
    needsBaseUrl: true,
    hint: 'Tương thích: OpenRouter, LiteLLM, VNGCloud, Ollama, v.v.',
  },
};

interface SetupViewProps {
  agentServiceUrl: string;
  nativeServerUrl: string;
  nativeAuthToken: string;
  onDone: () => void;
}

export default function SetupView({ agentServiceUrl, nativeServerUrl, nativeAuthToken, onDone }: SetupViewProps) {
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const meta = PROVIDERS[provider];

  const handleSave = async () => {
    setError('');
    if (!apiKey.trim()) { setError('API key là bắt buộc'); return; }
    if (provider === 'openai-compat' && !baseUrl.trim()) { setError('Base URL là bắt buộc cho custom provider'); return; }

    setSaving(true);
    try {
      // 1. Push native-server config
      if (nativeServerUrl) {
        await pushNativeConfigToAgentService(agentServiceUrl, nativeServerUrl, nativeAuthToken);
      }

      // 2. Push provider config
      const res = await fetch(`${agentServiceUrl}/provider-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          apiKey: apiKey.trim(),
          model: model.trim() || meta.defaultModel || undefined,
          baseUrl: provider === 'openai-compat' ? baseUrl.trim() : undefined,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) { setError(`Lỗi: ${res.status} ${res.statusText}`); return; }

      // 3. Save to extension storage for next session
      chrome.storage.sync.set({
        agentProviderConfig: {
          provider,
          apiKey: apiKey.trim(),
          model: model.trim() || meta.defaultModel || '',
          baseUrl: baseUrl.trim(),
        }
      });

      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kết nối thất bại');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-base)', overflow: 'auto',
    }}>
      {/* Header */}
      <div style={{
        padding: '20px 20px 0',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🚀</div>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
          Cấu hình Agent
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Chọn LLM provider để bắt đầu chat với Browser Agent.
        </p>
      </div>

      <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Provider selector */}
        <div>
          <label style={labelStyle}>LLM Provider</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(Object.entries(PROVIDERS) as [Provider, ProviderMeta][]).map(([key, m]) => (
              <button
                key={key}
                onClick={() => { setProvider(key); setApiKey(''); setModel(''); setBaseUrl(''); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                  border: `1.5px solid ${provider === key ? 'var(--accent)' : 'var(--border)'}`,
                  background: provider === key ? 'var(--accent-light)' : 'var(--bg-elevated)',
                  color: 'var(--text-primary)', textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 16 }}>{m.icon}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{m.label}</div>
                  {m.hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{m.hint}</div>}
                </div>
                {provider === key && (
                  <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 14 }}>✓</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Base URL (openai-compat only) */}
        {meta.needsBaseUrl && (
          <div>
            <label style={labelStyle}>Base URL</label>
            <input
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://api.openrouter.ai/v1"
              style={inputStyle}
            />
          </div>
        )}

        {/* API Key */}
        <div>
          <label style={labelStyle}>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={meta.placeholder}
            style={inputStyle}
            autoComplete="off"
          />
        </div>

        {/* Model (optional) */}
        <div>
          <label style={labelStyle}>Model <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(tuỳ chọn)</span></label>
          <input
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder={meta.modelPlaceholder}
            style={inputStyle}
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Để trống dùng mặc định: <code style={{ background: 'var(--bg-hover)', padding: '1px 4px', borderRadius: 3 }}>{meta.defaultModel || '—'}</code>
          </div>
        </div>

        {error && (
          <div style={{
            padding: '8px 12px', borderRadius: 7, fontSize: 12,
            background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)',
            color: 'var(--error)',
          }}>
            ⚠️ {error}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving || !apiKey.trim()}
          style={{
            padding: '10px', borderRadius: 9, border: 'none',
            background: saving || !apiKey.trim() ? 'var(--bg-active)' : 'var(--accent)',
            color: saving || !apiKey.trim() ? 'var(--text-muted)' : 'white',
            cursor: saving || !apiKey.trim() ? 'default' : 'pointer',
            fontWeight: 600, fontSize: 14, marginTop: 4,
            transition: 'background 0.15s',
          }}
        >
          {saving ? 'Đang lưu…' : '✓ Bắt đầu Chat'}
        </button>

        {/* Status */}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
          API key được lưu trong extension storage của trình duyệt.<br />
          Không gửi đi đâu ngoài agent-service chạy local.
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: 5,
  textTransform: 'uppercase', letterSpacing: '0.4px',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 11px',
  border: '1px solid var(--border)', borderRadius: 7,
  fontSize: 13, fontFamily: 'inherit',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  outline: 'none',
};
