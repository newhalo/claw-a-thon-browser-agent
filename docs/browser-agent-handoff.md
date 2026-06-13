# Browser Agent Handoff

> Last updated: 2026-06-13
> This document covers the full system: native-server MCP gateway, Chrome extension (MCP relay + Chat UI), and agent-service.

---

## Repository Layout

```
packages/
  native-server/              # MCP gateway (Node.js HTTP, port 8080)
    server.js                 # Single-file gateway
    .env / .env.example
    tokens.json               # Dynamic token store (gitignored)

  agent-service/              # Chat backend (Node.js HTTP, port 3000)
    server.js                 # HTTP server + routes registration
    config.js                 # Runtime custom system prompt
    routes/chat.js            # POST /chat — Vercel AI SDK streaming
    providers/index.js        # Multi-provider factory (Anthropic / OpenAI / openai-compat)
    mcp/client.js             # MCP Streamable HTTP client → native-server
    memory/short-term.js      # In-memory conversation history per conversationId

  chrome-extension/           # MV3 extension (WXT framework)
    entrypoints/
      background/index.ts     # Service worker: browser tools + provider relay
      content.ts              # Content script: page MCP server discovery
      sidepanel/
        App.tsx               # Root: init flow, SetupView gate, page routing
        views/
          ChatView.tsx        # Chat UI: streaming, ordered segments, tool blocks
          SetupView.tsx       # First-run provider configuration wizard
        components/
          Settings.tsx        # Settings: native config + LLM provider + custom prompt
          ToolsPopover.tsx    # Tool enable/disable popover
          ToolsPanel.tsx      # Grouped tool list with toggles
          TokensPanel.tsx     # Native-server token management
        lib/
          agentServiceClient.ts  # fetch helpers: health, provider config, system prompt
          chatStore.ts           # Zustand store: messages, segments, loading state
    wxt.config.ts             # Manifest + permissions
```

---

## Architecture Overview

```
┌─────────────┐      MCP Streamable HTTP      ┌─────────────────────────────────┐
│   Cursor /  │ ──────────────────────────── ▶│  native-server/server.js        │
│  any MCP    │ ◀────────────────────────────  │  (gateway, port 8080)           │
│   client    │                               └──────────────┬──────────────────┘
└─────────────┘                                              │  provider relay HTTP
                                                             ▼
┌──────────────────────────────────────┐     ┌─────────────────────────────────┐
│  Chrome Extension sidepanel          │     │  agent-service (port 3000)      │
│                                      │     │                                 │
│  ChatView ──POST /chat──────────────▶│     │  POST /chat                     │
│                                      │     │  ├─ streamText (Vercel AI SDK)  │
│  App.tsx init:                       │     │  ├─ MCP client → native-server  │
│  ├─ health check → provider status   │     │  ├─ Multi-provider LLM          │
│  ├─ restore provider config          │     │  └─ Short-term memory           │
│  └─ SetupView if not configured      │     │                                 │
│                                      │     │  POST /provider-config          │
│  Settings.tsx:                       │     │  POST /system-prompt            │
│  ├─ LLM provider config              │     │  GET  /health                   │
│  └─ Custom system prompt             │     └─────────────────────────────────┘
└──────────────────────────────────────┘
         │  provider relay
         ▼
┌─────────────────────────────────────────────────────┐
│  Chrome Extension background service worker         │
│  • Browser tools (~75 tools)                        │
│  • Receives tool calls from native-server relay     │
│  • Website tools via content script ports           │
└─────────────────────────┬───────────────────────────┘
                          │  chrome.runtime.Port
                          ▼
                 Content script (per page)
                 Connects to page MCP server
```

---

## native-server (`packages/native-server/server.js`)

### MCP Streamable HTTP

Implements the 2024-11-05 spec:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/mcp` | `initialize` → creates session. Subsequent calls with `mcp-session-id` → routes to handler. |
| `GET`  | `/mcp` | SSE stream for server notifications. |
| `DELETE` | `/mcp` | Closes session. |

Supported methods: `ping`, `tools/list`, `tools/call`. Broadcasts `notifications/tools/list_changed` when extension re-registers with new tools.

### Provider relay

Extension registers and serves all tool calls. Gateway is a pure relay.

```
Extension boot  → POST /provider/register { tools: [...] }
                  gateway stores tools, broadcasts list_changed SSE

Extension loop  → GET /provider/queue (25s long-poll)
                ← { type: "heartbeat" }
                ← { type: "call_tool", requestId, payload }

Extension       → POST /provider/respond/:requestId { status, data }
```

### Auth

- Static: `AUTH_TOKEN` / `AUTH_TOKENS` env vars
- Dynamic: `GET/POST/DELETE /tokens` (admin only, stored in `tokens.json`)
- `ALLOW_NO_AUTH=true` for local dev

### Start

```bash
cd packages/native-server
AUTH_TOKEN=my-secret PORT=8080 node server.js
```

---

## agent-service (`packages/agent-service/`)

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/chat` | Streaming chat (Vercel AI SDK data stream protocol) |
| `GET`  | `/health` | Health + provider status: `{ status, provider: { configured, provider, model, toolsSupported } }` |
| `POST` | `/provider-config` | Set LLM provider at runtime: `{ provider, apiKey, model, baseUrl, toolsSupported }` |
| `GET/POST` | `/system-prompt` | Get/set custom system prompt appended to base prompt |

### POST /chat

Request:
```json
{
  "messages": [{ "role": "user", "content": "..." }],
  "conversationId": "uuid",
  "enabledTools": ["browser_navigate_to", ...]
}
```

Response: `text/plain; charset=utf-8` with `x-vercel-ai-data-stream: v1` header.

Chunk format (Vercel AI SDK data stream protocol):
```
0:"text delta"           ← text
9:{toolCallId,name,args} ← tool call
a:{toolCallId,result}    ← tool result
d:{finishReason,...}     ← finish
3:"error message"        ← error (custom message via getErrorMessage)
```

### Streaming error handling

`streamText` is called with `maxRetries: 0` (prevents cascade 429). Error messages are customized via `pipeDataStreamToResponse({ getErrorMessage })`:

```js
await result.pipeDataStreamToResponse(res, {
  getErrorMessage: (error) => {
    if (error?.statusCode === 429) {
      const wait = error?.responseHeaders?.['ai-ratelimit-reset'];
      return `Rate limit: API quota đã hết.${wait ? ` Thử lại sau ${Math.ceil(wait/60)} phút.` : ''}`;
    }
    return error?.message || 'An error occurred';
  },
});
```

This is the correct hook — the `onError` callback in `streamText` is notification-only, not for message customization.

### Providers (`providers/index.js`)

Supported: `anthropic`, `openai`, `openai-compat`

Config via env (`PROVIDER`, `ANTHROPIC_API_KEY`, etc.) or runtime `POST /provider-config`.

**`isToolsSupported()`**: `anthropic` and `openai` always support tools. `openai-compat` only if `toolsSupported: true` was set explicitly (opt-in for compatible models like Gemini Flash, off by default for models like Gemma).

**VNGCloud Gemini compatibility**: `patchToolCallIndexFetch` wraps `fetch` to inject `"index":0` into streaming SSE chunks that are missing the `index` field (required by the AI SDK's type validation):

```js
// Patches: "type":"function" → "index":0,"type":"function"
// Applied only when toolsSupported === true for openai-compat providers
```

### System prompts

Two prompts in `routes/chat.js`:
- `SYSTEM_PROMPT` (tools enabled): includes tool selection guide + escalation order (text → HTML → find_elements → screenshot)
- `SYSTEM_PROMPT_NO_TOOLS` (tools disabled): plain-text only, explicitly says not to generate tool calls

Custom instructions from Settings are appended as `## Custom instructions` section.

### Start

```bash
cd packages/agent-service
node server.js
# or with env file:
node --env-file=.env server.js
```

---

## Chrome Extension

### Permissions

```
storage, activeTab, tabs, scripting, webNavigation, windows, sidePanel, alarms,
bookmarks, history, downloads, sessions, tabGroups, topSites, notifications,
cookies, clipboardRead, clipboardWrite
```

Host permissions: `<all_urls>`, `http://localhost/*`, `http://127.0.0.1/*`

> **Note:** `<all_urls>` (not just `activeTab`) is required for `captureVisibleTab` (screenshot) when called outside a user gesture context (e.g. from agent tool call).

### App init flow (`App.tsx`)

On extension open:
1. `GET /health` on agent-service → check `provider.configured`
2. If not configured → try restore from `chrome.storage.sync` (`agentProviderConfig`)
3. If restore fails → show `SetupView`
4. Push native config (`nativeServerUrl`, `authToken`) to agent-service
5. Restore custom system prompt from storage → `POST /system-prompt`

### SetupView (`views/SetupView.tsx`)

First-run wizard shown when provider not configured:
- Provider selector: `anthropic` / `openai` / `openai-compat`
- Fields: API key, model, base URL (openai-compat only)
- "Hỗ trợ function/tool calling" checkbox for openai-compat (default: **off**, safe for Gemma-type models)
- Saves to `chrome.storage.sync` as `agentProviderConfig`
- Calls `POST /provider-config` on agent-service

### Settings (`components/Settings.tsx`)

Three sections:
1. **Native Server config** — URL + auth token
2. **LLM Provider** — status badge + edit form (same fields as SetupView), allows re-config without going through SetupView
3. **Custom Instructions** — textarea saved to `agentCustomSystemPrompt` in storage + `POST /system-prompt`

### Chat flow (`views/ChatView.tsx`)

**Ordered segments model**: Instead of `content: string + toolInvocations: []` (which loses timeline order), messages use:

```ts
type MessageSegment =
  | { type: 'text'; content: string }   // coalesced adjacent text deltas
  | { type: 'tool'; inv: ToolInvocation }

interface ChatMessage {
  content: string;         // concatenated text, used for history sent to server
  segments?: MessageSegment[];  // ordered segments, used for display
}
```

Stream parsing builds `segments[]` in arrival order: text chunks coalesce into the last text segment; tool-call pushes a new tool segment; tool-result updates it in-place by stored index. This ensures tool blocks appear at the exact position in the conversation where they were called, not pushed to the bottom.

**Rendering**:
- User messages → `UserBubble` (right-aligned, accent color)
- Assistant messages → `AssistantMessage` (flat, no bubble) — renders segments in order: Markdown for text, `ToolCallBlock` for tools

**503 recovery**: If agent-service returns `{ error: "provider_not_configured" }`, ChatView re-pushes provider config from storage and retries the request once.

### Tool risk defaults

Tools default-disabled (high/critical):
`execute_script`, `get/set_cookies`, `get/set_local_storage`, `get_session_storage`, `delete_cookie`, `get_forms`, `search_history`, `add_history`, `delete_history`, `get_top_sites`, `get_recent_sessions`, `restore_session`, `download`, `get_bookmark_tree`, `delete_bookmark`, `storage_clear`, `clipboard_read`

`browser_take_screenshot` is **medium** risk → **default ON** (required for agent to visually inspect pages).

---

## Build & Run

```bash
# 1. Start native-server
cd packages/native-server
AUTH_TOKEN=my-secret PORT=8080 node server.js

# 2. Start agent-service (provider can be set via UI, no env needed)
cd packages/agent-service
node server.js

# 3. Build extension
cd packages/chrome-extension
npm run build
# or pnpm --dir packages/chrome-extension build

# 4. Load in Chrome
# chrome://extensions → Developer Mode → Load unpacked
# → packages/chrome-extension/dist/chrome-mv3
```

---

## Known Issues & Pending Work

### 🔴 Stream truncation mid-task (Qwen / openai-compat models)

**Triệu chứng:** Model (e.g. `qwen/qwen3-5-27b`) stream được một hồi rồi dừng đột ngột dù task chưa hoàn thành.

**Nguyên nhân nghi ngờ (chưa xác nhận):**
1. Context window đầy → `finishReason: "length"` (không phải `"stop"`)
2. Provider-side HTTP timeout (~30–60s) cắt stream
3. `maxSteps: 10` bị exhaust khi nhiều tool calls liên tiếp

**Điều tra cần làm:**
- Log `finishReason` và `usage.totalTokens` từ `d:` finish chunk trong ChatView
- Nếu `"length"` → implement context compression (Phase 6.2)
- Nếu timeout → add retry với backoff cho `fetch` trong ChatView

Xem đặc tả đầy đủ tại Phase 6 trong `chat-agent-implementation-plan.md`.

---

### 🟡 Skeleton loading chưa có

Khi model đang suy nghĩ (stream gửi đi nhưng chưa nhận chunk đầu tiên), UI chỉ hiện `TypingDots`. Cần shimmer skeleton đầy đủ hơn.

**Plan (Phase 5.1):** Track `isWaitingFirstChunk` state. Hiện `<SkeletonMessage>` (3 dòng animated gradient) cho đến khi có `0:` text chunk đầu tiên.

---

### 🟡 Không có chat sessions / history

Mỗi lần clear hoặc đóng panel, lịch sử mất hoàn toàn. Không có cách mở lại cuộc hội thoại cũ.

**Plan (Phase 5.2):**
- Lưu sessions vào `chrome.storage.local` (max 50)
- Header: nút `+` (new chat) + `⏱` (history panel)
- `clearHistory` → archive session cũ, tạo session mới

---

### 🟡 Input không có message history navigation

Không thể nhấn ↑↓ để browse lại các tin nhắn đã gửi để sửa/gửi lại.

**Plan (Phase 5.3):** `sentHistory: string[]` state trong ChatView, lưu vào `chrome.storage.local`. `ArrowUp`/`ArrowDown` khi textarea focused.

---

### 🟡 Tab Tokens tách rời khỏi Settings

Token management (`TokensPanel`) là một tab riêng trong nav. Nên gộp vào Settings dưới group **Security**.

**Plan (Phase 5.4):** Nhúng `TokensPanel` vào `Settings.tsx`, xóa tab `🔑` khỏi `App.tsx` nav.

---

### ❌ Phase 3 — Long-term memory

`memory/long-term.js` là stub. SQLite + sqlite-vec chưa implement. `better-sqlite3` native module đã build thành công.

**Plan:** Embed user messages → semantic search top-5 → inject vào system prompt. Summarize conversations khi idle 5 phút.

---

### ❌ Phase 4 — Custom MCP Servers

Chưa bắt đầu. Cho phép user kết nối thêm MCP servers bên ngoài native-server từ Settings UI.

**Plan:** Settings group "External MCP Connections", `mcp/client.js` mở rộng thành multi-client Map. Chi tiết tại Phase 4 trong `chat-agent-implementation-plan.md`.

---

### ❌ Phase 5 — Pre-defined Agent Skills

Chưa bắt đầu. Agent-service expose danh sách skills có sẵn (pre-defined bundles gồm system prompt + required tools + target URLs). User tick chọn skill trong Chat UI → agent tự có năng lực phù hợp mà không cần prompt thủ công.

**Use cases:** Marketing Campaign, VNG Internal Tools, Data Analyst, Web Researcher, ...

**Plan:**
- `GET /skills` endpoint trả list skill metadata
- `POST /chat` nhận thêm `activeSkills: string[]`, inject systemPrompt + auto-enable requiredTools
- `SkillsChipBar` component ngay trên input box — chips toggle, `+ More` dropdown
- Auto-suggest banner khi tab URL match `skill.targetUrls`
- Settings group "Agent Skills" để enable/disable built-ins và add custom skill JSON

Chi tiết đầy đủ tại Phase 5 trong `chat-agent-implementation-plan.md`.

---

### ❌ Phase 6 — Auto context compression

Khi conversation dài (>70% context window), cần tự động summarize messages cũ và giữ N messages gần nhất — tương tự cơ chế của Claude.

**Plan:** `compressHistory()` trong `routes/chat.js`, trigger theo `usage.totalTokens`. Chi tiết tại Phase 6 trong `chat-agent-implementation-plan.md`.

---

### ⚠️ VNGCloud Gemini rate limits (429)

VNGCloud Gemini Flash 2.5 có rate limit thấp. Khi agent gọi nhiều tool calls liên tiếp, 429 xảy ra mid-stream. Error hiện đúng trên UI qua `getErrorMessage`. Chưa có retry/backoff tự động.

`ai-ratelimit-reset` header (seconds) dùng để tính thời gian chờ hiển thị cho user.

---

### ⚠️ openai-compat toolsSupported opt-in UX

Checkbox "Hỗ trợ function/tool calling" mặc định **off**. User có model capable (Gemini Flash, GPT-4o qua custom URL) phải biết tự check. Chưa có auto-detect.

---

### ⚠️ Content script không auto-reconnect sau SW restart

Nếu background service worker restart (Chrome có thể suspend sau ~30s idle), toàn bộ `tabEntries` và `webToolIndex` bị xóa. Content scripts không tự reconnect — website tools biến mất cho đến khi reload trang.

**Workaround:** Reload trang sau khi service worker restart.

---

## Key Gotchas

| Gotcha | Detail |
|--------|--------|
| `<all_urls>` required for screenshot | `activeTab` only works with user gesture. `captureVisibleTab` from agent context needs `<all_urls>`. |
| VNGCloud missing `index` in tool_call SSE | `patchToolCallIndexFetch` patches this. Only applied when `toolsSupported === true` for openai-compat. |
| `maxRetries: 0` in streamText | AI SDK defaults to 3 retries with no backoff — cascades 429 into service crash. Must be 0. |
| `getErrorMessage` vs `onError` | `streamText`'s `onError` is notification-only. To customize the `3:` error chunk, use `pipeDataStreamToResponse({ getErrorMessage })`. Manual `res.write()` in `onError` races with SDK's stream management. |
| Conversation history sent by client | Client (Zustand) sends full history. Server must NOT prepend its own stored history — that duplicates messages and confuses the model. `const allMessages = messages;` — no prepend. |
| `onFinish` guard | `response.messages` can be `undefined` on error. Always guard: `if (response?.messages?.length)`. |
| Gemma spontaneous tool calls | Gemma generates tool-call tokens even with no tools defined. Fix: `SYSTEM_PROMPT_NO_TOOLS` explicitly says "do not call functions", and `isToolsSupported()` returns false for openai-compat unless opted in. |
