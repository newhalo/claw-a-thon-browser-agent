import React, { useEffect, useState } from 'react';

interface TokenEntry {
  id: string;
  name: string;
  clientId: string;
  createdAt: string;
  lastUsedAt: string | null;
  tokenPrefix: string;
}

interface CreatedToken extends TokenEntry {
  token: string;
}

interface TokensPanelProps {
  nativeServerUrl?: string;
}

const PRESET_CLIENTS = [
  { label: 'Cursor', clientId: 'cursor' },
  { label: 'ChatGPT', clientId: 'chatgpt' },
  { label: 'Claude', clientId: 'claude' },
];

function TokensPanel({ nativeServerUrl: nativeServerUrlProp }: TokensPanelProps) {
  const [tokens, setTokens] = useState<TokenEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createClientId, setCreateClientId] = useState('');
  const [newToken, setNewToken] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [nativeServerUrl, setNativeServerUrl] = useState(nativeServerUrlProp || '');

  useEffect(() => {
    if (nativeServerUrlProp) { setNativeServerUrl(nativeServerUrlProp); return; }
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
      if (response?.config?.nativeServerUrl) setNativeServerUrl(response.config.nativeServerUrl);
    });
  }, [nativeServerUrlProp]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadTokens();
  }, []);

  const loadTokens = () => {
    setLoading(true);
    setError(null);
    chrome.runtime.sendMessage({ type: 'LIST_TOKENS' }, (response) => {
      setLoading(false);
      if (response?.success) {
        setTokens(response.tokens ?? []);
      } else {
        setError(response?.error ?? 'Failed to load tokens');
      }
    });
  };

  const handlePreset = (clientId: string, label: string) => {
    setCreateClientId(clientId);
    setCreateName(label);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const name = createName.trim();
    if (!name) return;
    setCreating(true);
    chrome.runtime.sendMessage(
      { type: 'CREATE_TOKEN', name, clientId: createClientId.trim() || name },
      (response) => {
        setCreating(false);
        if (response?.success) {
          setNewToken(response.token);
          setShowCreate(false);
          setCreateName('');
          setCreateClientId('');
          loadTokens();
        } else {
          setError(response?.error ?? 'Failed to create token');
        }
      }
    );
  };

  const handleCopy = () => {
    if (!newToken) return;
    navigator.clipboard.writeText(newToken.token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Revoke token "${name}"? Connected clients using this token will lose access.`)) return;
    setDeletingId(id);
    chrome.runtime.sendMessage({ type: 'DELETE_TOKEN', id }, (response) => {
      setDeletingId(null);
      if (response?.success) {
        setTokens((prev) => prev.filter((t) => t.id !== id));
      } else {
        setError(response?.error ?? 'Failed to delete token');
      }
    });
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  };

  return (
    <div className="tokens-panel">
      <div className="tokens-header">
        <h2>MCP Client Tokens</h2>
        <button className="btn-primary" onClick={() => { setShowCreate(true); setNewToken(null); }}>
          + New Token
        </button>
      </div>

      <p className="tokens-description">
        Create tokens for each MCP client (Cursor, ChatGPT, Claude). Use the admin token from Settings to manage tokens.
      </p>

      {error && (
        <div className="message message-error">
          {error}
          <button className="dismiss-btn" onClick={() => setError(null)}>×</button>
        </div>
      )}

      {newToken && (
        <div className="token-reveal">
          <div className="token-reveal-header">
            <strong>Token created: {newToken.name}</strong>
            <button className="dismiss-btn" onClick={() => setNewToken(null)}>×</button>
          </div>
          <p className="token-reveal-warning">Copy this token now — it will not be shown again.</p>
          <div className="token-value-row">
            <code className="token-value">{newToken.token}</code>
            <button className="btn-copy" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="cursor-config">
            <p className="cursor-config-label">Cursor / Claude Desktop MCP config:</p>
            <pre className="cursor-config-pre">{JSON.stringify({
              "browser-agent": {
                "type": "http",
                "description": "Browser Agent — control Chrome with AI",
                "url": `${(nativeServerUrl || 'http://127.0.0.1:18080').replace(/\/$/, '')}/mcp`,
                "headers": { "Authorization": `Bearer ${newToken.token}` }
              }
            }, null, 2)}</pre>
          </div>
        </div>
      )}

      {showCreate && (
        <form className="create-token-form" onSubmit={handleCreate}>
          <h3>Create Token</h3>
          <div className="preset-row">
            {PRESET_CLIENTS.map((p) => (
              <button
                key={p.clientId}
                type="button"
                className={`preset-btn ${createClientId === p.clientId ? 'active' : ''}`}
                onClick={() => handlePreset(p.clientId, p.label)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="form-group">
            <label htmlFor="token-name">Name</label>
            <input
              id="token-name"
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g. Cursor"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="token-client">Client ID (optional)</label>
            <input
              id="token-client"
              type="text"
              value={createClientId}
              onChange={(e) => setCreateClientId(e.target.value)}
              placeholder="defaults to name"
            />
          </div>
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={creating || !createName.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="loading">Loading tokens...</div>
      ) : tokens.length === 0 && !showCreate ? (
        <div className="empty-state">
          <p>No client tokens yet.</p>
          <p style={{ marginTop: '8px', fontSize: '12px' }}>Create tokens for Cursor, ChatGPT, or Claude.</p>
        </div>
      ) : (
        <div className="token-list">
          {tokens.map((t) => (
            <div key={t.id} className="token-card">
              <div className="token-card-header">
                <div>
                  <span className="token-name">{t.name}</span>
                  <span className="token-client-id">{t.clientId}</span>
                </div>
                <button
                  className="btn-danger"
                  onClick={() => handleDelete(t.id, t.name)}
                  disabled={deletingId === t.id}
                >
                  {deletingId === t.id ? '...' : 'Revoke'}
                </button>
              </div>
              <div className="token-meta">
                <span><code>{t.tokenPrefix}</code></span>
                <span>Created: {formatDate(t.createdAt)}</span>
                <span>Last used: {formatDate(t.lastUsedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default TokensPanel;
