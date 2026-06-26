/**
 * Extension background service worker.
 * Handles:
 *  - HTTP provider relay to the gateway (browser tools + website tools)
 *  - Content-script port connections for page MCP servers
 *  - Sidepanel messaging
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Resize a screenshot dataUrl to max 1280px wide and convert to JPEG 85%.
 * Dramatically reduces token cost when passed to vision LLMs.
 * Uses OffscreenCanvas + createImageBitmap — both available in MV3 service workers.
 */
async function resizeScreenshot(dataUrl: string, maxWidth = 1280): Promise<{ base64: string; mimeType: string }> {
  // fetch() doesn't support data: URLs in MV3 service workers — parse directly
  const comma = dataUrl.indexOf(',');
  const srcMime = dataUrl.slice(5, dataUrl.indexOf(';')) || 'image/png';
  const srcB64 = dataUrl.slice(comma + 1);
  const srcBinary = atob(srcB64);
  const srcBytes = new Uint8Array(srcBinary.length);
  for (let i = 0; i < srcBinary.length; i++) srcBytes[i] = srcBinary.charCodeAt(i);
  const blob = new Blob([srcBytes], { type: srcMime });
  const bitmap = await createImageBitmap(blob);

  const scale = Math.min(1, maxWidth / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  const buffer = await outBlob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Chunked btoa to avoid stack overflow on large images
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return { base64: btoa(binary), mimeType: 'image/jpeg' };
}

export default defineBackground({
  main() {
    // ─── Constants ───────────────────────────────────────────────────────────

    const REQUEST_TIMEOUT_MS = 15000;
    const MCP_SESSION_STORAGE_KEY = 'clawathon_mcp_session_id';
    const MCP_CLIENT_ID = 'extension';
    let mcpSessionId: string | null = null;
    let mcpRequestId = 1;
    let isProviderRunning = false;

    // ─── Sanitize tool names ─────────────────────────────────────────────────

    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();

    function extractDomain(url: string): string {
      try {
        const u = new URL(url);
        const h = u.hostname;
        return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
          ? `localhost_${u.port || '80'}`
          : h;
      } catch { return 'unknown'; }
    }

    // ─── Tool risk & defaults ────────────────────────────────────────────────
    //
    // CRITICAL (🔴): can exfiltrate auth/session data or execute arbitrary code
    // HIGH     (🟠): exposes private data, causes irreversible destruction, or
    //                downloads arbitrary files to disk
    // All other tools default to ON (low/medium risk, reversible or read-only).

    type RiskLevel = 'critical' | 'high' | 'low';

    const TOOL_RISK: Record<string, RiskLevel> = {
      // Arbitrary JS execution
      browser_execute_script:     'critical',
      // Cookies — auth tokens, session hijacking
      browser_get_cookies:        'critical',
      browser_set_cookie:         'critical',
      browser_delete_cookie:      'high',
      // Page storage — auth tokens, JWT, sensitive app state
      browser_get_local_storage:  'critical',
      browser_set_local_storage:  'critical',
      browser_get_session_storage:'critical',
      // Forms — can expose password values visible in DOM
      browser_get_forms:          'high',
      // Browsing history — full privacy profile
      browser_search_history:     'high',
      browser_add_history:        'high',
      browser_delete_history:     'high',
      browser_get_top_sites:      'high',
      // Sessions — reveals recent browsing behaviour
      browser_get_recent_sessions:'high',
      browser_restore_session:    'high',
      // Downloads — writes arbitrary files to disk
      browser_download:           'high',
      // Bookmarks — full bookmark tree reveals browsing habits
      browser_get_bookmark_tree:  'high',
      browser_delete_bookmark:    'high',   // irreversible
      // Extension storage — clears all extension data (irreversible)
      browser_storage_clear:      'high',
      // Clipboard read — can capture passwords or sensitive text
      browser_clipboard_read:     'high',
      // Screenshot — useful for agent vision; user can disable if privacy-sensitive
      browser_take_screenshot:    'medium',
    };

    // Tools that are OFF by default; user can explicitly enable them.
    const DEFAULT_DISABLED = new Set(
      Object.keys(TOOL_RISK).filter((k) => TOOL_RISK[k] === 'critical' || TOOL_RISK[k] === 'high')
    );

    // Explicit user overrides: toolName → true (force on) | false (force off)
    const TOOL_SETTINGS_KEY = 'clawathon_tool_settings';
    let toolSettings = new Map<string, boolean>();

    const loadToolSettings = async () => {
      const data = await chrome.storage.sync.get(TOOL_SETTINGS_KEY);
      const obj = data[TOOL_SETTINGS_KEY] || {};
      toolSettings = new Map(Object.entries(obj) as [string, boolean][]);
    };

    const saveToolSettings = async () => {
      await chrome.storage.sync.set({ [TOOL_SETTINGS_KEY]: Object.fromEntries(toolSettings) });
    };

    const isToolEnabled = (toolName: string): boolean => {
      if (toolSettings.has(toolName)) return toolSettings.get(toolName)!;
      return !DEFAULT_DISABLED.has(toolName);
    };

    const setToolEnabled = async (toolName: string, enabled: boolean) => {
      // If user sets the tool back to its default, remove the override to keep storage clean
      if (enabled === !DEFAULT_DISABLED.has(toolName)) toolSettings.delete(toolName);
      else toolSettings.set(toolName, enabled);
      await saveToolSettings();
      await reRegisterProvider();
    };

    // ─── Tab tool tracking ───────────────────────────────────────────────────

    interface TabEntry {
      tabId: number;
      domain: string;
      url: string;
      tools: Tool[];
      port: chrome.runtime.Port;
    }

    // tabId → entry
    const tabEntries = new Map<number, TabEntry>();
    // prefixed tool name → { tabId, originalName }
    const webToolIndex = new Map<string, { tabId: number; originalName: string }>();
    // requestId → resolve for pending website tool calls
    const pendingWebCalls = new Map<string, (data: { success: boolean; payload: unknown }) => void>();

    let activeTabId: number | null = null;

    function shortDomain(domain: string): string {
      // Take last 2 hostname segments to keep name short (e.g. "zalopay_vn" from "qc-events-tool.zalopay.vn")
      const parts = domain.split('.').filter(Boolean);
      return sanitize(parts.slice(-2).join('.'));
    }

    function prefixedName(entry: TabEntry, originalName: string): string {
      return `wt_${shortDomain(entry.domain)}_t${entry.tabId}_${sanitize(originalName)}`;
    }

    function registerTabTools(entry: TabEntry) {
      for (const tool of entry.tools) {
        webToolIndex.set(prefixedName(entry, tool.name), {
          tabId: entry.tabId,
          originalName: tool.name,
        });
      }
    }

    function unregisterTabTools(entry: TabEntry) {
      for (const tool of entry.tools) {
        webToolIndex.delete(prefixedName(entry, tool.name));
      }
    }

    function buildWebsiteTools(entry: TabEntry): Tool[] {
      const isActive = entry.tabId === activeTabId;
      const statusLabel = isActive ? 'Active Tab' : 'Tab';
      return entry.tools.map((tool) => ({
        name: prefixedName(entry, tool.name),
        description: `[${entry.domain} • ${statusLabel}] ${tool.description || ''}`,
        inputSchema: tool.inputSchema,
      }));
    }

    function allTools(): Tool[] {
      const website: Tool[] = [];
      for (const entry of tabEntries.values()) {
        website.push(...buildWebsiteTools(entry));
      }
      return [...browserTools, ...website].filter((t) => isToolEnabled(t.name));
    }

    async function reRegisterProvider() {
      if (!isProviderRunning) return;
      try {
        await requestNativeServer('/provider/register', {
          method: 'POST',
          body: JSON.stringify({ tools: allTools() }),
        });
      } catch { /* silent - provider will pick it up on next list_tools */ }
    }

    // ─── Content-script port connections ────────────────────────────────────

    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== 'mcp-content-script-proxy') return;

      const tabId = port.sender?.tab?.id;
      const url = port.sender?.tab?.url || '';
      if (!tabId) return;

      const domain = extractDomain(url);

      port.onMessage.addListener(async (message: any) => {
        if (message.type === 'register-tools' && Array.isArray(message.tools)) {
          const existing = tabEntries.get(tabId);
          if (existing) unregisterTabTools(existing);

          const entry: TabEntry = { tabId, domain, url, tools: message.tools, port };
          tabEntries.set(tabId, entry);
          registerTabTools(entry);
          void reRegisterProvider();
        }

        if (message.type === 'tools-updated' && Array.isArray(message.tools)) {
          const existing = tabEntries.get(tabId);
          if (existing) unregisterTabTools(existing);

          const entry: TabEntry = { tabId, domain, url, tools: message.tools, port };
          tabEntries.set(tabId, entry);
          registerTabTools(entry);
          void reRegisterProvider();
        }

        if (message.type === 'tool-result' && message.requestId) {
          const resolve = pendingWebCalls.get(message.requestId);
          if (resolve) {
            pendingWebCalls.delete(message.requestId);
            resolve(message.data);
          }
        }
      });

      port.onDisconnect.addListener(() => {
        const entry = tabEntries.get(tabId);
        if (entry) {
          unregisterTabTools(entry);
          tabEntries.delete(tabId);
          void reRegisterProvider();
        }
      });
    });

    // Track active tab and notify sidepanel for skill auto-suggest
    const notifyTabChanged = (url: string) => {
      chrome.runtime.sendMessage({ type: 'ACTIVE_TAB_CHANGED', url }).catch(() => {});
    };

    chrome.tabs.onActivated.addListener((info) => {
      activeTabId = info.tabId;
      chrome.tabs.get(info.tabId, (tab) => {
        if (tab?.url) notifyTabChanged(tab.url);
      });
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (tabId === activeTabId && changeInfo.status === 'complete' && tab.url) {
        notifyTabChanged(tab.url);
      }
    });

    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs[0]?.id) activeTabId = tabs[0].id;
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      const entry = tabEntries.get(tabId);
      if (entry) {
        unregisterTabTools(entry);
        tabEntries.delete(tabId);
        void reRegisterProvider();
      }
    });

    // ─── Browser tools ───────────────────────────────────────────────────────

    const browserTools: Tool[] = [
      // ── Tabs ────────────────────────────────────────────────────────────────
      { name: 'browser_get_active_tab', description: 'Get info about the currently active tab (id, url, title, windowId).', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
      { name: 'browser_get_page_info', description: 'Get URL, title, and loading status of a tab. Defaults to active tab.', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' } } } },
      { name: 'browser_list_tabs', description: 'List open tabs. Optionally filter by windowId or URL match pattern.', inputSchema: { type: 'object', additionalProperties: false, properties: { windowId: { type: 'number' }, url: { type: 'string', description: 'URL match pattern, e.g. "*://example.com/*"' } } } },
      { name: 'browser_focus_tab', description: 'Switch to a tab and focus its window.', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' } } } },
      { name: 'browser_close_tab', description: 'Close a browser tab.', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' } } } },
      { name: 'browser_reload_tab', description: 'Reload a tab, optionally bypassing cache.', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' }, bypassCache: { type: 'boolean' } } } },
      { name: 'browser_duplicate_tab', description: 'Duplicate a browser tab.', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' } } } },
      { name: 'browser_pin_tab', description: 'Pin or unpin a tab. Omit pinned to toggle.', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' }, pinned: { type: 'boolean' } } } },
      { name: 'browser_mute_tab', description: 'Mute or unmute a tab. Omit muted to toggle.', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' }, muted: { type: 'boolean' } } } },
      { name: 'browser_move_tab', description: 'Move a tab to a position index within a window.', inputSchema: { type: 'object', additionalProperties: false, required: ['index'], properties: { tabId: { type: 'number' }, index: { type: 'number', description: '0-based position. -1 = last.' }, windowId: { type: 'number' } } } },
      { name: 'browser_discard_tab', description: 'Discard a tab to free memory (tab stays in strip but unloads content).', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' } } } },
      { name: 'browser_set_zoom', description: 'Set zoom level of a tab (1.0 = 100%, 0 resets to default).', inputSchema: { type: 'object', additionalProperties: false, required: ['zoomFactor'], properties: { tabId: { type: 'number' }, zoomFactor: { type: 'number' } } } },
      { name: 'browser_get_zoom', description: 'Get the current zoom level of a tab.', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' } } } },
      // ── Windows ─────────────────────────────────────────────────────────────
      { name: 'browser_list_windows', description: 'List all open browser windows with basic info and tab count.', inputSchema: { type: 'object', additionalProperties: false, properties: { populate: { type: 'boolean', description: 'Include tab list per window (default false).' } } } },
      { name: 'browser_create_window', description: 'Open a new browser window, optionally navigating to a URL.', inputSchema: { type: 'object', additionalProperties: false, properties: { url: { type: 'string' }, incognito: { type: 'boolean' }, state: { type: 'string', enum: ['normal', 'maximized', 'minimized', 'fullscreen'] } } } },
      { name: 'browser_close_window', description: 'Close a browser window and all its tabs.', inputSchema: { type: 'object', additionalProperties: false, properties: { windowId: { type: 'number', description: 'Defaults to focused window.' } } } },
      { name: 'browser_update_window', description: 'Resize, reposition, or change state (maximize/minimize/fullscreen) of a window.', inputSchema: { type: 'object', additionalProperties: false, properties: { windowId: { type: 'number' }, state: { type: 'string', enum: ['normal', 'maximized', 'minimized', 'fullscreen'] }, width: { type: 'number' }, height: { type: 'number' }, left: { type: 'number' }, top: { type: 'number' } } } },
      // ── Navigation ──────────────────────────────────────────────────────────
      { name: 'browser_navigate', description: 'Navigate a tab to a URL. Opens a new tab if newTab is true.', inputSchema: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string' }, tabId: { type: 'number' }, newTab: { type: 'boolean' } } } },
      { name: 'browser_go_back', description: 'Navigate back in the tab history.', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' } } } },
      { name: 'browser_go_forward', description: 'Navigate forward in the tab history.', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' } } } },
      // ── Bookmarks ────────────────────────────────────────────────────────────
      { name: 'browser_search_bookmarks', description: 'Search bookmarks by text query (matches title or URL).', inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' } } } },
      { name: 'browser_get_bookmark_tree', description: 'Get the full bookmark tree (folders and bookmarks).', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
      { name: 'browser_create_bookmark', description: 'Create a bookmark or folder. Omit url to create a folder.', inputSchema: { type: 'object', additionalProperties: false, properties: { url: { type: 'string' }, title: { type: 'string' }, parentId: { type: 'string', description: 'Parent folder id. Defaults to "Other Bookmarks".' } } } },
      { name: 'browser_delete_bookmark', description: 'Delete a bookmark or folder by id.', inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' }, recursive: { type: 'boolean', description: 'true to delete folder and all children.' } } } },
      // ── History ──────────────────────────────────────────────────────────────
      { name: 'browser_search_history', description: 'Search browser history by text query.', inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, maxResults: { type: 'number', description: 'Default 20.' }, startTime: { type: 'number', description: 'Unix ms.' }, endTime: { type: 'number' } } } },
      { name: 'browser_add_history', description: 'Add a URL to the browser history.', inputSchema: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string' }, title: { type: 'string' } } } },
      { name: 'browser_delete_history', description: 'Delete a URL from history, or all history in a time range.', inputSchema: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', description: 'Specific URL to delete.' }, startTime: { type: 'number', description: 'Range start Unix ms.' }, endTime: { type: 'number', description: 'Range end Unix ms.' } } } },
      { name: 'browser_get_top_sites', description: 'Get the top most-visited sites.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
      // ── Downloads ────────────────────────────────────────────────────────────
      { name: 'browser_download', description: 'Download a file from a URL.', inputSchema: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string' }, filename: { type: 'string', description: 'Suggested filename.' }, conflictAction: { type: 'string', enum: ['uniquify', 'overwrite', 'prompt'] }, saveAs: { type: 'boolean' } } } },
      { name: 'browser_list_downloads', description: 'List recent downloads, optionally filtered by state or filename.', inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', description: 'Filename search.' }, state: { type: 'string', enum: ['in_progress', 'interrupted', 'complete'] }, limit: { type: 'number', description: 'Max results (default 20).' } } } },
      { name: 'browser_cancel_download', description: 'Cancel an in-progress download.', inputSchema: { type: 'object', additionalProperties: false, required: ['downloadId'], properties: { downloadId: { type: 'number' } } } },
      { name: 'browser_open_download', description: 'Open a completed downloaded file.', inputSchema: { type: 'object', additionalProperties: false, required: ['downloadId'], properties: { downloadId: { type: 'number' } } } },
      { name: 'browser_erase_download', description: 'Remove a download record from the list (does not delete the file).', inputSchema: { type: 'object', additionalProperties: false, properties: { downloadId: { type: 'number', description: 'Omit to erase all completed.' } } } },
      // ── Storage (chrome.storage — extension storage) ──────────────────────────
      { name: 'browser_storage_get', description: 'Read values from chrome.storage (extension storage, NOT the web page localStorage).', inputSchema: { type: 'object', additionalProperties: false, properties: { keys: { description: 'Key string or array of keys. Omit to get all.' }, area: { type: 'string', enum: ['local', 'sync', 'session'], description: 'Default: local.' } } } },
      { name: 'browser_storage_set', description: 'Write key-value pairs to chrome.storage.', inputSchema: { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'object' }, area: { type: 'string', enum: ['local', 'sync', 'session'] } } } },
      { name: 'browser_storage_remove', description: 'Remove keys from chrome.storage.', inputSchema: { type: 'object', additionalProperties: false, required: ['keys'], properties: { keys: { description: 'Key or array of keys.' }, area: { type: 'string', enum: ['local', 'sync', 'session'] } } } },
      { name: 'browser_storage_clear', description: 'Clear all data from a chrome.storage area.', inputSchema: { type: 'object', additionalProperties: false, properties: { area: { type: 'string', enum: ['local', 'sync', 'session'] } } } },
      // ── Sessions ─────────────────────────────────────────────────────────────
      { name: 'browser_get_recent_sessions', description: 'Get recently closed tabs and windows that can be restored.', inputSchema: { type: 'object', additionalProperties: false, properties: { maxResults: { type: 'number', description: 'Default 10, max 25.' } } } },
      { name: 'browser_restore_session', description: 'Restore a recently closed tab or window by its session id.', inputSchema: { type: 'object', additionalProperties: false, required: ['sessionId'], properties: { sessionId: { type: 'string' } } } },
      // ── Tab Groups ───────────────────────────────────────────────────────────
      { name: 'browser_group_tabs', description: 'Group tabs into a tab group. Creates new group if groupId is omitted.', inputSchema: { type: 'object', additionalProperties: false, required: ['tabIds'], properties: { tabIds: { type: 'array', items: { type: 'number' } }, groupId: { type: 'number' }, title: { type: 'string' }, color: { type: 'string', enum: ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] } } } },
      { name: 'browser_ungroup_tabs', description: 'Remove tabs from their tab group.', inputSchema: { type: 'object', additionalProperties: false, required: ['tabIds'], properties: { tabIds: { type: 'array', items: { type: 'number' } } } } },
      { name: 'browser_list_tab_groups', description: 'List all tab groups across all windows.', inputSchema: { type: 'object', additionalProperties: false, properties: { windowId: { type: 'number' } } } },
      { name: 'browser_update_tab_group', description: 'Update a tab group title, color, or collapsed state.', inputSchema: { type: 'object', additionalProperties: false, required: ['groupId'], properties: { groupId: { type: 'number' }, title: { type: 'string' }, color: { type: 'string', enum: ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] }, collapsed: { type: 'boolean' } } } },
      // ── Cookies ──────────────────────────────────────────────────────────────
      { name: 'browser_get_cookies', description: 'Get cookies for a URL, optionally filtered by name or domain.', inputSchema: { type: 'object', additionalProperties: false, properties: { url: { type: 'string' }, name: { type: 'string' }, domain: { type: 'string' } } } },
      { name: 'browser_set_cookie', description: 'Set or update a cookie.', inputSchema: { type: 'object', additionalProperties: false, required: ['url', 'name', 'value'], properties: { url: { type: 'string' }, name: { type: 'string' }, value: { type: 'string' }, domain: { type: 'string' }, path: { type: 'string' }, secure: { type: 'boolean' }, httpOnly: { type: 'boolean' }, expirationDate: { type: 'number', description: 'Unix timestamp.' } } } },
      { name: 'browser_delete_cookie', description: 'Delete a cookie by URL and name.', inputSchema: { type: 'object', additionalProperties: false, required: ['url', 'name'], properties: { url: { type: 'string' }, name: { type: 'string' } } } },
      // ── Page interaction ─────────────────────────────────────────────────────
      { name: 'browser_click', description: 'Click the first DOM element matching a CSS selector.', inputSchema: { type: 'object', additionalProperties: false, required: ['selector'], properties: { selector: { type: 'string' }, tabId: { type: 'number' } } } },
      { name: 'browser_double_click', description: 'Double-click a DOM element.', inputSchema: { type: 'object', additionalProperties: false, required: ['selector'], properties: { selector: { type: 'string' }, tabId: { type: 'number' } } } },
      { name: 'browser_right_click', description: 'Right-click (contextmenu event) on a DOM element.', inputSchema: { type: 'object', additionalProperties: false, required: ['selector'], properties: { selector: { type: 'string' }, tabId: { type: 'number' } } } },
      { name: 'browser_hover', description: 'Trigger mouseover/mouseenter events on an element.', inputSchema: { type: 'object', additionalProperties: false, required: ['selector'], properties: { selector: { type: 'string' }, tabId: { type: 'number' } } } },
      { name: 'browser_type', description: 'Type text into an input or textarea (React-compatible via native value setter).', inputSchema: { type: 'object', additionalProperties: false, required: ['selector', 'text'], properties: { selector: { type: 'string' }, text: { type: 'string' }, clearFirst: { type: 'boolean', description: 'Clear existing value first (default true).' }, tabId: { type: 'number' } } } },
      { name: 'browser_select_option', description: 'Select an option in a <select> dropdown by value or visible label.', inputSchema: { type: 'object', additionalProperties: false, required: ['selector'], properties: { selector: { type: 'string' }, value: { type: 'string' }, label: { type: 'string' }, tabId: { type: 'number' } } } },
      { name: 'browser_check_element', description: 'Check or uncheck a checkbox/radio button. Omit checked to toggle.', inputSchema: { type: 'object', additionalProperties: false, required: ['selector'], properties: { selector: { type: 'string' }, checked: { type: 'boolean' }, tabId: { type: 'number' } } } },
      { name: 'browser_scroll', description: 'Scroll page by pixel delta or scroll an element into view.', inputSchema: { type: 'object', additionalProperties: false, properties: { selector: { type: 'string', description: 'Scroll element into view.' }, x: { type: 'number' }, y: { type: 'number' }, behavior: { type: 'string', enum: ['smooth', 'instant'] }, tabId: { type: 'number' } } } },
      { name: 'browser_focus_element', description: 'Focus an element by CSS selector.', inputSchema: { type: 'object', additionalProperties: false, required: ['selector'], properties: { selector: { type: 'string' }, tabId: { type: 'number' } } } },
      { name: 'browser_press_key', description: 'Dispatch keyboard events. Supports modifiers: ctrl, shift, alt, meta/cmd.', inputSchema: { type: 'object', additionalProperties: false, required: ['key'], properties: { key: { type: 'string', description: 'e.g. Enter, Tab, ArrowDown, a' }, selector: { type: 'string', description: 'Target element. Defaults to active element.' }, modifiers: { type: 'array', items: { type: 'string' } }, tabId: { type: 'number' } } } },
      { name: 'browser_set_attribute', description: 'Set or remove a DOM attribute on an element.', inputSchema: { type: 'object', additionalProperties: false, required: ['selector', 'attribute'], properties: { selector: { type: 'string' }, attribute: { type: 'string' }, value: { type: 'string', description: 'Omit to remove the attribute.' }, tabId: { type: 'number' } } } },
      // ── Page content ─────────────────────────────────────────────────────────
      { name: 'browser_get_page_content', description: 'Get page content as plain text, outer HTML, or inner HTML.', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' }, format: { type: 'string', enum: ['text', 'html', 'innerhtml'], description: 'Default: text.' } } } },
      { name: 'browser_get_page_metadata', description: 'Get page metadata: title, description, Open Graph tags, canonical URL, language.', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' } } } },
      { name: 'browser_find_elements', description: 'Find DOM elements by CSS selector. Returns tag, id, text, value, rect, visibility.', inputSchema: { type: 'object', additionalProperties: false, required: ['selector'], properties: { selector: { type: 'string' }, tabId: { type: 'number' }, limit: { type: 'number', description: 'Max elements to return (default 50).' } } } },
      { name: 'browser_get_element_text', description: 'Get the text content of the first element matching a CSS selector.', inputSchema: { type: 'object', additionalProperties: false, required: ['selector'], properties: { selector: { type: 'string' }, tabId: { type: 'number' } } } },
      { name: 'browser_get_links', description: 'Get all hyperlinks on the page (href, text, rel). Optionally filter by URL pattern.', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' }, filter: { type: 'string', description: 'Filter links whose href contains this string.' } } } },
      { name: 'browser_get_forms', description: 'Get all forms on the page with their input fields and current values.', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' } } } },
      { name: 'browser_get_computed_style', description: 'Get CSS computed style of a DOM element.', inputSchema: { type: 'object', additionalProperties: false, required: ['selector'], properties: { selector: { type: 'string' }, properties: { type: 'array', items: { type: 'string' }, description: 'CSS property names to read. Omit for a common set.' }, tabId: { type: 'number' } } } },
      { name: 'browser_wait_for_element', description: 'Wait until a CSS selector matches an element in the page.', inputSchema: { type: 'object', additionalProperties: false, required: ['selector'], properties: { selector: { type: 'string' }, timeoutMs: { type: 'number', description: 'Default 10000ms.' }, tabId: { type: 'number' } } } },
      // ── Page storage (web-page context) ──────────────────────────────────────
      { name: 'browser_get_local_storage', description: 'Read values from the web page localStorage (NOT extension storage).', inputSchema: { type: 'object', additionalProperties: false, properties: { key: { type: 'string', description: 'Specific key. Omit to get all.' }, tabId: { type: 'number' } } } },
      { name: 'browser_set_local_storage', description: 'Write a value to the web page localStorage.', inputSchema: { type: 'object', additionalProperties: false, required: ['key', 'value'], properties: { key: { type: 'string' }, value: { type: 'string' }, tabId: { type: 'number' } } } },
      { name: 'browser_get_session_storage', description: 'Read values from the web page sessionStorage.', inputSchema: { type: 'object', additionalProperties: false, properties: { key: { type: 'string', description: 'Specific key. Omit to get all.' }, tabId: { type: 'number' } } } },
      // ── Scripting ─────────────────────────────────────────────────────────────
      { name: 'browser_execute_script', description: 'Execute arbitrary JavaScript in the page context and return the result.', inputSchema: { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string' }, tabId: { type: 'number' } } } },
      { name: 'browser_inject_css', description: 'Inject CSS styles into a page.', inputSchema: { type: 'object', additionalProperties: false, required: ['css'], properties: { css: { type: 'string' }, tabId: { type: 'number' } } } },
      { name: 'browser_clipboard_write', description: 'Write text to the clipboard (tab must be active/focused).', inputSchema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' }, tabId: { type: 'number' } } } },
      { name: 'browser_clipboard_read', description: 'Read text from the clipboard (tab must be focused and user must have granted clipboard-read permission).', inputSchema: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'number' } } } },
      // ── Media ─────────────────────────────────────────────────────────────────
      { name: 'browser_take_screenshot', description: 'Capture a PNG screenshot of the visible area of a window.', inputSchema: { type: 'object', additionalProperties: false, properties: { windowId: { type: 'number' } } } },
      // ── Notifications ─────────────────────────────────────────────────────────
      { name: 'browser_notify', description: 'Show a Chrome desktop notification.', inputSchema: { type: 'object', additionalProperties: false, required: ['title', 'message'], properties: { title: { type: 'string' }, message: { type: 'string' }, iconUrl: { type: 'string' } } } },
    ];

    // ─── Browser tool category map (for sidepanel grouping) ──────────────────

    const BROWSER_TOOL_CATEGORIES: Record<string, string[]> = {
      tabs: ['browser_get_active_tab', 'browser_get_page_info', 'browser_list_tabs', 'browser_focus_tab', 'browser_close_tab', 'browser_reload_tab', 'browser_duplicate_tab', 'browser_pin_tab', 'browser_mute_tab', 'browser_move_tab', 'browser_discard_tab', 'browser_set_zoom', 'browser_get_zoom'],
      windows: ['browser_list_windows', 'browser_create_window', 'browser_close_window', 'browser_update_window'],
      navigation: ['browser_navigate', 'browser_go_back', 'browser_go_forward'],
      bookmarks: ['browser_search_bookmarks', 'browser_get_bookmark_tree', 'browser_create_bookmark', 'browser_delete_bookmark'],
      history: ['browser_search_history', 'browser_add_history', 'browser_delete_history', 'browser_get_top_sites'],
      downloads: ['browser_download', 'browser_list_downloads', 'browser_cancel_download', 'browser_open_download', 'browser_erase_download'],
      storage: ['browser_storage_get', 'browser_storage_set', 'browser_storage_remove', 'browser_storage_clear'],
      sessions: ['browser_get_recent_sessions', 'browser_restore_session'],
      groups: ['browser_group_tabs', 'browser_ungroup_tabs', 'browser_list_tab_groups', 'browser_update_tab_group'],
      cookies: ['browser_get_cookies', 'browser_set_cookie', 'browser_delete_cookie'],
      interaction: ['browser_click', 'browser_double_click', 'browser_right_click', 'browser_hover', 'browser_type', 'browser_select_option', 'browser_check_element', 'browser_scroll', 'browser_focus_element', 'browser_press_key', 'browser_set_attribute'],
      page: ['browser_get_page_content', 'browser_get_page_metadata', 'browser_find_elements', 'browser_get_element_text', 'browser_get_links', 'browser_get_forms', 'browser_get_computed_style', 'browser_wait_for_element', 'browser_get_local_storage', 'browser_set_local_storage', 'browser_get_session_storage'],
      scripting: ['browser_execute_script', 'browser_inject_css', 'browser_clipboard_write', 'browser_clipboard_read'],
      media: ['browser_take_screenshot'],
      notifications: ['browser_notify'],
    };

    // ─── Tab helpers ─────────────────────────────────────────────────────────

    const getActiveTab = async () => new Promise<chrome.tabs.Tab>((resolve, reject) => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const err = chrome.runtime.lastError?.message;
        if (err) { reject(new Error(err)); return; }
        const tab = tabs[0];
        if (!tab || tab.id === undefined) { reject(new Error('No active tab found')); return; }
        resolve(tab);
      });
    });

    const getTabById = async (tabId: number) => new Promise<chrome.tabs.Tab>((resolve, reject) => {
      chrome.tabs.get(tabId, (tab) => {
        const err = chrome.runtime.lastError?.message;
        if (err) { reject(new Error(err)); return; }
        resolve(tab);
      });
    });

    const resolveTab = async (tabId?: number) => tabId ? getTabById(tabId) : getActiveTab();
    const resolveTabId = async (tabId?: number) => {
      const tab = await resolveTab(tabId);
      if (tab.id === undefined) throw new Error('Tab has no id');
      return tab.id;
    };

    // ─── Script injection helper ─────────────────────────────────────────────

    const injectScript = async <T>(tabId: number, func: (...args: any[]) => T, args: unknown[] = []): Promise<T> => {
      const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
      if (!results?.length) throw new Error('Script returned no result');
      if (results[0].error) throw new Error(String(results[0].error));
      return results[0].result as T;
    };

    // ─── Browser tool executor ───────────────────────────────────────────────

    const executeBrowserTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      switch (name) {
        case 'browser_get_active_tab': {
          const t = await getActiveTab();
          return { tabId: t.id, url: t.url || '', title: t.title || '', windowId: t.windowId };
        }
        case 'browser_get_page_info': {
          const t = await resolveTab(args.tabId as number | undefined);
          return { tabId: t.id, url: t.url || '', title: t.title || '', status: t.status || 'unknown' };
        }
        // browser_list_tabs handled below with filters
        case 'browser_navigate': {
          const rawUrl = String(args.url || '').trim();
          if (!rawUrl) throw new Error('Missing required argument: url');
          const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
          if (Boolean(args.newTab)) {
            const t = await new Promise<chrome.tabs.Tab>((res, rej) => chrome.tabs.create({ url }, (t) => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(t!)));
            return { navigated: true, tabId: t.id, url: t.url || url };
          }
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const t = await new Promise<chrome.tabs.Tab>((res, rej) => chrome.tabs.update(tabId, { url }, (t) => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(t!)));
          return { navigated: true, tabId: t.id, url: t.url || url };
        }
        case 'browser_focus_tab': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          await chrome.tabs.update(tabId, { active: true });
          const t = await getTabById(tabId);
          await chrome.windows.update(t.windowId, { focused: true });
          return { focused: true, tabId };
        }
        case 'browser_close_tab': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          await chrome.tabs.remove(tabId);
          return { closed: true, tabId };
        }
        case 'browser_reload_tab': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          await chrome.tabs.reload(tabId, { bypassCache: Boolean(args.bypassCache) });
          return { reloaded: true, tabId };
        }
        case 'browser_go_back': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          await chrome.tabs.goBack(tabId);
          return { success: true };
        }
        case 'browser_go_forward': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          await chrome.tabs.goForward(tabId);
          return { success: true };
        }
        case 'browser_take_screenshot': {
          // captureVisibleTab requires <all_urls> when not triggered by user gesture.
          // Pass windowId only when explicitly specified; otherwise capture current window.
          const inputWin = Number(args.windowId);
          const captureArgs: [number | undefined, chrome.tabs.CaptureVisibleTabOptions] = [
            Number.isFinite(inputWin) ? inputWin : undefined,
            { format: 'png' },
          ];
          const dataUrl = await new Promise<string>((res, rej) =>
            chrome.tabs.captureVisibleTab(...captureArgs, (url) =>
              chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(url!)));
          return { mimeType: 'image/png', dataUrl };
        }
        case 'browser_get_page_content': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const fmt = String(args.format || 'text');
          const content = await injectScript(tabId, (f: string) => {
            if (f === 'html') return document.documentElement.outerHTML;
            if (f === 'innerhtml') return document.body.innerHTML;
            return (document.body as HTMLElement).innerText || document.body.textContent || '';
          }, [fmt]);
          return { format: fmt, content: String(content || '') };
        }
        // browser_find_elements handled below with limit support
        case 'browser_get_element_text': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const sel = String(args.selector || '');
          if (!sel) throw new Error('Missing required argument: selector');
          const text = await injectScript(tabId, (s: string) => {
            const el = document.querySelector(s) as HTMLElement | null;
            if (!el) throw new Error(`Element not found: ${s}`);
            return el.innerText || el.textContent || '';
          }, [sel]);
          return { selector: sel, text: String(text || '') };
        }
        case 'browser_click': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const sel = String(args.selector || '');
          if (!sel) throw new Error('Missing required argument: selector');
          await injectScript(tabId, (s: string) => {
            const el = document.querySelector(s) as HTMLElement | null;
            if (!el) throw new Error(`Element not found: ${s}`);
            el.scrollIntoView({ block: 'center' }); el.click();
          }, [sel]);
          return { clicked: true, selector: sel };
        }
        case 'browser_hover': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const sel = String(args.selector || '');
          if (!sel) throw new Error('Missing required argument: selector');
          await injectScript(tabId, (s: string) => {
            const el = document.querySelector(s) as HTMLElement | null;
            if (!el) throw new Error(`Element not found: ${s}`);
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
          }, [sel]);
          return { hovered: true, selector: sel };
        }
        case 'browser_type': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const sel = String(args.selector || '');
          const text = String(args.text ?? '');
          const clear = args.clearFirst !== false;
          await injectScript(tabId, (s: string, txt: string, clr: boolean) => {
            const el = document.querySelector(s) as HTMLInputElement | HTMLTextAreaElement | null;
            if (!el) throw new Error(`Element not found: ${s}`);
            el.focus();
            if (clr) {
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              setter ? setter.call(el, txt) : (el.value = txt);
            } else { el.value += txt; }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, [sel, text, clear]);
          return { typed: true, selector: sel, text };
        }
        case 'browser_select_option': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const sel = String(args.selector || '');
          if (!sel) throw new Error('Missing required argument: selector');
          const val = args.value !== undefined ? String(args.value) : null;
          const lbl = args.label !== undefined ? String(args.label) : null;
          if (!val && !lbl) throw new Error('Either value or label is required');
          const opt = await injectScript(tabId, (s: string, v: string | null, l: string | null) => {
            const sel = document.querySelector(s) as HTMLSelectElement | null;
            if (!sel) throw new Error(`Select not found: ${s}`);
            const o = Array.from(sel.options).find((o) => (v && o.value === v) || (l && o.text.trim() === l));
            if (!o) throw new Error(`Option not found: ${v || l}`);
            sel.value = o.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return { value: o.value, text: o.text };
          }, [sel, val, lbl]);
          return { selected: true, selector: sel, option: opt };
        }
        case 'browser_scroll': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const selector = args.selector ? String(args.selector) : null;
          const sx = Number(args.x ?? 0), sy = Number(args.y ?? 0);
          const beh = String(args.behavior || 'smooth') as ScrollBehavior;
          await injectScript(tabId, (s: string | null, x: number, y: number, b: ScrollBehavior) => {
            if (s) { const el = document.querySelector(s); if (!el) throw new Error(`Element not found: ${s}`); el.scrollIntoView({ behavior: b, block: 'center' }); }
            else window.scrollBy({ left: x, top: y, behavior: b });
          }, [selector, sx, sy, beh]);
          return { scrolled: true, selector, x: sx, y: sy };
        }
        case 'browser_focus_element': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const sel = String(args.selector || '');
          if (!sel) throw new Error('Missing required argument: selector');
          await injectScript(tabId, (s: string) => { const el = document.querySelector(s) as HTMLElement | null; if (!el) throw new Error(`Element not found: ${s}`); el.focus(); }, [sel]);
          return { focused: true, selector: sel };
        }
        case 'browser_press_key': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const key = String(args.key || '');
          if (!key) throw new Error('Missing required argument: key');
          const sel = args.selector ? String(args.selector) : null;
          const mods = (args.modifiers || []) as string[];
          await injectScript(tabId, (s: string | null, k: string, m: string[]) => {
            const tgt = s ? document.querySelector(s) as HTMLElement : document.activeElement as HTMLElement;
            if (!tgt) return;
            const init = { key: k, bubbles: true, cancelable: true, ctrlKey: m.includes('ctrl'), shiftKey: m.includes('shift'), altKey: m.includes('alt'), metaKey: m.includes('meta') || m.includes('cmd') };
            tgt.dispatchEvent(new KeyboardEvent('keydown', init));
            tgt.dispatchEvent(new KeyboardEvent('keypress', init));
            tgt.dispatchEvent(new KeyboardEvent('keyup', init));
          }, [sel, key, mods]);
          return { pressed: true, key, selector: sel };
        }
        case 'browser_execute_script': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const code = String(args.code || '');
          if (!code) throw new Error('Missing required argument: code');
          const result = await injectScript(tabId, (c: string) => {
            return eval(`(async()=>{${c}})()`);
          }, [code]);
          return { result };
        }
        case 'browser_wait_for_element': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const sel = String(args.selector || '');
          if (!sel) throw new Error('Missing required argument: selector');
          const timeout = Number(args.timeoutMs ?? 10000);
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const found = await injectScript(tabId, (s: string) => {
              const el = document.querySelector(s);
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return { found: true, visible: r.width > 0 && r.height > 0 };
            }, [sel]);
            if (found) return { selector: sel, ...(found as object) };
            await new Promise((r) => setTimeout(r, 300));
          }
          throw new Error(`Element "${sel}" not found within ${timeout}ms`);
        }

        // ── Tabs (extended) ──────────────────────────────────────────────────
        case 'browser_list_tabs': {
          const q: chrome.tabs.QueryInfo = {};
          if (args.windowId) q.windowId = Number(args.windowId);
          if (args.url) q.url = String(args.url) as any;
          const tabs = await chrome.tabs.query(q);
          return tabs.map((t) => ({ tabId: t.id, windowId: t.windowId, url: t.url || '', title: t.title || '', active: t.active, pinned: t.pinned, muted: t.mutedInfo?.muted ?? false, status: t.status || 'unknown', groupId: t.groupId }));
        }
        case 'browser_duplicate_tab': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const t = await chrome.tabs.duplicate(tabId);
          return { duplicated: true, tabId: t?.id, url: t?.url || '' };
        }
        case 'browser_pin_tab': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const current = await getTabById(tabId);
          const pinned = args.pinned !== undefined ? Boolean(args.pinned) : !current.pinned;
          await chrome.tabs.update(tabId, { pinned });
          return { tabId, pinned };
        }
        case 'browser_mute_tab': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const current = await getTabById(tabId);
          const muted = args.muted !== undefined ? Boolean(args.muted) : !(current.mutedInfo?.muted ?? false);
          await chrome.tabs.update(tabId, { muted });
          return { tabId, muted };
        }
        case 'browser_move_tab': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const props: chrome.tabs.MoveProperties = { index: Number(args.index ?? -1) };
          if (args.windowId) props.windowId = Number(args.windowId);
          const moved = await chrome.tabs.move(tabId, props);
          return { tabId, index: (Array.isArray(moved) ? moved[0] : moved).index };
        }
        case 'browser_discard_tab': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          await chrome.tabs.discard(tabId);
          return { tabId, discarded: true };
        }
        case 'browser_set_zoom': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const factor = Number(args.zoomFactor ?? 1);
          await chrome.tabs.setZoom(tabId, factor);
          return { tabId, zoomFactor: factor };
        }
        case 'browser_get_zoom': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const factor = await chrome.tabs.getZoom(tabId);
          return { tabId, zoomFactor: factor };
        }

        // ── Windows ──────────────────────────────────────────────────────────
        case 'browser_list_windows': {
          const populate = args.populate !== false;
          const windows = await chrome.windows.getAll({ populate });
          return windows.map((w) => ({ windowId: w.id, state: w.state, focused: w.focused, incognito: w.incognito, tabCount: w.tabs?.length ?? 0, tabs: populate ? w.tabs?.map((t) => ({ tabId: t.id, url: t.url || '', title: t.title || '', active: t.active })) : undefined }));
        }
        case 'browser_create_window': {
          const createData: chrome.windows.CreateData = {};
          if (args.url) createData.url = String(args.url);
          if (args.incognito !== undefined) createData.incognito = Boolean(args.incognito);
          if (args.state) createData.state = String(args.state) as chrome.windows.windowStateEnum;
          const w = await chrome.windows.create(createData);
          return { windowId: w?.id, state: w?.state, tabCount: w?.tabs?.length ?? 0 };
        }
        case 'browser_close_window': {
          const windowId = args.windowId ? Number(args.windowId) : (await chrome.windows.getCurrent()).id!;
          await chrome.windows.remove(windowId);
          return { closed: true, windowId };
        }
        case 'browser_update_window': {
          const windowId = args.windowId ? Number(args.windowId) : (await chrome.windows.getCurrent()).id!;
          const upd: chrome.windows.UpdateInfo = {};
          if (args.state) upd.state = String(args.state) as chrome.windows.windowStateEnum;
          if (args.width) upd.width = Number(args.width);
          if (args.height) upd.height = Number(args.height);
          if (args.left !== undefined) upd.left = Number(args.left);
          if (args.top !== undefined) upd.top = Number(args.top);
          const w = await chrome.windows.update(windowId, upd);
          return { windowId, state: w.state, width: w.width, height: w.height, left: w.left, top: w.top };
        }

        // ── Bookmarks ────────────────────────────────────────────────────────
        case 'browser_search_bookmarks': {
          const query = String(args.query || '');
          if (!query) throw new Error('Missing required argument: query');
          const results = await chrome.bookmarks.search(query);
          return { count: results.length, bookmarks: results.map((b) => ({ id: b.id, title: b.title, url: b.url || null, parentId: b.parentId })) };
        }
        case 'browser_get_bookmark_tree': {
          const tree = await chrome.bookmarks.getTree();
          return { tree };
        }
        case 'browser_create_bookmark': {
          const createDetails: chrome.bookmarks.BookmarkCreateArg = {};
          if (args.url) createDetails.url = String(args.url);
          if (args.title) createDetails.title = String(args.title);
          if (args.parentId) createDetails.parentId = String(args.parentId);
          const node = await chrome.bookmarks.create(createDetails);
          return { id: node.id, title: node.title, url: node.url || null, parentId: node.parentId };
        }
        case 'browser_delete_bookmark': {
          const id = String(args.id || '');
          if (!id) throw new Error('Missing required argument: id');
          if (args.recursive) await chrome.bookmarks.removeTree(id);
          else await chrome.bookmarks.remove(id);
          return { deleted: true, id };
        }

        // ── History ──────────────────────────────────────────────────────────
        case 'browser_search_history': {
          const query = String(args.query ?? '');
          const maxResults = Math.min(Number(args.maxResults ?? 20), 100);
          const searchQuery: chrome.history.HistoryQuery = { text: query, maxResults };
          if (args.startTime) searchQuery.startTime = Number(args.startTime);
          if (args.endTime) searchQuery.endTime = Number(args.endTime);
          const items = await chrome.history.search(searchQuery);
          return { count: items.length, items: items.map((h) => ({ id: h.id, url: h.url || '', title: h.title || '', visitCount: h.visitCount, lastVisitTime: h.lastVisitTime })) };
        }
        case 'browser_add_history': {
          const url = String(args.url || '');
          if (!url) throw new Error('Missing required argument: url');
          await chrome.history.addUrl({ url });
          return { added: true, url };
        }
        case 'browser_delete_history': {
          if (args.url) {
            await chrome.history.deleteUrl({ url: String(args.url) });
            return { deleted: true, url: args.url };
          }
          const range: chrome.history.Range = {};
          if (args.startTime) range.startTime = Number(args.startTime);
          if (args.endTime) range.endTime = Number(args.endTime);
          await chrome.history.deleteRange(range);
          return { deleted: true, range };
        }
        case 'browser_get_top_sites': {
          const sites = await chrome.topSites.get();
          return { count: sites.length, sites };
        }

        // ── Downloads ────────────────────────────────────────────────────────
        case 'browser_download': {
          const url = String(args.url || '');
          if (!url) throw new Error('Missing required argument: url');
          const opts: chrome.downloads.DownloadOptions = { url };
          if (args.filename) opts.filename = String(args.filename);
          if (args.conflictAction) opts.conflictAction = String(args.conflictAction) as any;
          if (args.saveAs !== undefined) opts.saveAs = Boolean(args.saveAs);
          const downloadId = await chrome.downloads.download(opts);
          return { downloadId, started: true };
        }
        case 'browser_list_downloads': {
          const query: chrome.downloads.DownloadQuery = { limit: Math.min(Number(args.limit ?? 20), 100) };
          if (args.query) query.query = [String(args.query)];
          if (args.state) query.state = String(args.state) as any;
          const items = await chrome.downloads.search(query);
          return { count: items.length, downloads: items.map((d) => ({ id: d.id, filename: d.filename, url: d.url, state: d.state, bytesReceived: d.bytesReceived, totalBytes: d.totalBytes, startTime: d.startTime })) };
        }
        case 'browser_cancel_download': {
          await chrome.downloads.cancel(Number(args.downloadId));
          return { cancelled: true, downloadId: args.downloadId };
        }
        case 'browser_open_download': {
          await chrome.downloads.open(Number(args.downloadId));
          return { opened: true, downloadId: args.downloadId };
        }
        case 'browser_erase_download': {
          const query: chrome.downloads.DownloadQuery = {};
          if (args.downloadId !== undefined) query.id = Number(args.downloadId);
          else query.state = 'complete';
          const erased = await chrome.downloads.erase(query);
          return { erased: erased.length, ids: erased };
        }

        // ── Storage (chrome.storage) ─────────────────────────────────────────
        case 'browser_storage_get': {
          const area = String(args.area || 'local') as 'local' | 'sync' | 'session';
          const keys = args.keys ?? null;
          const result = await chrome.storage[area].get(keys as any);
          return result;
        }
        case 'browser_storage_set': {
          const area = String(args.area || 'local') as 'local' | 'sync' | 'session';
          if (!args.items || typeof args.items !== 'object') throw new Error('Missing required argument: items');
          await chrome.storage[area].set(args.items as Record<string, unknown>);
          return { set: true, area, keys: Object.keys(args.items as object) };
        }
        case 'browser_storage_remove': {
          const area = String(args.area || 'local') as 'local' | 'sync' | 'session';
          const keys = Array.isArray(args.keys) ? args.keys as string[] : String(args.keys);
          await chrome.storage[area].remove(keys);
          return { removed: true, area, keys };
        }
        case 'browser_storage_clear': {
          const area = String(args.area || 'local') as 'local' | 'sync' | 'session';
          await chrome.storage[area].clear();
          return { cleared: true, area };
        }

        // ── Sessions ─────────────────────────────────────────────────────────
        case 'browser_get_recent_sessions': {
          const maxResults = Math.min(Number(args.maxResults ?? 10), 25);
          const sessions = await chrome.sessions.getRecentlyClosed({ maxResults });
          return { count: sessions.length, sessions: sessions.map((s) => ({ sessionId: s.tab?.sessionId || s.window?.sessionId, type: s.tab ? 'tab' : 'window', title: s.tab?.title || `Window (${s.window?.tabs?.length ?? 0} tabs)`, url: s.tab?.url || null, lastModified: s.lastModified })) };
        }
        case 'browser_restore_session': {
          const sessionId = String(args.sessionId || '');
          if (!sessionId) throw new Error('Missing required argument: sessionId');
          const restored = await chrome.sessions.restore(sessionId);
          return { restored: true, type: restored.tab ? 'tab' : 'window', tabId: restored.tab?.id, windowId: restored.window?.id };
        }

        // ── Tab Groups ───────────────────────────────────────────────────────
        case 'browser_group_tabs': {
          const tabIds = (args.tabIds as number[]);
          if (!tabIds?.length) throw new Error('Missing required argument: tabIds');
          const opts: chrome.tabs.GroupOptions = { tabIds };
          if (args.groupId) opts.groupId = Number(args.groupId);
          const groupId = await chrome.tabs.group(opts);
          if (args.title || args.color) {
            const upd: chrome.tabGroups.UpdateProperties = {};
            if (args.title) upd.title = String(args.title);
            if (args.color) upd.color = String(args.color) as chrome.tabGroups.Color;
            await chrome.tabGroups.update(groupId, upd);
          }
          return { groupId, tabCount: tabIds.length };
        }
        case 'browser_ungroup_tabs': {
          const tabIds = args.tabIds as number[];
          if (!tabIds?.length) throw new Error('Missing required argument: tabIds');
          await chrome.tabs.ungroup(tabIds);
          return { ungrouped: true, tabCount: tabIds.length };
        }
        case 'browser_list_tab_groups': {
          const query: chrome.tabGroups.QueryInfo = {};
          if (args.windowId) query.windowId = Number(args.windowId);
          const groups = await chrome.tabGroups.query(query);
          return { count: groups.length, groups: groups.map((g) => ({ groupId: g.id, windowId: g.windowId, title: g.title || '', color: g.color, collapsed: g.collapsed })) };
        }
        case 'browser_update_tab_group': {
          const groupId = Number(args.groupId);
          const upd: chrome.tabGroups.UpdateProperties = {};
          if (args.title !== undefined) upd.title = String(args.title);
          if (args.color) upd.color = String(args.color) as chrome.tabGroups.Color;
          if (args.collapsed !== undefined) upd.collapsed = Boolean(args.collapsed);
          const g = await chrome.tabGroups.update(groupId, upd);
          return { groupId, title: g.title, color: g.color, collapsed: g.collapsed };
        }

        // ── Cookies ──────────────────────────────────────────────────────────
        case 'browser_get_cookies': {
          const details: chrome.cookies.GetAllDetails = {};
          if (args.url) details.url = String(args.url);
          if (args.name) details.name = String(args.name);
          if (args.domain) details.domain = String(args.domain);
          const cookies = await chrome.cookies.getAll(details);
          return { count: cookies.length, cookies: cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate })) };
        }
        case 'browser_set_cookie': {
          const url = String(args.url || '');
          const name = String(args.name || '');
          const value = String(args.value ?? '');
          if (!url || !name) throw new Error('Missing required arguments: url, name');
          const details: chrome.cookies.SetDetails = { url, name, value };
          if (args.domain) details.domain = String(args.domain);
          if (args.path) details.path = String(args.path);
          if (args.secure !== undefined) details.secure = Boolean(args.secure);
          if (args.httpOnly !== undefined) details.httpOnly = Boolean(args.httpOnly);
          if (args.expirationDate) details.expirationDate = Number(args.expirationDate);
          const cookie = await chrome.cookies.set(details);
          return { set: true, name: cookie?.name, domain: cookie?.domain };
        }
        case 'browser_delete_cookie': {
          const url = String(args.url || '');
          const name = String(args.name || '');
          if (!url || !name) throw new Error('Missing required arguments: url, name');
          await chrome.cookies.remove({ url, name });
          return { deleted: true, name, url };
        }

        // ── Interaction (extended) ────────────────────────────────────────────
        case 'browser_double_click': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const sel = String(args.selector || '');
          if (!sel) throw new Error('Missing required argument: selector');
          await injectScript(tabId, (s: string) => {
            const el = document.querySelector(s) as HTMLElement | null;
            if (!el) throw new Error(`Element not found: ${s}`);
            el.scrollIntoView({ block: 'center' });
            el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
          }, [sel]);
          return { doubleClicked: true, selector: sel };
        }
        case 'browser_right_click': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const sel = String(args.selector || '');
          if (!sel) throw new Error('Missing required argument: selector');
          await injectScript(tabId, (s: string) => {
            const el = document.querySelector(s) as HTMLElement | null;
            if (!el) throw new Error(`Element not found: ${s}`);
            el.scrollIntoView({ block: 'center' });
            el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
          }, [sel]);
          return { rightClicked: true, selector: sel };
        }
        case 'browser_check_element': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const sel = String(args.selector || '');
          if (!sel) throw new Error('Missing required argument: selector');
          const result = await injectScript(tabId, (s: string, c: boolean | undefined) => {
            const el = document.querySelector(s) as HTMLInputElement | null;
            if (!el) throw new Error(`Element not found: ${s}`);
            const newChecked = c !== undefined ? c : !el.checked;
            el.checked = newChecked;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { checked: newChecked };
          }, [sel, args.checked as boolean | undefined]);
          return { selector: sel, ...(result as object) };
        }
        case 'browser_set_attribute': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const sel = String(args.selector || '');
          const attr = String(args.attribute || '');
          if (!sel || !attr) throw new Error('Missing required arguments: selector, attribute');
          await injectScript(tabId, (s: string, a: string, v: string | undefined) => {
            const el = document.querySelector(s);
            if (!el) throw new Error(`Element not found: ${s}`);
            if (v === undefined) el.removeAttribute(a);
            else el.setAttribute(a, v);
          }, [sel, attr, args.value as string | undefined]);
          return { selector: sel, attribute: attr, value: args.value ?? null };
        }

        // ── Page content (extended) ───────────────────────────────────────────
        case 'browser_get_page_metadata': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const meta = await injectScript(tabId, () => {
            const getMeta = (name: string) => (document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null)?.content || null;
            const getOg = (prop: string) => (document.querySelector(`meta[property="og:${prop}"]`) as HTMLMetaElement | null)?.content || null;
            return {
              title: document.title,
              description: getMeta('description'),
              keywords: getMeta('keywords'),
              author: getMeta('author'),
              language: document.documentElement.lang || null,
              canonical: (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href || null,
              og: { title: getOg('title'), description: getOg('description'), image: getOg('image'), url: getOg('url'), type: getOg('type') },
              url: location.href,
            };
          });
          return meta;
        }
        case 'browser_find_elements': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const sel = String(args.selector || '');
          if (!sel) throw new Error('Missing required argument: selector');
          const limit = Math.min(Number(args.limit ?? 50), 200);
          const elements = await injectScript(tabId, (s: string, lim: number) => {
            return Array.from(document.querySelectorAll(s)).slice(0, lim).map((el, idx) => {
              const r = el.getBoundingClientRect();
              const h = el as HTMLElement;
              return { index: idx, tagName: el.tagName.toLowerCase(), id: el.id || null, className: el.className || null, text: h.innerText?.trim().slice(0, 200) || '', value: (el as HTMLInputElement).value ?? null, visible: r.width > 0 && r.height > 0, rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
            });
          }, [sel, limit]);
          return { selector: sel, count: (elements as any[]).length, elements };
        }
        case 'browser_get_links': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const filter = args.filter ? String(args.filter) : null;
          const links = await injectScript(tabId, (f: string | null) => {
            return Array.from(document.querySelectorAll('a[href]')).map((a) => {
              const el = a as HTMLAnchorElement;
              return { href: el.href, text: el.innerText.trim().slice(0, 200), id: el.id || null, rel: el.rel || null, target: el.target || null };
            }).filter((l) => !f || l.href.includes(f));
          }, [filter]);
          return { count: (links as any[]).length, links };
        }
        case 'browser_get_forms': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const forms = await injectScript(tabId, () => {
            return Array.from(document.forms).map((form, fi) => ({
              index: fi, id: form.id || null, name: form.name || null, action: form.action, method: form.method,
              fields: Array.from(form.elements).map((el: any) => ({
                tagName: el.tagName.toLowerCase(), type: el.type || null, name: el.name || null,
                id: el.id || null, value: el.value ?? null, checked: el.checked ?? null, required: el.required ?? null,
                options: el.tagName === 'SELECT' ? Array.from(el.options).map((o: any) => ({ value: o.value, text: o.text, selected: o.selected })) : null,
              })),
            }));
          });
          return { count: (forms as any[]).length, forms };
        }
        case 'browser_get_computed_style': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const sel = String(args.selector || '');
          if (!sel) throw new Error('Missing required argument: selector');
          const props = Array.isArray(args.properties) ? args.properties as string[] : ['color', 'background-color', 'font-size', 'font-weight', 'display', 'visibility', 'opacity', 'margin', 'padding', 'border', 'width', 'height', 'position', 'z-index'];
          const style = await injectScript(tabId, (s: string, ps: string[]) => {
            const el = document.querySelector(s);
            if (!el) throw new Error(`Element not found: ${s}`);
            const cs = window.getComputedStyle(el);
            const result: Record<string, string> = {};
            for (const p of ps) result[p] = cs.getPropertyValue(p);
            return result;
          }, [sel, props]);
          return { selector: sel, style };
        }

        // ── Page storage ──────────────────────────────────────────────────────
        case 'browser_get_local_storage': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const key = args.key ? String(args.key) : null;
          const data = await injectScript(tabId, (k: string | null) => {
            if (k) return { [k]: localStorage.getItem(k) };
            const all: Record<string, string | null> = {};
            for (let i = 0; i < localStorage.length; i++) { const kk = localStorage.key(i)!; all[kk] = localStorage.getItem(kk); }
            return all;
          }, [key]);
          return data;
        }
        case 'browser_set_local_storage': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const key = String(args.key || '');
          const value = String(args.value ?? '');
          if (!key) throw new Error('Missing required argument: key');
          await injectScript(tabId, (k: string, v: string) => { localStorage.setItem(k, v); }, [key, value]);
          return { set: true, key, value };
        }
        case 'browser_get_session_storage': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const key = args.key ? String(args.key) : null;
          const data = await injectScript(tabId, (k: string | null) => {
            if (k) return { [k]: sessionStorage.getItem(k) };
            const all: Record<string, string | null> = {};
            for (let i = 0; i < sessionStorage.length; i++) { const kk = sessionStorage.key(i)!; all[kk] = sessionStorage.getItem(kk); }
            return all;
          }, [key]);
          return data;
        }

        // ── Scripting (extended) ─────────────────────────────────────────────
        case 'browser_inject_css': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const css = String(args.css || '');
          if (!css) throw new Error('Missing required argument: css');
          await chrome.scripting.insertCSS({ target: { tabId }, css });
          return { injected: true, bytes: css.length };
        }
        case 'browser_clipboard_write': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const text = String(args.text ?? '');
          await injectScript(tabId, (t: string) => navigator.clipboard.writeText(t), [text]);
          return { written: true, length: text.length };
        }
        case 'browser_clipboard_read': {
          const tabId = await resolveTabId(args.tabId as number | undefined);
          const text = await injectScript(tabId, () => navigator.clipboard.readText());
          return { text };
        }

        // ── Notifications ─────────────────────────────────────────────────────
        case 'browser_notify': {
          const title = String(args.title || '');
          const message = String(args.message || '');
          if (!title || !message) throw new Error('Missing required arguments: title, message');
          const notifId = await chrome.notifications.create({
            type: 'basic',
            iconUrl: args.iconUrl ? String(args.iconUrl) : chrome.runtime.getURL('icon/128.png'),
            title,
            message,
          });
          return { notificationId: notifId };
        }

        default:
          throw new Error(`Unknown browser tool: ${name}`);
      }
    };

    // Execute website tool via content script port
    const executeWebsiteTool = async (tabId: number, originalName: string, args: Record<string, unknown>): Promise<unknown> => {
      const entry = tabEntries.get(tabId);
      if (!entry) throw new Error(`Tab ${tabId} not connected to any MCP server`);

      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pendingWebCalls.delete(requestId);
          reject(new Error('Website tool execution timeout'));
        }, REQUEST_TIMEOUT_MS);

        pendingWebCalls.set(requestId, (data) => {
          clearTimeout(timeoutId);
          if (data.success) resolve(data.payload);
          else reject(new Error(String(data.payload)));
        });

        entry.port.postMessage({ type: 'execute-tool', toolName: originalName, requestId, args });
      });
    };

    // ─── HTTP Provider relay ─────────────────────────────────────────────────

    const normalizeServerUrl = (value: string) => {
      const trimmed = String(value || '').trim().replace(/\/$/, '');
      if (!trimmed) return '';
      return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    };

    const getSavedConfig = async () => {
      const data = await chrome.storage.sync.get('clawathon_mcp_config');
      const cfg = data['clawathon_mcp_config'] || {};
      return { nativeServerUrl: normalizeServerUrl(cfg.nativeServerUrl || ''), authToken: String(cfg.authToken || '') };
    };

    const requestNativeServer = async (path: string, options: RequestInit = {}) => {
      const { nativeServerUrl, authToken } = await getSavedConfig();
      if (!nativeServerUrl) { const e = new Error('Native server chưa được cấu hình. Mở sidepanel để kết nối agent-service.'); (e as any).notConfigured = true; throw e; }
      const headers = new Headers(options.headers || {});
      if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
      if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
      const res = await fetch(`${nativeServerUrl}${path}`, { ...options, headers });
      if (!res.ok) { const t = await res.text(); throw new Error(`Native server ${res.status} - ${t}`); }
      const ct = res.headers.get('content-type') || '';
      return ct.includes('application/json') ? res.json() : res.text();
    };

    const handleProviderRequest = async (request: any) => {
      const { type, requestId, payload } = request;

      if (type === 'list_tools') {
        await requestNativeServer(`/provider/respond/${requestId}`, {
          method: 'POST',
          body: JSON.stringify({ status: 'success', data: allTools(), message: 'Extension provider' }),
        });
        return;
      }

      if (type === 'call_tool') {
        const name = String(payload?.name || '');
        const args = (payload?.args && typeof payload.args === 'object') ? payload.args as Record<string, unknown> : {};

        try {
          let data: unknown;
          if (name.startsWith('wt_')) {
            const entry = webToolIndex.get(name);
            if (!entry) throw new Error(`Website tool not found: ${name}`);
            data = await executeWebsiteTool(entry.tabId, entry.originalName, args);
          } else {
            data = await executeBrowserTool(name, args);
          }

          // Format screenshot as image content — resize to max 1280px wide, JPEG 85%
          if (name === 'browser_take_screenshot' && (data as any)?.dataUrl) {
            const { base64, mimeType } = await resizeScreenshot(String((data as any).dataUrl));
            // Keep { dataUrl } format so native-server toolResultToContent handles it correctly
            await requestNativeServer(`/provider/respond/${requestId}`, {
              method: 'POST',
              body: JSON.stringify({ status: 'success', data: { dataUrl: `data:${mimeType};base64,${base64}` } }),
            });
          } else {
            await requestNativeServer(`/provider/respond/${requestId}`, {
              method: 'POST',
              body: JSON.stringify({ status: 'success', data, message: `Executed tool: ${name}` }),
            });
          }
        } catch (error) {
          await requestNativeServer(`/provider/respond/${requestId}`, {
            method: 'POST',
            body: JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : `Failed: ${name}` }),
          });
        }
      }
    };

    const pollOnce = async () => {
      const request = await requestNativeServer('/provider/queue');
      if (request && request.type !== 'heartbeat') void handleProviderRequest(request);
    };

    const pollLoop = async () => {
      while (isProviderRunning) {
        try { await pollOnce(); }
        catch (err) {
          isProviderRunning = false;
          if ((err as any)?.notConfigured) {
            console.debug('[provider] native-server config lost, will retry on next SAVE_CONFIG');
          } else {
            console.error('[provider] poll failed:', err instanceof Error ? err.message : err);
          }
          break;
        }
      }
    };

    const startProvider = async () => {
      if (isProviderRunning) return;
      try {
        await requestNativeServer('/provider/register', {
          method: 'POST',
          body: JSON.stringify({ tools: allTools() }),
        });
        isProviderRunning = true;
        console.log('[provider] registered with', allTools().length, 'tools');
        void pollLoop();
      } catch (err) {
        isProviderRunning = false;
        if ((err as any)?.notConfigured) {
          console.debug('[provider] waiting for native-server config from agent-service…');
        } else {
          console.error('[provider] registration failed:', err instanceof Error ? err.message : err);
        }
      }
    };

    // ─── Misc helpers ────────────────────────────────────────────────────────

    const sameConfig = (a: any, b: any) => {
      const norm = (v?: string) => String(v || '').trim().replace(/\/$/, '');
      return norm(a?.nativeServerUrl) === norm(b?.nativeServerUrl) && String(a?.authToken || '').trim() === String(b?.authToken || '').trim();
    };

    const parseJsonRpcResult = (payload: unknown) => {
      const d = payload as { result?: unknown; error?: { message?: string } };
      if (d?.error) throw new Error(d.error.message || 'MCP error');
      return d?.result;
    };

    const parseMcpHttpResponse = async (response: Response) => {
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('application/json')) return response.json();
      const text = await response.text();
      if (ct.includes('text/event-stream') || text.startsWith('event:')) {
        const lines = text.split(/\r?\n/);
        let data = '';
        for (const line of lines) { if (line.startsWith('data:')) data = line.slice(5).trim(); }
        if (!data) throw new Error('MCP SSE no data payload');
        return JSON.parse(data);
      }
      throw new Error(`Unsupported MCP response: ${ct || 'unknown'}`);
    };

    const loadPersistedSessionId = async () => {
      if (mcpSessionId) return mcpSessionId;
      const data = await chrome.storage.local.get(MCP_SESSION_STORAGE_KEY);
      const p = data[MCP_SESSION_STORAGE_KEY];
      if (typeof p === 'string' && p.trim()) mcpSessionId = p.trim();
      return mcpSessionId;
    };

    const persistSessionId = async (id: string | null) => {
      mcpSessionId = id;
      if (id) await chrome.storage.local.set({ [MCP_SESSION_STORAGE_KEY]: id });
      else await chrome.storage.local.remove(MCP_SESSION_STORAGE_KEY);
    };

    const ensureMcpSession = async () => {
      const persisted = await loadPersistedSessionId();
      if (persisted) return persisted;
      const { nativeServerUrl, authToken } = await getSavedConfig();
      if (!nativeServerUrl) { const e = new Error('Native server chưa được cấu hình. Mở sidepanel để kết nối agent-service.'); (e as any).notConfigured = true; throw e; }
      const headers = new Headers({ 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'x-mcp-client-id': MCP_CLIENT_ID });
      if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
      const res = await fetch(`${nativeServerUrl}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: mcpRequestId++, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'claw-a-thon-chrome-extension', version: '1.0.0' } } }) });
      if (!res.ok) throw new Error(`MCP init failed: ${res.status}`);
      const sessionId = res.headers.get('mcp-session-id');
      if (!sessionId) throw new Error('No mcp-session-id returned');
      await persistSessionId(sessionId);
      return sessionId;
    };

    const closeMcpSession = async (sessionId?: string | null) => {
      const id = (sessionId || mcpSessionId || '').trim();
      if (!id) return;
      const { nativeServerUrl, authToken } = await getSavedConfig();
      if (!nativeServerUrl) return;
      const headers = new Headers({ 'Accept': 'application/json, text/event-stream', 'x-mcp-client-id': MCP_CLIENT_ID, 'mcp-session-id': id });
      if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
      try { await fetch(`${nativeServerUrl}/mcp`, { method: 'DELETE', headers }); } catch { /* best-effort */ }
    };

    const setupSidePanelActionClick = async () => {
      if (!chrome.sidePanel) return;
      try { await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); return; } catch { /* fall through */ }
      chrome.action.onClicked.addListener(async (tab) => {
        if (!tab.windowId) return;
        try { await chrome.sidePanel.open({ windowId: tab.windowId }); } catch { /* ignore */ }
      });
    };

    // ─── Keepalive + startup ─────────────────────────────────────────────────

    chrome.alarms.create('keepalive-provider', { periodInMinutes: 0.4 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'keepalive-provider') void startProvider();
    });

    void loadToolSettings().then(() => startProvider());
    void setupSidePanelActionClick();

    // ─── Message handlers ────────────────────────────────────────────────────

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      (async () => {
        try {
          switch (request.type) {
            case 'GET_CONFIG': {
              const data = await chrome.storage.sync.get('clawathon_mcp_config');
              sendResponse({ success: true, config: data['clawathon_mcp_config'] || null });
              break;
            }
            case 'SAVE_CONFIG': {
              const prev = (await chrome.storage.sync.get('clawathon_mcp_config'))['clawathon_mcp_config'] || null;
              await chrome.storage.sync.set({ 'clawathon_mcp_config': request.config });
              if (!sameConfig(prev, request.config)) {
                await closeMcpSession(mcpSessionId); await persistSessionId(null);
                isProviderRunning = false; void startProvider();
              }
              sendResponse({ success: true });
              break;
            }
            case 'RESET_MCP_SESSION': {
              await closeMcpSession(mcpSessionId); await persistSessionId(null);
              sendResponse({ success: true });
              break;
            }
            case 'TEST_CONNECTION': {
              try {
                const { nativeServerUrl, authToken: saved } = await getSavedConfig();
                const url = normalizeServerUrl(request.config?.nativeServerUrl || nativeServerUrl || '');
                const token = request.config?.authToken || saved || '';
                if (!url) throw new Error('Native server URL is empty');
                const res = await fetch(`${url}/health`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
                sendResponse({ success: res.ok, health: res.ok ? 'OK' : 'Failed' });
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Connection failed';
                sendResponse({ success: false, error: /Failed to fetch|fetch/i.test(msg) ? 'Failed to fetch. Check native-server URL.' : msg });
              }
              break;
            }

            // ── Tools ──────────────────────────────────────────────────────
            case 'GET_TOOLS': {
              sendResponse({ success: true, tools: browserTools, providerRunning: isProviderRunning });
              break;
            }
            case 'CALL_TOOL': {
              try {
                const result = await executeBrowserTool(String(request.toolName || ''), request.arguments || {});
                sendResponse({ success: true, result });
              } catch (err) {
                sendResponse({ success: false, error: err instanceof Error ? err.message : 'Failed' });
              }
              break;
            }

            // ── Grouped tools for sidepanel ────────────────────────────────
            case 'GET_ALL_TOOLS': {
              // Browser tool groups
              const browserGroups = Object.entries(BROWSER_TOOL_CATEGORIES).map(([cat, names]) => ({
                id: `browser_${cat}`,
                type: 'browser' as const,
                label: cat.charAt(0).toUpperCase() + cat.slice(1),
                status: 'active' as const,
                toolCount: names.length,
                tools: browserTools
                  .filter((t) => names.includes(t.name))
                  .map((t) => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.inputSchema,
                    enabled: isToolEnabled(t.name),
                    risk: TOOL_RISK[t.name] ?? 'low',
                  })),
              }));

              // Website tool groups (one per tab)
              const websiteGroups = Array.from(tabEntries.values()).map((entry) => ({
                id: `website_tab_${entry.tabId}`,
                type: 'website' as const,
                label: entry.domain,
                status: (entry.tabId === activeTabId ? 'active' : 'connected') as 'active' | 'connected',
                tabId: entry.tabId,
                url: entry.url,
                toolCount: entry.tools.length,
                tools: entry.tools.map((t) => {
                  const pName = prefixedName(entry, t.name);
                  return {
                    name: pName,
                    originalName: t.name,
                    description: t.description || '',
                    inputSchema: t.inputSchema,
                    enabled: isToolEnabled(pName),
                    risk: 'low' as RiskLevel,
                  };
                }),
              }));

              const allGroupedTools = [...browserGroups, ...websiteGroups];
              const enabledCount = allGroupedTools.flatMap(g => g.tools).filter(t => t.enabled).length;

              sendResponse({
                success: true,
                groups: allGroupedTools,
                providerRunning: isProviderRunning,
                totalTools: enabledCount,
              });
              break;
            }

            case 'TOGGLE_TOOL': {
              try {
                await setToolEnabled(String(request.toolName || ''), Boolean(request.enabled));
                sendResponse({ success: true });
              } catch (err) {
                sendResponse({ success: false, error: err instanceof Error ? err.message : 'Failed' });
              }
              break;
            }

            // ── Tokens ─────────────────────────────────────────────────────
            case 'LIST_TOKENS': {
              try { const r = await requestNativeServer('/tokens'); sendResponse({ success: true, tokens: r.tokens ?? [] }); }
              catch (err) { sendResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to list tokens' }); }
              break;
            }
            case 'CREATE_TOKEN': {
              try {
                const r = await requestNativeServer('/tokens', { method: 'POST', body: JSON.stringify({ name: request.name, clientId: request.clientId }) });
                sendResponse({ success: true, token: r.token });
              } catch (err) { sendResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to create token' }); }
              break;
            }
            case 'DELETE_TOKEN': {
              try { await requestNativeServer(`/tokens/${request.id}`, { method: 'DELETE' }); sendResponse({ success: true }); }
              catch (err) { sendResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to delete token' }); }
              break;
            }
            default:
              sendResponse({ success: false, error: 'Unknown request type' });
          }
        } catch (err) {
          sendResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      })();
      return true;
    });

    console.log('🔧 Claw-a-thon MCP Extension background worker ready');
  },
});
