import React, { useEffect, useState } from 'react';
import ChatView from './views/ChatView';
import Settings from './components/Settings';
import TokensPanel from './components/TokensPanel';
import './App.css';

type Page = 'chat' | 'settings' | 'tokens';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('chat');
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
      const configured = !!(response?.config?.nativeServerUrl && response?.config?.authToken);
      setIsConfigured(configured);
      if (!configured) setCurrentPage('settings');
    });
  }, []);

  const handleConfigSaved = () => {
    setIsConfigured(true);
    setCurrentPage('chat');
  };

  return (
    <div className="app" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header className="app-header" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>🤖 Browser Agent</h1>
        <nav className="app-nav" style={{ display: 'flex', gap: 4 }}>
          <button
            className={`nav-btn ${currentPage === 'chat' ? 'active' : ''}`}
            onClick={() => setCurrentPage('chat')}
            title="Chat"
          >
            💬
          </button>
          <button
            className={`nav-btn ${currentPage === 'tokens' ? 'active' : ''}`}
            onClick={() => setCurrentPage('tokens')}
            disabled={!isConfigured}
            title="Tokens"
          >
            🔑
          </button>
          <button
            className={`nav-btn ${currentPage === 'settings' ? 'active' : ''}`}
            onClick={() => setCurrentPage('settings')}
            title="Settings"
          >
            ⚙️
          </button>
        </nav>
      </header>

      <main className="app-content" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {currentPage === 'chat' && (
          <ChatView onOpenSettings={() => setCurrentPage('settings')} />
        )}
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
