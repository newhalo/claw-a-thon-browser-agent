import React, { useEffect, useState } from 'react';
import { pushNativeConfigToAgentService, pushProviderConfig, fetchModels, type PredefinedModel } from '../lib/agentServiceClient';

interface SetupViewProps {
  agentServiceUrl: string;
  nativeServerUrl: string;
  nativeAuthToken: string;
  onDone: () => void;
}

export default function SetupView({ agentServiceUrl, nativeServerUrl, nativeAuthToken, onDone }: SetupViewProps) {
  const [models, setModels] = useState<PredefinedModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchModels(agentServiceUrl).then(list => {
      setModels(list);
      const def = list.find(m => m.default) ?? list[0];
      if (def) setSelectedModelId(def.id);
    });
    // Pre-fill saved API key if any
    chrome.storage.sync.get(['agentProviderConfig'], result => {
      if (result.agentProviderConfig?.apiKey) setApiKey(result.agentProviderConfig.apiKey);
    });
  }, [agentServiceUrl]);

  const selectedModel = models.find(m => m.id === selectedModelId);

  // Group models by category for the dropdown
  const categories = Array.from(new Set(models.map(m => m.category)));

  const handleSave = async () => {
    setError('');
    if (!apiKey.trim()) { setError('API key là bắt buộc'); return; }
    if (!selectedModel) { setError('Chọn model trước'); return; }

    setSaving(true);
    try {
      if (nativeServerUrl) {
        await pushNativeConfigToAgentService(agentServiceUrl, nativeServerUrl, nativeAuthToken);
      }

      const ok = await pushProviderConfig(
        agentServiceUrl,
        selectedModel.provider,
        apiKey.trim(),
        selectedModel.id,
        selectedModel.baseUrl,
        selectedModel.toolsSupported,
        selectedModel.visionSupported,
      );
      if (!ok) { setError('Agent service không phản hồi'); return; }

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
      <div style={{ padding: '20px 20px 0', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🚀</div>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
          Cấu hình Agent
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Chọn model và nhập API key để bắt đầu.
        </p>
      </div>

      <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Model selector */}
        <div>
          <label style={labelStyle}>Model</label>
          {models.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
              Đang tải danh sách model…
            </div>
          ) : (
            <select
              value={selectedModelId}
              onChange={e => setSelectedModelId(e.target.value)}
              style={selectStyle}
            >
              {categories.map(cat => (
                <optgroup key={cat} label={cat}>
                  {models.filter(m => m.category === cat).map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}

          {/* Model capability badges */}
          {selectedModel && (
            <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
              <CapBadge label="Tools" active={selectedModel.toolsSupported} />
              <CapBadge label="Vision" active={selectedModel.visionSupported} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>
                {selectedModel.provider}{selectedModel.baseUrl ? ` · ${new URL(selectedModel.baseUrl).hostname}` : ''}
              </span>
            </div>
          )}
        </div>

        {/* API Key */}
        <div>
          <label style={labelStyle}>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="your-api-key"
            style={inputStyle}
            autoComplete="off"
          />
        </div>

        {error && (
          <div style={{
            padding: '8px 12px', borderRadius: 7, fontSize: 12,
            background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)',
            color: 'var(--error)',
          }}>⚠️ {error}</div>
        )}

        <button
          onClick={handleSave}
          disabled={saving || !apiKey.trim() || !selectedModel}
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

        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
          API key được lưu trong extension storage của trình duyệt.<br />
          Không gửi đi đâu ngoài agent-service chạy local.
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
  outline: 'none', boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '8px 11px',
  border: '1px solid var(--border)', borderRadius: 7,
  fontSize: 13, fontFamily: 'inherit',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  outline: 'none', cursor: 'pointer',
};
