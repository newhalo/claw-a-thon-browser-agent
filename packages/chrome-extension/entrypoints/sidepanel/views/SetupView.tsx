import React, { useEffect, useState } from 'react';
import {
  checkAgentServiceHealthFull,
  saveAgentServiceConfig,
  setAgentToken,
  fetchNativeConfig,
  pushProviderConfig,
  fetchModels,
  DEFAULT_AGENT_SERVICE_URL,
  type PredefinedModel,
  type HealthStatus,
} from '../lib/agentServiceClient';

type SetupMode = 'connection' | 'provider';

interface SetupViewProps {
  mode: SetupMode;
  agentServiceUrl: string;
  health: HealthStatus | null;
  onConnectionDone: (url: string, token: string, health: HealthStatus) => void;
  onProviderDone: () => void;
}

export default function SetupView({ mode, agentServiceUrl, health, onConnectionDone, onProviderDone }: SetupViewProps) {
  return mode === 'connection'
    ? <ConnectionStep onDone={onConnectionDone} />
    : <ProviderStep agentServiceUrl={agentServiceUrl} health={health} onDone={onProviderDone} />;
}

// ── Step 1: Connection ────────────────────────────────────────────────────────

function ConnectionStep({ onDone }: { onDone: (url: string, token: string, health: HealthStatus) => void }) {
  const [url, setUrl] = useState(DEFAULT_AGENT_SERVICE_URL);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Pre-fill saved values
    chrome.storage.sync.get(['agentServiceUrl', 'agentToken'], (r) => {
      if (r.agentServiceUrl) setUrl(r.agentServiceUrl);
      if (r.agentToken) setToken(r.agentToken);
    });
  }, []);

  const handleConnect = async () => {
    setError('');
    const trimmedUrl = url.trim().replace(/\/+$/, '');
    if (!trimmedUrl) { setError('Nhập URL của agent-service'); return; }

    setLoading(true);
    try {
      // Update module-level token so health check uses it
      setAgentToken(token.trim());

      const h = await checkAgentServiceHealthFull(trimmedUrl);
      if (!h) {
        setError('Không kết nối được agent-service. Kiểm tra URL và server đang chạy.');
        setLoading(false);
        return;
      }

      if (h.authRequired && !token.trim()) {
        setError('Server yêu cầu Auth Token. Nhập token để tiếp tục.');
        setLoading(false);
        return;
      }

      // Save agent-service connection config
      await saveAgentServiceConfig({ url: trimmedUrl, token: token.trim() });

      // Fetch native-server config from agent-service (auth-protected) and notify background
      const nativeCfg = await fetchNativeConfig(trimmedUrl);
      if (nativeCfg?.url) {
        chrome.runtime.sendMessage({
          type: 'SAVE_CONFIG',
          config: { nativeServerUrl: nativeCfg.url, authToken: nativeCfg.token || '' }
        });
      }

      onDone(trimmedUrl, token.trim(), h);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi không xác định');
      setLoading(false);
    }
  };

  return (
    <SetupShell
      icon="🔌"
      title="Kết nối Agent Service"
      subtitle="Nhập địa chỉ và token xác thực của agent-service để bắt đầu."
    >
      <div>
        <label style={labelStyle}>Agent Service URL</label>
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleConnect()}
          placeholder="http://localhost:3000"
          style={inputStyle}
          autoComplete="off"
        />
      </div>

      <div>
        <label style={labelStyle}>Auth Token <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(để trống nếu không cần)</span></label>
        <input
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleConnect()}
          placeholder="your-secret-token"
          style={inputStyle}
          autoComplete="off"
        />
      </div>

      {error && <ErrorBox message={error} />}

      <button onClick={handleConnect} disabled={loading} style={primaryBtn(loading)}>
        {loading ? 'Đang kết nối…' : '→ Kết nối'}
      </button>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
        Token được lưu trong extension storage của trình duyệt.
      </div>
    </SetupShell>
  );
}

// ── Step 2: Provider ──────────────────────────────────────────────────────────

function ProviderStep({ agentServiceUrl, health, onDone }: { agentServiceUrl: string; health: HealthStatus | null; onDone: () => void }) {
  const [models, setModels] = useState<PredefinedModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedModel = models.find(m => m.id === selectedModelId);
  const isCustom = selectedModel?.category === 'Custom' || !selectedModel?.baseUrl?.includes('localhost');
  const needsApiKey = true; // Always ask for API key in setup — server stores it at runtime

  useEffect(() => {
    fetchModels(agentServiceUrl).then(list => {
      setModels(list);
      const def = list.find(m => m.default) ?? list[0];
      if (def) setSelectedModelId(def.id);
    });
    chrome.storage.sync.get(['agentProviderConfig'], r => {
      if (r.agentProviderConfig?.apiKey) setApiKey(r.agentProviderConfig.apiKey);
    });
  }, [agentServiceUrl]);

  const handleSave = async () => {
    setError('');
    if (!apiKey.trim()) { setError('API key là bắt buộc'); return; }
    if (!selectedModel) { setError('Chọn model trước'); return; }

    setSaving(true);
    try {
      chrome.storage.sync.set({
        agentProviderConfig: {
          provider: selectedModel.provider,
          apiKey: apiKey.trim(),
          model: selectedModel.id,
          baseUrl: selectedModel.baseUrl ?? '',
          toolsSupported: selectedModel.toolsSupported,
          visionSupported: selectedModel.visionSupported,
        }
      });

      pushProviderConfig(
        agentServiceUrl,
        selectedModel.provider,
        apiKey.trim(),
        selectedModel.id,
        selectedModel.baseUrl,
        selectedModel.toolsSupported,
        selectedModel.visionSupported,
      ).catch(() => {});

      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi không xác định');
    } finally {
      setSaving(false);
    }
  };

  const categories = Array.from(new Set(models.map(m => m.category)));

  return (
    <SetupShell
      icon="🤖"
      title="Cấu hình Model"
      subtitle={health?.authRequired
        ? 'Chọn model và nhập API key cho lần đầu sử dụng.'
        : 'Provider chưa được cấu hình trên server. Chọn model và nhập API key.'}
    >
      <div>
        <label style={labelStyle}>Model</label>
        {models.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>Đang tải…</div>
        ) : (
          <select value={selectedModelId} onChange={e => setSelectedModelId(e.target.value)} style={selectStyle}>
            {categories.map(cat => (
              <optgroup key={cat} label={cat}>
                {models.filter(m => m.category === cat).map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}

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

      {needsApiKey && (
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
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
            {isCustom
              ? 'API key của custom provider — lưu trong extension.'
              : 'API key của bạn cho model này — được gửi tới agent-service local.'}
          </div>
        </div>
      )}

      {error && <ErrorBox message={error} />}

      <button
        onClick={handleSave}
        disabled={saving || !apiKey.trim() || !selectedModel}
        style={primaryBtn(saving || !apiKey.trim() || !selectedModel)}
      >
        {saving ? 'Đang lưu…' : '✓ Bắt đầu Chat'}
      </button>
    </SetupShell>
  );
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function SetupShell({ icon, title, subtitle, children }: {
  icon: string; title: string; subtitle: string; children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'auto' }}>
      <div style={{ padding: '24px 20px 0', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>{title}</h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 280, margin: '0 auto' }}>{subtitle}</p>
      </div>
      <div style={{ padding: '20px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 7, fontSize: 12,
      background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)',
      color: 'var(--error)',
    }}>⚠️ {message}</div>
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

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '10px', borderRadius: 9, border: 'none',
  background: disabled ? 'var(--bg-active)' : 'var(--accent)',
  color: disabled ? 'var(--text-muted)' : 'white',
  cursor: disabled ? 'default' : 'pointer',
  fontWeight: 600, fontSize: 14, marginTop: 4,
  transition: 'background 0.15s',
});
