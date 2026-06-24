import { defineConfig } from 'wxt';

const isDev = process.env.NODE_ENV === 'development';
const isInCompile = process.env.IN_COMPILE === 'true'

export default defineConfig({
  outDir: 'dist',
  manifest: {
    name: isDev && !isInCompile ? 'Browser Agent [DEV]' : 'Browser Agent',
    description: 'AI browser assistant powered by MCP — reads pages, fills forms, manages tabs & runs multi-step tasks with Claude, GPT-4, Gemini.',
    version: '1.1.0',
    manifest_version: 3,
    minimum_chrome_version: '120',
    // Pin extension ID for local dev so chrome.identity redirect URI is stable.
    // Generated from .dev-key.pem — fixed ID: bgkjjnggooljgppjidjfibnpaacaffop
    // Omitted in production: CWS assigns its own permanent ID.
    ...(isDev ? { key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArTQW2v4iYzX7IZ+G3iXck+GOdrlx0ul93L0tdjuPdIjorunqYNkcfqe8hioROmIDfElkvBokEqyeUjTRVsx6x/ggEmwtr65DDK3V0mJqkhNpVyoF5/DLAradP11nm317rhg8qw8QRnWnWQotYwsVe/0SGpavlLaFNwX2bkhCniblzV0b6v7S65/x76+898GP1jsfcaLwO7LQHuh2c3rt/DuN1tVkJjdotWzJbMSRJ3TMonuf0nMjG4L1JbTvb+xTOmC7MOViPWpXwxFi8qxt0qANDOQQOI8O0U8GUB/vXKqEa1GkgoWRjG5vGfu4PxUiN3+Ie+Zzrlp48iXJXtedlwIDAQAB' } : {}),
    permissions: [
      'storage',
      'activeTab',
      'tabs',
      'scripting',
      'webNavigation',
      'windows',
      'sidePanel',
      'identity',
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
      '<all_urls>',
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
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'Claw-a-thon MCP',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    content_security_policy: {
      extension_pages:
         "script-src 'self'; object-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http: https:",
    },
  },
});
