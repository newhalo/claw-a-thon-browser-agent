# Chat Agent — Implementation Plan

> **Mục tiêu:** Chuyển Side Panel extension thành một Chat Agent hiện đại, cho phép user chat với LLM và tự động hóa thao tác trên browser thông qua MCP tools, skills, và custom MCP servers.
>
> **Nguyên tắc:** `native-server` (port 8080) và WebMCP integration **giữ nguyên hoàn toàn**. Không breaking change với Cursor/IDE.

---

## Kiến trúc tổng quan

```
┌─────────────────────────────┐       ┌──────────────────────────────────┐
│   Chrome Extension           │       │   packages/agent-service          │
│   (Side Panel)               │       │   (NEW — port 3000)               │
│                              │       │                                    │
│  ┌────────────────────────┐  │       │  POST /chat (streaming SSE)        │
│  │  Chat UI               │──┼──────▶│  ├─ Memory: short-term + long-term│
│  │  (React + Vercel AI)   │  │       │  ├─ MCP Client → native-server    │
│  └────────────────────────┘  │       │  ├─ LLM Provider (multi)          │
│  ┌──────────┐ ┌───────────┐  │       │  └─ Skills Engine                 │
│  │ToolsPopov│ │MCPConfig  │  │       └──────────────┬───────────────────┘
│  └──────────┘ └───────────┘  │                      │ MCP Streamable HTTP
└─────────────────────────────┘                       ▼
                                       ┌──────────────────────────────────┐
                                       │   native-server (port 8080)       │
                                       │   (UNCHANGED)                     │
                                       │                                    │
                                       │  MCP Gateway + Provider Relay     │
                                       │  ← Extension registers tools      │
                                       │  ← Cursor/IDE connects            │
                                       └──────────────────────────────────┘
```

**Luồng tool call:**
```
User message → agent-service → LLM (với tool list)
                                    ↓ LLM calls tool
agent-service → POST /mcp (native-server) → GET /provider/queue (extension)
                                                        ↓
                                            execute browser tool
                                                        ↓
extension → POST /provider/respond → agent-service → LLM → stream response
```

---

## Roadmap

| Phase | Tên | Ước tính | Trạng thái |
|-------|-----|----------|------------|
| 1 | Chat UI (Extension) | 1–2 tuần | ✅ **Hoàn thành** |
| 2 | Agent Service | 2–3 tuần | ✅ **Hoàn thành (core)** |
| 3 | Memory System | 1–2 tuần | 🔲 Chưa bắt đầu |
| 4 | Skills + Custom MCP | ongoing | 🔲 Chưa bắt đầu |

> Cập nhật trạng thái: ✅ Hoàn thành | 🔄 Đang làm | 🔲 Chưa bắt đầu | ❌ Blocked

---

## Phase 1 — Chat UI

**Mục tiêu:** Thay thế màn hình chính Side Panel bằng giao diện Chat Agent.

### Tech stack
- **Vercel AI SDK** (`ai` package) — `useChat` hook, streaming, tool call rendering
- `@ai-sdk/openai` (đã có trong package.json) — OpenAI-compatible provider
- Radix UI Popover — ToolsPanel dưới dạng popover

### Cấu trúc file

```
packages/chrome-extension/entrypoints/sidepanel/
├── App.tsx                          ← route: ChatView mặc định, Settings qua icon
├── views/
│   ├── ChatView.tsx                 ← main chat interface (NEW)
│   └── SettingsView.tsx             ← từ Settings.tsx + agent-service config
├── components/
│   ├── ChatMessages.tsx             ← render messages + tool call UI (NEW)
│   ├── ChatInput.tsx                ← input bar + toolbar buttons (NEW)
│   ├── ToolsPopover.tsx             ← ToolsPanel trong Radix Popover (NEW)
│   ├── ProviderBadge.tsx            ← hiện provider đang dùng (NEW)
│   ├── Settings.tsx                 ← giữ nguyên (settings cho native-server)
│   ├── ToolsPanel.tsx               ← giữ nguyên
│   └── TokensPanel.tsx              ← giữ nguyên
└── lib/
    ├── agentServiceClient.ts        ← fetch wrapper cho agent-service (NEW)
    ├── nativeServerClient.ts        ← giữ nguyên
    ├── mcpServer.ts                 ← giữ nguyên
    └── storageManager.ts            ← giữ nguyên (+ agent config keys)
```

### Tính năng Chat UI
- Streaming messages với markdown rendering
- Tool call: hiển thị tên tool + args khi agent đang gọi, kết quả khi xong
- Toolbar trong chat input:
  - 🔧 **Tools** → ToolsPopover (bật/tắt browser/website tools)
  - ⚙️ **MCP** → panel thêm custom MCP servers
  - 🎯 **Skills** → panel add/manage skills
- Provider selector (Claude / OpenAI / VNGCloud / Custom)
- Settings icon góc trên phải → SettingsView

### Cấu hình agent-service URL
- Lưu trong `chrome.storage.sync` với key `agentServiceUrl` (default: `http://localhost:3000`)
- User config qua Settings tab mới

---

## Phase 2 — Agent Service

**Mục tiêu:** Service backend xử lý chat, tool orchestration, multi-provider LLM.

### Package structure

```
packages/agent-service/
├── package.json
├── .env.example
├── server.js                    ← HTTP server, routes
├── routes/
│   └── chat.js                  ← POST /chat — main streaming endpoint
├── providers/
│   ├── index.js                 ← factory: tạo provider từ config
│   ├── anthropic.js             ← Anthropic SDK (claude-3-5-sonnet, etc.)
│   └── openai-compat.js         ← OpenAI SDK (OpenAI, OpenRouter, LiteLLM, VNGCloud)
├── mcp/
│   └── client.js                ← MCP Streamable HTTP client → native-server
│                                    fetch tools, call tools, maintain session
├── memory/
│   ├── short-term.js            ← conversation buffer (Map, sliding window)
│   └── long-term.js             ← SQLite + sqlite-vec (Phase 3)
├── skills/
│   └── registry.js              ← load skills, expose as tools + system prompts
└── README.md
```

### Endpoints

| Method | Path | Mô tả |
|--------|------|-------|
| `POST` | `/chat` | Streaming SSE chat với agent |
| `GET` | `/health` | Health check |
| `GET` | `/tools` | List available tools (từ native-server MCP) |
| `GET` | `/config` | Config hiện tại (không expose keys) |

### POST /chat request/response

```json
// Request
{
  "messages": [
    { "role": "user", "content": "Mở tab mới và vào google.com" }
  ],
  "conversationId": "uuid",       // để maintain short-term memory
  "enabledTools": ["browser_tabs_create", "browser_navigate_to", ...]
}

// Response: text/event-stream (Vercel AI SDK format)
data: {"type":"text-delta","textDelta":"Tôi sẽ mở tab mới..."}
data: {"type":"tool-call","toolCallId":"...","toolName":"browser_tabs_create","args":{}}
data: {"type":"tool-result","toolCallId":"...","result":{...}}
data: {"type":"finish","finishReason":"stop"}
```

### Provider config (.env)

```bash
# Provider: anthropic | openai | openai-compat
PROVIDER=anthropic

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6   # default model

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# OpenAI-compatible (OpenRouter, LiteLLM, VNGCloud, etc.)
CUSTOM_BASE_URL=https://api.openrouter.ai/v1
CUSTOM_API_KEY=sk-...
CUSTOM_MODEL=anthropic/claude-3-5-sonnet

# VNGCloud example:
# CUSTOM_BASE_URL=https://api.vngcloud.vn/ai/v1
# CUSTOM_API_KEY=...

# MCP (native-server)
MCP_SERVER_URL=http://localhost:8080/mcp
MCP_AUTH_TOKEN=your-native-server-token

# Service
PORT=3000
CORS_ORIGINS=chrome-extension://,http://localhost
```

### System prompt cho browser agent

```
You are a browser automation agent with access to browser tools via MCP.

You can:
- Open, close, and navigate browser tabs
- Read page content and interact with elements
- Manage bookmarks, history, and downloads
- Execute JavaScript on pages
- Take screenshots

When the user asks you to do something on a webpage:
1. Use the available browser tools to accomplish the task
2. Be concise — report what you did, not every step
3. If a tool call fails, explain why and suggest alternatives
4. Always confirm destructive actions (closing tabs, clearing data) before proceeding

Current date: {date}
```

---

## Phase 3 — Memory System

**Mục tiêu:** Agent nhớ context giữa các conversation.

### Short-term memory
- In-memory `Map<conversationId, Message[]>`
- Sliding window: 20 messages gần nhất
- Tự động clear sau 30 phút không hoạt động

### Long-term memory (SQLite + sqlite-vec)
```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  summary TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT,
  content TEXT,          -- fact hoặc summary
  embedding BLOB,        -- vector embedding
  importance REAL,       -- 0-1 score
  created_at INTEGER
);
```

**Quy trình lưu memory:**
1. Khi conversation kết thúc (user đóng chat / sau 5 phút idle) → summarize → embed → lưu
2. Đầu conversation → embed user message → semantic search → inject top-5 memories vào system prompt

**Embedding:** Dùng model embedding từ provider đang config (OpenAI `text-embedding-3-small` hoặc tương đương).

---

## Phase 4 — Skills + Custom MCP

**Mục tiêu:** Mở rộng agent với skills và custom MCP servers.

### Skills format

```javascript
// packages/agent-service/skills/example-skill.js
export default {
  name: 'web-researcher',
  description: 'Searches and summarizes web content',
  systemPrompt: 'When asked to research a topic, use browser tools to open multiple sources...',
  tools: [
    // optional: additional tool definitions (không phải MCP)
  ]
}
```

### Custom MCP Config

User thêm qua UI, lưu trong `chrome.storage.sync`:
```json
{
  "customMcpServers": [
    {
      "name": "my-tool",
      "url": "http://localhost:9000/mcp",
      "token": "...",
      "enabled": true
    }
  ]
}
```

Agent-service aggregate tools từ:
1. `native-server` (browser tools + website tools) — luôn bật
2. Các custom MCP servers user đã add

---

## Progress Log

### 2026-06-13
- [x] Thiết kế kiến trúc tổng thể
- [x] Viết implementation plan
- [x] Tạo `packages/agent-service` với đầy đủ cấu trúc
  - [x] `server.js` — HTTP server, CORS, routing
  - [x] `routes/chat.js` — POST /chat streaming SSE với Vercel AI SDK
  - [x] `providers/index.js` — factory Anthropic / OpenAI / OpenAI-compat
  - [x] `mcp/client.js` — MCP Streamable HTTP client, auto-reconnect
  - [x] `memory/short-term.js` — in-memory conversation history, sliding window
- [x] Cập nhật Chat UI trong extension
  - [x] `views/ChatView.tsx` — main chat interface với useChat (@ai-sdk/react)
  - [x] `components/ToolsPopover.tsx` — ToolsPanel trong Radix Popover
  - [x] `lib/agentServiceClient.ts` — config + health check
  - [x] Cập nhật `App.tsx` — ChatView là màn hình chính
  - [x] Thêm CSS variables cho chat UI
  - [x] Thêm `localhost` vào `host_permissions` trong wxt.config.ts
- [x] Extension build thành công (379ms, không có error)
- [x] `better-sqlite3` native module built thành công

**Next steps:**
- [ ] Test end-to-end: start native-server + agent-service + extension, chat với agent
- [ ] Implement Settings UI cho agent-service config (URL, provider)
- [ ] Phase 3: Long-term memory với SQLite + sqlite-vec

---

## Notes & Gotchas

1. **Extension không thể fetch `localhost` trực tiếp** trừ khi được list trong `host_permissions` của manifest. Cần thêm `http://localhost:3000/*` vào `wxt.config.ts`.

2. **CORS:** Agent-service cần allow `chrome-extension://` origin (wildcard vì extension ID thay đổi theo build).

3. **Streaming trong extension:** `fetch` với `ReadableStream` hoạt động tốt trong extension context. Không cần polyfill.

4. **Tool list sync:** Agent-service fetch tool list từ native-server mỗi khi có chat request (hoặc cache 30s). User có thể bật/tắt tools từ extension — agent-service nhận `enabledTools` list từ request, filter trước khi pass cho LLM.

5. **Port conflicts:** native-server = 8080, agent-service = 3000. Hai service hoàn toàn độc lập.

6. **native-server session:** Agent-service maintain một MCP session với native-server (session ID trong header). Nếu native-server restart, cần re-initialize session.
