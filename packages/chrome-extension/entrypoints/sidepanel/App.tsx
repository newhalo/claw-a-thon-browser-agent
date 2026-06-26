import React, { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import ChatView from './views/ChatView';
import SetupView from './views/SetupView';
import LoginView from './views/LoginView';
import { AgentLogo, SunIcon, MoonIcon, SystemThemeIcon } from './components/Icons';
import { useTheme, type Theme } from './lib/ThemeContext';
import {
  getAgentServiceConfig,
  saveAgentServiceConfig,
  checkAgentServiceHealthFull,
  setAgentToken,
  setJwt,
  fetchNativeConfig,
  fetchProviderConfig,
  pushProviderConfig,
  pushNativeConfigToAgentService,
  pushSystemPrompt,
  type HealthStatus,
} from './lib/agentServiceClient';
import { getStoredAuth, refreshJwt, logout, type AuthUser } from './lib/auth';
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
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [missingPermissions, setMissingPermissions] = useState<{ permissions: string[]; origins: string[] } | null>(null);

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

    // ── Auth: silent refresh or prompt login ──────────────────────────────────
    const { jwt, refreshToken, user } = await getStoredAuth();
    if (user) setAuthUser(user);
    if (jwt) {
      setJwt(jwt);
    } else if (refreshToken) {
      // JWT expired — try silent refresh
      const newJwt = await refreshJwt(cfg.url);
      if (newJwt) setJwt(newJwt);
      else { setNeedLogin(true); setReady(true); return; }
    } else if (!cfg.token) {
      // No static token and no JWT — require login
      setNeedLogin(true); setReady(true); return;
    }
    // Auth passed — update user state if not yet set
    const hasGoogleAuth = !!(jwt || refreshToken);
    if (!user) {
      const { user: freshUser } = await getStoredAuth();
      if (freshUser) setAuthUser(freshUser);
    }
    // ─────────────────────────────────────────────────────────────────────────

    // If no saved URL and not logged in via Google, require connection setup
    if (!hasExplicitUrl && !hasGoogleAuth) {
      setSetupMode('connection');
      setReady(true);
      return;
    }
    // If logged in via Google but no saved URL, auto-save default URL and proceed
    if (!hasExplicitUrl && hasGoogleAuth) {
      await saveAgentServiceConfig({ url: cfg.url, token: cfg.token });
    }

    const h = await checkAgentServiceHealthFull(cfg.url);
    setHealth(h);

    if (!h) {
      // Agent-service unreachable — show connection setup
      setSetupMode('connection');
      setReady(true);
      return;
    }

    // Service reachable — check if auth is valid (JWT counts as authenticated)
    const { jwt: currentJwt } = await getStoredAuth();
    if (h.authRequired && !cfg.token && !currentJwt) {
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
    checkRequiredPermissions();
    setReady(true);
  }

  // Check which default-enabled tool permissions haven't been granted yet
  async function checkRequiredPermissions() {
    const [allUrlsGranted, notificationsGranted] = await Promise.all([
      new Promise<boolean>(r => chrome.permissions.contains({ origins: ['<all_urls>'] }, r)),
      new Promise<boolean>(r => chrome.permissions.contains({ permissions: ['notifications'] }, r)),
    ]);
    const origins = allUrlsGranted ? [] : ['<all_urls>'];
    const permissions = notificationsGranted ? [] : ['notifications'];
    if (origins.length || permissions.length) {
      setMissingPermissions({ permissions, origins });
    }
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
          {authUser && (
            <div style={{ position: 'relative' }}>
              <button
                className="nav-btn"
                title={authUser.name}
                onClick={() => setShowUserMenu(v => !v)}
                style={{ padding: 2 }}
              >
                {authUser.avatarUrl
                  ? <img src={authUser.avatarUrl} alt={authUser.name} style={{ width: 20, height: 20, borderRadius: '50%', display: 'block' }} />
                  : <span style={{ fontSize: 13, fontWeight: 600 }}>{authUser.name[0]?.toUpperCase()}</span>
                }
              </button>
              {showUserMenu && (
                <>
                  {/* backdrop to close menu */}
                  <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowUserMenu(false)} />
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 100,
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.2)', minWidth: 200, padding: '8px 0',
                  }}>
                    <div style={{ padding: '8px 14px 10px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{authUser.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{authUser.email}</div>
                    </div>
                    <button
                      style={{
                        width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none',
                        border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      onClick={async () => {
                        setShowUserMenu(false);
                        if (!confirm(`Đăng xuất khỏi tài khoản ${authUser.email}?`)) return;
                        await logout();
                        setAuthUser(null);
                        setNeedLogin(true);
                      }}
                    >
                      Đăng xuất
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
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
        {needLogin ? (
          <LoginView
            agentServiceUrl={agentUrl}
            onLogin={user => {
              setAuthUser(user);
              setNeedLogin(false);
              setReady(false);
              initApp();
            }}
          />
        ) : setupMode ? (
          <SetupView
            mode={setupMode}
            agentServiceUrl={agentUrl}
            health={health}
            onConnectionDone={handleConnectionDone}
            onProviderDone={() => setSetupMode(null)}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {missingPermissions && (
              <div style={{
                padding: '8px 12px', background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
              }}>
                <span style={{ flex: 1, color: 'var(--text-primary)' }}>
                  Cấp quyền để agent tương tác với trang web
                </span>
                <button
                  style={{
                    padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600,
                  }}
                  onClick={async () => {
                    const granted = await new Promise<boolean>(r =>
                      chrome.permissions.request(missingPermissions!, r)
                    );
                    if (granted) setMissingPermissions(null);
                  }}
                >
                  Cho phép
                </button>
                <button
                  style={{ padding: '4px 6px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14 }}
                  onClick={() => setMissingPermissions(null)}
                  title="Bỏ qua"
                >✕</button>
              </div>
            )}
            <ChatView onOpenSettings={() => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
