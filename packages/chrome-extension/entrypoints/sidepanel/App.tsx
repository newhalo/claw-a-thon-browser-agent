import React, { useEffect, useState } from 'react';
import ChatView from './views/ChatView';
import Settings from './components/Settings';
import TokensPanel from './components/TokensPanel';
import { getAgentServiceConfig, checkAgentServiceHealth, pushNativeConfigToAgentService } from './lib/agentServiceClient';
import './App.css';

type Page = 'chat' | 'settings' | 'tokens';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('chat');
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, async (response) => {
      const cfg = response?.config;
      const configured = !!(cfg?.nativeServerUrl && cfg?.authToken);
      setIsConfigured(configured);
      if (!configured) { setCurrentPage('settings'); return; }

      // Push native-server config to agent-service on startup
      const { url: agentUrl } = await getAgentServiceConfig();
      const alive = await checkAgentServiceHealth(agentUrl);
      if (alive) {
        await pushNativeConfigToAgentService(agentUrl, cfg.nativeServerUrl, cfg.authToken);
      }
    });
  }, []);

  const handleConfigSaved = async () => {
    setIsConfigured(true);
    setCurrentPage('chat');
    // Re-push config after settings save
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, async (response) => {
      const cfg = response?.config;
      if (!cfg?.nativeServerUrl) return;
      const { url: agentUrl } = await getAgentServiceConfig();
      await pushNativeConfigToAgentService(agentUrl, cfg.nativeServerUrl, cfg.authToken);
    });
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>🤖 Browser Agent</h1>
        <nav className="app-nav">
          <button
            className={`nav-btn ${currentPage === 'chat' ? 'active' : ''}`}
            onClick={() => setCurrentPage('chat')}
            title="Chat"
          >💬</button>
          <button
            className={`nav-btn ${currentPage === 'tokens' ? 'active' : ''}`}
            onClick={() => setCurrentPage('tokens')}
            disabled={!isConfigured}
            title="Tokens"
          >🔑</button>
          <button
            className={`nav-btn ${currentPage === 'settings' ? 'active' : ''}`}
            onClick={() => setCurrentPage('settings')}
            title="Settings"
          >⚙️</button>
        </nav>
      </header>

      <main className="app-content">
        {/* ChatView always mounted to preserve Zustand store state */}
        <div style={{ display: currentPage === 'chat' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <ChatView onOpenSettings={() => setCurrentPage('settings')} />
        </div>
        {currentPage === 'settings' && (
          <Settings onConfigSaved={handleConfigSaved} />
        )}
        {currentPage === 'tokens' && isConfigured && (
          <TokensPanel />
        )}
      </main>
    </div>
  );
}

export default App;
