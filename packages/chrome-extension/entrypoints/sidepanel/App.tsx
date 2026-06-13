import React, { useEffect, useState } from 'react';
import ChatView from './views/ChatView';
import SetupView from './views/SetupView';
import Settings from './components/Settings';
import {
  getAgentServiceConfig,
  checkAgentServiceHealth,
  checkAgentServiceHealthFull,
  pushNativeConfigToAgentService,
  pushProviderConfig,
  pushSystemPrompt,
} from './lib/agentServiceClient';
import './App.css';

type Page = 'chat' | 'settings';

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
  const [currentPage, setCurrentPage] = useState<Page>('chat');
  const [isNativeConfigured, setIsNativeConfigured] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [agentAlive, setAgentAlive] = useState(false);
  const [agentUrl, setAgentUrl] = useState('');
  const [nativeCfg, setNativeCfg] = useState<NativeConfig>({});
  const [ready, setReady] = useState(false); // prevents flash before init

  useEffect(() => {
    initApp();
  }, []);

  async function initApp() {
    const { url } = await getAgentServiceConfig();
    setAgentUrl(url);

    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, async (response) => {
      const cfg: NativeConfig = response?.config || {};
      const nativeOk = !!(cfg?.nativeServerUrl && cfg?.authToken);
      setIsNativeConfigured(nativeOk);
      setNativeCfg(cfg);

      if (!nativeOk) {
        setCurrentPage('settings');
        setReady(true);
        return;
      }

      // Check agent-service health + provider status
      const health = await checkAgentServiceHealthFull(url);
      const alive = !!health;
      setAgentAlive(alive);

      if (alive) {
        // Push native config first
        await pushNativeConfigToAgentService(url, cfg.nativeServerUrl!, cfg.authToken!);

        // Restore custom system prompt
        chrome.storage.sync.get(['agentCustomSystemPrompt'], (r) => {
          if (r.agentCustomSystemPrompt) pushSystemPrompt(url, r.agentCustomSystemPrompt);
        });

        if (!health.provider?.configured) {
          // Try restoring saved provider config
          const restored = await tryRestoreProviderConfig(url);
          if (!restored) {
            setShowSetup(true);
            setReady(true);
            return;
          }
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

  const handleConfigSaved = async () => {
    setIsNativeConfigured(true);
    // Re-fetch config and re-check agent health
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, async (response) => {
      const cfg: NativeConfig = response?.config || {};
      setNativeCfg(cfg);
      if (!cfg?.nativeServerUrl) { setCurrentPage('chat'); return; }
      const { url } = await getAgentServiceConfig();
      setAgentUrl(url);
      const health = await checkAgentServiceHealthFull(url);
      const alive = !!health;
      setAgentAlive(alive);
      if (alive) {
        await pushNativeConfigToAgentService(url, cfg.nativeServerUrl!, cfg.authToken!);
        if (!health?.provider?.configured) {
          const restored = await tryRestoreProviderConfig(url);
          if (!restored) { setShowSetup(true); return; }
        }
      }
      setShowSetup(false);
      setCurrentPage('chat');
    });
  };

  const handleSetupDone = () => {
    setShowSetup(false);
    setCurrentPage('chat');
  };

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
          <button
            className={`nav-btn ${currentPage === 'chat' && !showSetup ? 'active' : ''}`}
            onClick={() => { setShowSetup(false); setCurrentPage('chat'); }}
            title="Chat"
          >💬</button>
          <button
            className={`nav-btn ${currentPage === 'settings' ? 'active' : ''}`}
            onClick={() => setCurrentPage('settings')}
            title="Settings"
          >⚙️</button>
        </nav>
      </header>

      <main className="app-content">
        {/* Setup view — shown when provider not configured */}
        {showSetup && (
          <SetupView
            agentServiceUrl={agentUrl}
            nativeServerUrl={nativeCfg.nativeServerUrl || ''}
            nativeAuthToken={nativeCfg.authToken || ''}
            onDone={handleSetupDone}
          />
        )}

        {/* ChatView always mounted to preserve Zustand store state */}
        {!showSetup && (
          <>
            <div style={{ display: currentPage === 'chat' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
              <ChatView onOpenSettings={() => setCurrentPage('settings')} />
            </div>
            {currentPage === 'settings' && (
              <Settings onConfigSaved={handleConfigSaved} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
