import React, { useEffect, useState } from 'react';

interface SettingsProps {
  onConfigSaved: () => void;
}

function Settings({ onConfigSaved }: SettingsProps) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
      if (response?.config) {
        setUrl(response.config.nativeServerUrl || '');
        setToken(response.config.authToken || '');
      }
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    chrome.runtime.sendMessage(
      {
        type: 'SAVE_CONFIG',
        config: {
          nativeServerUrl: url,
          authToken: token,
        },
      },
      (response) => {
        setLoading(false);
        if (response?.success) {
          setMessage({ type: 'success', text: '✅ Configuration saved successfully!' });
          setTimeout(() => onConfigSaved(), 1000);
        } else {
          setMessage({ type: 'error', text: '❌ Failed to save configuration' });
        }
      }
    );
  };

  const handleTestConnection = async () => {
    setLoading(true);
    setMessage(null);

    chrome.runtime.sendMessage({
      type: 'TEST_CONNECTION',
      config: {
        nativeServerUrl: url,
        authToken: token,
      },
    }, (response) => {
      setLoading(false);
      if (response?.success) {
        setMessage({ type: 'success', text: '✅ Connection successful!' });
      } else {
        setMessage({
          type: 'error',
          text: `❌ Connection failed: ${response?.error || 'Unknown error'}`,
        });
      }
    });
  };

  return (
    <div className="settings">
      <div className="settings-container">
        <h2>Native Server Configuration</h2>

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label htmlFor="url">Native Server URL</label>
            <input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:8080"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="token">Auth Token</label>
            <input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="your-strong-token-here"
              required
            />
          </div>

          {message && (
            <div className={`message message-${message.type}`}>
              {message.text}
            </div>
          )}

          <div className="button-group">
            <button type="button" onClick={handleTestConnection} disabled={!url || !token || loading}>
              🔗 Test Connection
            </button>
            <button type="submit" disabled={!url || !token || loading}>
              {loading ? 'Saving...' : '💾 Save Configuration'}
            </button>
          </div>
        </form>

        <div className="settings-info">
          <h3>Setup Instructions</h3>
          <ol>
            <li>Start your native server: <code>cd packages/native-server && pnpm start</code></li>
            <li>Copy the auth token from your environment</li>
            <li>Enter the server URL and token above</li>
            <li>Click "Test Connection" to verify</li>
            <li>Go to Tools tab to see available MCP tools</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

export default Settings;
