import React, { useEffect, useState } from 'react';
import ChatView from './views/ChatView';
import SetupView from './views/SetupView';
import {
  getAgentServiceConfig,
  checkAgentServiceHealthFull,
  pushNativeConfigToAgentService,
  pushProviderConfig,
  pushSystemPrompt,
} from './lib/agentServiceClient';
import './App.css';

interface NativeConfig {
  nativeServerUrl?: string;
  authToken?: string;
}

interface ProviderConfig {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  toolsSupported?: boolean;
  visionSupported?: boolean;
}

function App() {
  const [showSetup, setShowSetup] = useState(false);
  const [agentUrl, setAgentUrl] = useState('');
  const [nativeCfg, setNativeCfg] = useState<NativeConfig>({});
  const [ready, setReady] = useState(false);

  useEffect(() => { initApp(); }, []);

  async function initApp() {
    const { url } = await getAgentServiceConfig();
    setAgentUrl(url);

    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, async (response) => {
      const cfg: NativeConfig = response?.config || {};
      setNativeCfg(cfg);

      const health = await checkAgentServiceHealthFull(url);
      if (health) {
        await pushNativeConfigToAgentService(url, cfg.nativeServerUrl!, cfg.authToken!);
        chrome.storage.sync.get(['agentCustomSystemPrompt'], (r) => {
          if (r.agentCustomSystemPrompt) pushSystemPrompt(url, r.agentCustomSystemPrompt);
        });
        if (!health.provider?.configured) {
          const restored = await tryRestoreProviderConfig(url);
          if (!restored) { setShowSetup(true); setReady(true); return; }
        }
      }

      setShowSetup(false);
      setReady(true);
    });
  }

  async function tryRestoreProviderConfig(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['agentProviderConfig'], async (result) => {
        const saved: ProviderConfig = result.agentProviderConfig;
        if (!saved?.provider || !saved?.apiKey) { resolve(false); return; }
        const ok = await pushProviderConfig(url, saved.provider, saved.apiKey, saved.model, saved.baseUrl, saved.toolsSupported, saved.visionSupported);
        resolve(ok);
      });
    });
  }

  if (!ready) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Đang khởi động…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>🤖 Browser Agent</h1>
        <nav className="app-nav">
          <button className="nav-btn" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("options.html") })} title="Settings">⚙️</button>
        </nav>
      </header>

      <main className="app-content">
        {showSetup ? (
          <SetupView
            agentServiceUrl={agentUrl}
            nativeServerUrl={nativeCfg.nativeServerUrl || ''}
            nativeAuthToken={nativeCfg.authToken || ''}
            onDone={() => setShowSetup(false)}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <ChatView onOpenSettings={() => chrome.tabs.create({ url: chrome.runtime.getURL("options.html") })} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
