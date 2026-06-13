import React, { useEffect, useState } from 'react';
import Settings from './components/Settings';
import ToolsPanel from './components/ToolsPanel';
import TokensPanel from './components/TokensPanel';
import './App.css';

type Page = 'settings' | 'tools' | 'tokens';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('settings');
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    checkConfiguration();
  }, []);

  const checkConfiguration = async () => {
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
      if (response?.config?.nativeServerUrl && response?.config?.authToken) {
        setIsConfigured(true);
        setCurrentPage('tools');
      } else {
        setIsConfigured(false);
        setCurrentPage('settings');
      }
    });
  };

  const handleConfigSaved = () => {
    setIsConfigured(true);
    setCurrentPage('tools');
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>🤖 Claw-a-thon MCP</h1>
        <nav className="app-nav">
          <button
            className={`nav-btn ${currentPage === 'tools' ? 'active' : ''}`}
            onClick={() => setCurrentPage('tools')}
            disabled={!isConfigured}
          >
            Tools
          </button>
          <button
            className={`nav-btn ${currentPage === 'tokens' ? 'active' : ''}`}
            onClick={() => setCurrentPage('tokens')}
            disabled={!isConfigured}
          >
            Tokens
          </button>
          <button
            className={`nav-btn ${currentPage === 'settings' ? 'active' : ''}`}
            onClick={() => setCurrentPage('settings')}
          >
            ⚙️ Settings
          </button>
        </nav>
      </header>

      <main className="app-content">
        {currentPage === 'settings' && (
          <Settings onConfigSaved={handleConfigSaved} />
        )}
        {currentPage === 'tools' && isConfigured && (
          <ToolsPanel />
        )}
        {currentPage === 'tokens' && isConfigured && (
          <TokensPanel />
        )}
      </main>
    </div>
  );
}

export default App;
