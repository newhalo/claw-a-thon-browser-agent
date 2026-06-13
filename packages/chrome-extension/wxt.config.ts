import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: 'dist',
  manifest: {
    name: 'Browser Agent',
    description: 'MCP extension connecting to Claw-a-thon native server',
    version: '1.0.0',
    manifest_version: 3,
    minimum_chrome_version: '120',
    permissions: [
      'storage',
      'activeTab',
      'tabs',
      'scripting',
      'webNavigation',
      'windows',
      'sidePanel',
      'alarms',
      'bookmarks',
      'history',
      'downloads',
      'sessions',
      'tabGroups',
      'topSites',
      'notifications',
      'cookies',
      'clipboardRead',
      'clipboardWrite',
    ],
    host_permissions: [
      'http://*/*',
      'https://*/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ],
    background: {
      service_worker: 'entrypoints/background/index.ts',
      type: 'module',
    },
    side_panel: {
      default_path: 'entrypoints/sidepanel/index.html',
    },
    action: {
      default_title: 'Claw-a-thon MCP',
    },
    content_security_policy: {
      extension_pages:
         "script-src 'self'; object-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http: https:",
    },
  },
});
