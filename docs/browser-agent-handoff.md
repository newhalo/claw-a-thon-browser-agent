# Browser Agent Handoff

> Last updated: 2026-06-13
> This document supersedes all previous versions. The architecture was completely replaced during the June 12-13 session.

---

## Repository Layout

```
packages/
  native-server/        # MCP gateway (Node.js HTTP server, no @mcp-b/native-server)
    server.js           # Single-file gateway — the only file that matters here
    .env                # Local env vars (gitignored)
    .env.example        # Template
    tokens.json         # Dynamic token store (gitignored)
  chrome-extension/     # MV3 extension built with WXT
    entrypoints/
      background/index.ts   # Service worker — provider relay + all browser tool logic
      content.ts            # Content script — page MCP server discovery
      sidepanel/            # React sidepanel UI
        components/
          ToolsPanel.tsx    # Main tool list panel (grouped display + toggles)
    wxt.config.ts           # WXT config and manifest permissions
```

---

## Architecture Overview

The system has **three layers** that cooperate at runtime:

```
┌─────────────┐      MCP Streamable HTTP      ┌──────────────────────────────────┐
│   Cursor /  │ ──────────────────────────── ▶│  native-server/server.js         │
│  any MCP    │ ◀────────────────────────────  │  (gateway, port 8080 by default) │
│   client    │                               └─────────────┬────────────────────┘
└─────────────┘                                             │  HTTP provider relay
                                                            │  POST /provider/register
                                                            │  GET  /provider/queue (25 s long-poll)
                                                            │  POST /provider/respond/:requestId
                                                            ▼
                                               ┌────────────────────────────────────────────────┐
                                               │  Chrome Extension — background service worker  │
                                               │                                                │
                                               │  • Browser tools (tabs, navigation, DOM, …)   │
                                               │  • Receives tool calls, executes, responds     │
                                               │  • Tracks page MCP tools via content script    │
                                               └────────────────────┬───────────────────────────┘
                                                                    │  chrome.runtime.Port
                                                                    │  name: "mcp-content-script-proxy"
                                                                    ▼
                                               ┌────────────────────────────────────────────────┐
                                               │  Content script (content.ts)                  │
                                               │  Injected into every http/https page           │
                                               │  Connects to page MCP server via              │
                                               │  TabClientTransport (@mcp-b/transports)        │
                                               └────────────────────┬───────────────────────────┘
                                                                    │  postMessage
                                                                    ▼
                                               ┌────────────────────────────────────────────────┐
                                               │  Web page — MCP server (optional)             │
                                               │  Implements TabServerTransport                 │
                                               └────────────────────────────────────────────────┘
```

### Why this design replaced the old one

The old design used `@mcp-b/native-server` which has a singleton `McpServer`. Cursor reconnects after reload call `McpServer.connect()` on the same singleton, causing `"Already connected to a transport"` crashes. The new design implements MCP Streamable HTTP directly with a per-session `mcpSessions` Map — no shared transport state at all.

The old design also used native messaging (`chrome.runtime.connectNative`). The extension service worker sleeps after ~30 s of inactivity, breaking the native host connection. The new design uses an HTTP provider relay: the extension keeps itself alive by long-polling `GET /provider/queue` and re-registering via an alarm every 24 s.

---

## Gateway (`packages/native-server/server.js`)

### MCP Streamable HTTP protocol

The gateway implements the 2024-11-05 spec directly:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/mcp` | `initialize` (no session header) → creates session, returns `mcp-session-id`. Any subsequent method with `mcp-session-id` header → routes to `handleMcpMethod`. |
| `GET`  | `/mcp` | Opens SSE stream for server-initiated notifications. Session must exist. |
| `DELETE` | `/mcp` | Closes session and its SSE stream. |

Sessions are stored in `mcpSessions = new Map()`. Stale sessions are evicted every 5 min (cutoff: 10 min idle).

Supported MCP methods: `ping`, `tools/list`, `tools/call`.

Capabilities advertised: `{ tools: { listChanged: true } }` — this is important; Cursor uses the SSE stream to receive `notifications/tools/list_changed` and refresh its tool cache automatically.

### Provider relay

The extension registers itself and serves all tool calls. The gateway acts purely as a relay — it never runs tools itself.

```
Extension boot:
  POST /provider/register  { tools: [...] }
  → gateway stores in providerTools, broadcasts tools/list_changed SSE to all sessions

Extension stays alive:
  GET /provider/queue   (25 s long-poll timeout)
  ← { type: "heartbeat" }          — no pending work
  ← { type: "list_tools", requestId }    — gateway needs fresh tool list
  ← { type: "call_tool", requestId, payload: { name, args } }

Extension responds:
  POST /provider/respond/:requestId  { status: "success", data: ... }
                                     { status: "error", message: ... }
```

**Key behavior**: `askExtensionListTools()` returns the cached `providerTools` immediately if non-null. Only falls back to dispatching `list_tools` to the extension if the cache is empty (first call). When the extension re-registers (e.g. new website tools found), `providerTools` updates and the gateway broadcasts `notifications/tools/list_changed` to every active SSE session — Cursor then fetches the updated list on its own.

### Auth

- Static tokens: `AUTH_TOKEN` or `AUTH_TOKENS` (comma-separated) env vars. These are admin tokens.
- Dynamic tokens: managed at runtime via `GET/POST/DELETE /tokens` (admin only). Stored in `tokens.json`.
- `ALLOW_NO_AUTH=true` bypasses all auth (local dev only).
- Token sent as `Authorization: Bearer <token>` or `x-api-key: <token>`.

### Other endpoints

| Path | Notes |
|------|-------|
| `GET /health` | Returns `{ status: "ok" }`. No auth required. |
| `GET /ready` | Returns provider status + session count. Auth required. |
| `GET /debug` | Full state dump (admin only). |
| `GET/POST/DELETE /tokens` | Dynamic token management (admin only). |

### Screenshot special-casing

`toolResultToContent()` in the gateway detects `browser_take_screenshot` by name and rewraps `data.dataUrl` as MCP image content:

```js
{ type: "image", data: base64, mimeType: "image/png" }  // base64 without data: prefix
```

All other tools return `{ type: "text", text: JSON.stringify(data) }`.

### Start the gateway

```bash
# With env file (recommended)
node --env-file=.env server.js

# Inline
AUTH_TOKEN=my-secret-token PORT=8080 ENABLE_DEBUG_LOGS=true node server.js
```

Required env vars: `AUTH_TOKEN` (or `AUTH_TOKENS`, or `ALLOW_NO_AUTH=true`).

---

## Chrome Extension

### Permissions

```
storage, activeTab, tabs, scripting, webNavigation, windows, sidePanel, alarms,
bookmarks, history, downloads, sessions, tabGroups, topSites, notifications,
cookies, clipboardRead, clipboardWrite
```

Host permissions: `http://*/*`, `https://*/*`

### Background service worker (`background/index.ts`)

#### Provider relay loop

```typescript
startProvider()         // POST /provider/register with allTools()
  → isProviderRunning = true
  → pollLoop() runs forever

pollLoop():
  pollOnce() → GET /provider/queue → handleProviderRequest(request)
    if list_tools  → respond with allTools()
    if call_tool   → executeBrowserTool() or executeWebsiteTool() → respond

// Keepalive: chrome.alarms "keepalive-provider" fires every 0.4 min
// → calls startProvider() if isProviderRunning === false
```

`reRegisterProvider()` is called whenever the tool list changes (website tools added/removed). It POSTs the new tool list to `/provider/register`, which triggers the SSE broadcast.

#### Website tool tracking

```typescript
tabEntries: Map<tabId, { tabId, domain, url, tools, port }>
webToolIndex: Map<prefixedName, { tabId, originalName }>
pendingWebCalls: Map<requestId, resolve>   // async bridge for page tool calls
activeTabId: number | null                 // updated via chrome.tabs.onActivated
```

Website tool names are prefixed: `website_tool_{domain}_tab{tabId}_{toolName}`
This makes them unique across tabs and routable back to the right content script port.

Port messages from content script → background:
- `register-tools` / `tools-updated` → updates `tabEntries`, calls `reRegisterProvider()`
- `tool-result` → resolves `pendingWebCalls` promise

Port messages background → content script:
- `execute-tool` → content script calls `mcpClient.callTool()`
- `request-tools-refresh` → content script re-lists tools

#### Tool risk defaults

Tools are classified by risk. High-risk tools are **disabled by default**. Users can override per-tool via the sidepanel toggle. Overrides persist in `chrome.storage.sync` under key `clawathon_tool_settings`.

```typescript
// Default-disabled (high/critical risk):
browser_execute_script      // critical: arbitrary JS
browser_get_cookies         // critical: auth tokens
browser_set_cookie          // critical: session forgery
browser_get_local_storage   // critical: JWT / app state
browser_set_local_storage   // critical: data injection
browser_get_session_storage // critical: session tokens
browser_delete_cookie       // high
browser_get_forms           // high: password field values
browser_search_history      // high: privacy
browser_add_history         // high
browser_delete_history      // high: irreversible
browser_get_top_sites       // high: privacy
browser_get_recent_sessions // high: browsing patterns
browser_restore_session     // high
browser_download            // high: arbitrary files to disk
browser_get_bookmark_tree   // high: full bookmark exposure
browser_delete_bookmark     // high: irreversible
browser_storage_clear       // high: destroys all extension data
browser_clipboard_read      // high: captures passwords
browser_take_screenshot     // high: captures sensitive screen
```

Logic: `isToolEnabled(name)` — checks `toolSettings` Map first (user override), falls back to `!DEFAULT_DISABLED.has(name)`.

`allTools()` filters disabled tools before returning to provider relay. `GET_ALL_TOOLS` message returns each tool with `enabled: boolean` and `risk: 'critical' | 'high' | 'low'`.

#### Browser tool categories (~75 tools, 15 groups)

| Category | Key tools |
|----------|-----------|
| `tabs` | get_active_tab, list_tabs, focus/close/reload/duplicate/pin/mute/move/discard, zoom |
| `windows` | list/create/close/update windows |
| `navigation` | navigate, go_back, go_forward |
| `bookmarks` | search, get_tree, create, delete |
| `history` | search, add, delete, get_top_sites |
| `downloads` | download, list, cancel, open, erase |
| `storage` | get/set/remove/clear chrome.storage (local/sync/session) |
| `sessions` | get_recent_sessions, restore_session |
| `groups` | group/ungroup tabs, list/update tab groups |
| `cookies` | get/set/delete cookies |
| `interaction` | click, double_click, right_click, hover, type, select_option, check_element, scroll, focus_element, press_key, set_attribute |
| `page` | get_content, get_metadata, find_elements, get_links, get_forms, get_computed_style, wait_for_element, get/set local_storage, get session_storage |
| `scripting` | execute_script, inject_css, clipboard_write/read |
| `media` | take_screenshot |
| `notifications` | notify |

`browser_type` uses the native input value setter to be React-compatible.

`browser_execute_script` uses `eval()` in injected function context (not extension context) — build shows a warning, this is expected and safe.

#### sidepanel message API

| Message type | Direction | Purpose |
|---|---|---|
| `GET_CONFIG` | → bg | Read saved server config |
| `SAVE_CONFIG` | → bg | Save config, resets session + provider |
| `TEST_CONNECTION` | → bg | Health-check the gateway |
| `RESET_MCP_SESSION` | → bg | Force new MCP session |
| `GET_TOOLS` | → bg | Returns flat browser tools list (legacy) |
| `CALL_TOOL` | → bg | Execute a browser tool directly |
| `GET_ALL_TOOLS` | → bg | Returns grouped tools with enabled/risk per tool |
| `TOGGLE_TOOL` | → bg | Enable/disable tool, re-registers provider |
| `LIST_TOKENS` / `CREATE_TOKEN` / `DELETE_TOKEN` | → bg | Token management via gateway |

### Content script (`content.ts`)

Injected into every `http://` and `https://` page.

1. Connects to background via `chrome.runtime.connect({ name: 'mcp-content-script-proxy' })`.
2. Attempts to connect to the page's MCP server via `TabClientTransport({ targetOrigin: origin })` from `@mcp-b/transports`.
3. **5-second timeout**: if no MCP server responds, silently exits (most pages won't have one).
4. On success: calls `client.listTools()` → sends `register-tools` to background port.
5. If the server advertises `listChanged` capability: installs `ToolListChangedNotificationSchema` handler → sends `tools-updated` on changes.
6. Handles `execute-tool` from background → calls `mcpClient.callTool()` → sends `tool-result`.

### Sidepanel (`ToolsPanel.tsx`)

- Polls `GET_ALL_TOOLS` every 5 s to pick up new website tab connections.
- **Browser tools section**: grouped by category (tabs, windows, navigation, …). Each group has a bulk toggle.
- **Website tools section**: one group per connected tab, labeled by domain, URL shown as subtitle.
- Status badges: `Active` (green) = currently focused tab, `Open Tab` (blue) = background tab.
- Per-tool display: short name (strips `browser_` prefix for browser tools, shows `originalName` for website tools), risk emoji (🔴/🟠 for high-risk tools), toggle switch.
- Expand any tool to see description, fill parameters, and call it directly from the panel.
- `enabled` count shown in header per group.

---

## Cursor MCP Configuration

```json
{
  "mcpServers": {
    "browser-agent": {
      "type": "http",
      "url": "http://127.0.0.1:8080/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

Cursor establishes a persistent SSE connection (`GET /mcp`) after `initialize`. When new website tools are discovered by the extension, the gateway sends `notifications/tools/list_changed` over that SSE stream and Cursor automatically refreshes its tool list — no manual refresh needed.

---

## Build & Run

```bash
# Build extension
pnpm --dir packages/chrome-extension build

# Start gateway (set your own token)
cd packages/native-server
AUTH_TOKEN=my-secret PORT=8080 node server.js
```

Load extension: `chrome://extensions` → Developer Mode → Load unpacked → `packages/chrome-extension/dist/chrome-mv3`

---

## Known Nuances

### Service worker sleep

Chrome may suspend the service worker after ~30 s of inactivity. The `keepalive-provider` alarm (every 0.4 min) calls `startProvider()` to re-register if `isProviderRunning` has been reset. The long-poll itself also keeps the worker alive while it has an inflight `fetch`.

### Content script reconnect after SW restart

If the service worker restarts, all in-memory state (`tabEntries`, `webToolIndex`) is lost. Content scripts' ports are disconnected; they do not automatically reconnect — they only run once at page load. Existing page tabs will lose their website tools until the page is reloaded.

This is a known MV3 limitation. A future fix would have content scripts retry connection with backoff when the port disconnects.

### Tool names and routing

Website tools are prefixed with `website_tool_{sanitized_domain}_tab{tabId}_{sanitized_name}`. The `webToolIndex` map routes the prefixed name back to `{ tabId, originalName }` for execution. If the background restarts and the index is empty, tool calls for website tools will fail until the page reloads (same SW restart issue above).

### Cookie permission and host permissions

Cookies require `cookies` permission plus host permissions for the target domain. The extension requests `http://*/*` and `https://*/*` so all cookie access is covered. These are broad permissions — only the explicitly enabled cookie tools are exposed to the AI agent.

---

## Files Most Relevant for Next Work

| File | Why |
|------|-----|
| `packages/native-server/server.js` | Full gateway implementation |
| `packages/chrome-extension/entrypoints/background/index.ts` | All tool logic, provider relay, risk defaults |
| `packages/chrome-extension/entrypoints/content.ts` | Page MCP discovery |
| `packages/chrome-extension/entrypoints/sidepanel/components/ToolsPanel.tsx` | Sidepanel UI |
| `packages/chrome-extension/wxt.config.ts` | Permissions |
