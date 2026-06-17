import React, { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import ChatView from './views/ChatView';
import SetupView from './views/SetupView';
import { AgentLogo, SunIcon, MoonIcon, SystemThemeIcon } from './components/Icons';
import { useTheme, type Theme } from './lib/ThemeContext';
import {
  getAgentServiceConfig,
  checkAgentServiceHealthFull,
  setAgentToken,
  fetchNativeConfig,
  fetchProviderConfig,
  pushProviderConfig,
  pushNativeConfigToAgentService,
  pushSystemPrompt,
  type HealthStatus,
} from './lib/agentServiceClient';
import './App.css';

const IS_DEV = import.meta.env.VITE_APP_ENV === 'development';

// Setup mode: 'connection' = enter URL+token, 'provider' = configure provider, null = chat
type SetupMode = 'connection' | 'provider' | null;

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const options: { value: Theme; icon: React.ReactNode; label: string }[] = [
    { value: 'light', icon: <SunIcon size={15} />, label: 'Light' },
    { value: 'system', icon: <SystemThemeIcon size={15} />, label: 'System' },
    { value: 'dark', icon: <MoonIcon size={15} />, label: 'Dark' },
  ];
  const current = options.find(o => o.value === theme) ?? options[1];

  const cycle = () => {
    const idx = options.findIndex(o => o.value === theme);
    setTheme(options[(idx + 1) % options.length].value);
  };

  return (
    <button
      className="theme-toggle"
      onClick={cycle}
      title={`Theme: ${current.label} (click to cycle)`}
    >
      {current.icon}
    </button>
  );
}

function App() {
  const [setupMode, setSetupMode] = useState<SetupMode>(null);
  const [agentUrl, setAgentUrl] = useState('');
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { initApp(); }, []);

  async function initApp() {
    // Check if URL was explicitly saved — fresh install has no saved URL
    const hasExplicitUrl = await new Promise<boolean>((resolve) => {
      chrome.storage.sync.get(['agentServiceUrl'], (r) => resolve(!!r.agentServiceUrl));
    });

    const cfg = await getAgentServiceConfig();
    setAgentUrl(cfg.url);

    // Initialize module-level auth token for all API calls
    setAgentToken(cfg.token);

    // Never auto-connect on fresh install — always require explicit setup
    if (!hasExplicitUrl) {
      setSetupMode('connection');
      setReady(true);
      return;
    }

    const h = await checkAgentServiceHealthFull(cfg.url);
    setHealth(h);

    if (!h) {
      // Agent-service unreachable — show connection setup
      setSetupMode('connection');
      setReady(true);
      return;
    }

    // Service reachable — check if auth is valid
    if (h.authRequired && !cfg.token) {
      // Server requires auth but no token saved → connection setup
      setSetupMode('connection');
      setReady(true);
      return;
    }

    // Fetch native-server config from agent-service.
    // If server has no config (just restarted), re-push from extension storage so the
    // background script keeps its existing connection instead of losing the token.
    fetchNativeConfig(cfg.url).then(nativeCfg => {
      const isRealUrl = (u: string | null | undefined) =>
        !!u && !u.includes('localhost') && !u.includes('127.0.0.1');

      if (isRealUrl(nativeCfg?.url)) {
        // Server has a real native-server URL — save it to extension storage
        chrome.runtime.sendMessage({
          type: 'SAVE_CONFIG',
          config: { nativeServerUrl: nativeCfg!.url, authToken: nativeCfg!.token || '' }
        });
      } else {
        // Server has no/localhost URL (just restarted) — re-push saved extension config
        chrome.storage.sync.get(['clawathon_mcp_config'], (r) => {
          const saved = r.clawathon_mcp_config;
          if (saved?.nativeServerUrl && isRealUrl(saved.nativeServerUrl)) {
            pushNativeConfigToAgentService(cfg.url, saved.nativeServerUrl, saved.authToken || '');
          }
        });
      }
    });

    // Seed agentProviderConfig.baseUrl from server env if not yet saved locally (covers VNGCLOUD env-only setup)
    fetchProviderConfig(cfg.url).then(serverCfg => {
      if (!serverCfg) return;
      chrome.storage.sync.get(['agentProviderConfig'], r => {
        const saved = r.agentProviderConfig ?? {};
        if (!saved.baseUrl && serverCfg.baseUrl) {
          chrome.storage.sync.set({ agentProviderConfig: { ...saved, baseUrl: serverCfg.baseUrl, provider: serverCfg.provider ?? saved.provider } });
        }
      });
    });

    // Push custom system prompt if saved
    chrome.storage.sync.get(['agentCustomSystemPrompt'], (r) => {
      if (r.agentCustomSystemPrompt) pushSystemPrompt(cfg.url, r.agentCustomSystemPrompt);
    });

    if (!h.provider?.configured) {
      // Provider not configured on server (likely restarted) — try re-pushing saved config
      const repushed = await new Promise<boolean>((resolve) => {
        chrome.storage.sync.get(['agentProviderConfig'], async (r) => {
          const saved = r.agentProviderConfig;
          if (!saved?.provider || !saved?.apiKey) { resolve(false); return; }
          try {
            const ok = await pushProviderConfig(cfg.url, saved.provider, saved.apiKey, saved.model, saved.baseUrl, saved.toolsSupported, saved.visionSupported, saved.embeddingModel);
            resolve(ok);
          } catch { resolve(false); }
        });
      });
      if (!repushed) {
        setSetupMode('provider');
      } else {
        setSetupMode(null);
      }
    } else {
      setSetupMode(null);
    }
    setReady(true);
  }

  async function handleConnectionDone(newUrl: string, newToken: string, newHealth: HealthStatus) {
    setAgentUrl(newUrl);
    setAgentToken(newToken);
    setHealth(newHealth);

    if (!newHealth.provider?.configured) {
      setSetupMode('provider');
    } else {
      setSetupMode(null);
    }
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
        <div className="app-header-brand">
          <AgentLogo size={22} />
          <h1>Browser Agent</h1>
          <div className="app-header-badges">
            {IS_DEV && <span className="badge-dev">DEV</span>}
          </div>
        </div>
        <nav className="app-nav">
          <ThemeToggle />
          <button
            className="nav-btn"
            onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })}
            title="Settings"
          >
            <Settings size={16} />
          </button>
        </nav>
      </header>

      <main className="app-content">
        {setupMode ? (
          <SetupView
            mode={setupMode}
            agentServiceUrl={agentUrl}
            health={health}
            onConnectionDone={handleConnectionDone}
            onProviderDone={() => setSetupMode(null)}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <ChatView onOpenSettings={() => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
