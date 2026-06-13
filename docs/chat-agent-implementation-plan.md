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
| 4 | Skills + Custom MCP | ongoing | 🔄 **Đang làm (Skills done)** |
| 5 | Pre-defined Agent Skills | 1 tuần | ✅ **Hoàn thành (backend + UI)** |
| 6 | UX Improvements | 1 tuần | 🔄 **Đang làm** |
| 7 | Context Management | 1 tuần | 🔲 Chưa bắt đầu |

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

## Phase 4 — Custom MCP Servers (External Connections)

**Mục tiêu:** Cho phép user kết nối thêm MCP servers bên ngoài (ngoài native-server).

### Custom MCP Config

User thêm qua UI trong Settings → group **External MCP Connections**, lưu trong `chrome.storage.sync`:
```json
{
  "customMcpServers": [
    { "name": "my-tool", "url": "http://localhost:9000/mcp", "token": "...", "enabled": true }
  ]
}
```

Extension push config này lên agent-service. Agent-service aggregate tools từ:
1. `native-server` (browser tools + website tools) — luôn bật
2. Các custom MCP servers user đã add và enable

### UI trong Settings

Group "External MCP Connections":
- List các server: name, URL, status badge (Connected / Error / Disabled)
- Nút **Add**: form nhập name, URL, token (optional)
- Toggle enable/disable per server, nút Delete

### agent-service side

`mcp/client.js` hiện kết nối 1 server. Cần mở rộng thành `Map<serverId, McpClient>`. Khi nhận `/external-mcp-config`, sync danh sách clients, merge tools vào `listTools()`.

---

## Phase 5 — Pre-defined Agent Skills

**Mục tiêu:** agent-service expose một danh sách skill có sẵn (pre-defined). User tick chọn skill trong Chat UI — agent tự động có năng lực phù hợp mà không cần user tự prompt.

**Use case điển hình:**
- ✅ Tick "Marketing Campaign" → agent biết cách dùng các công cụ nội bộ để tạo campaign
- ✅ Tick "VNG Internal Tools" → agent biết cách điều hướng cổng nội bộ, hiểu các khái niệm VNG
- ✅ Tick "Data Analyst" → agent ưu tiên lấy dữ liệu dạng bảng, xuất CSV, tạo summary

### Skill Schema

```js
// packages/agent-service/skills/marketing-campaign.js
export default {
  id: 'marketing-campaign',
  name: 'Marketing Campaign',
  description: 'Tạo và quản lý campaign marketing trên các platform nội bộ',
  icon: '📢',
  category: 'work',           // 'work' | 'productivity' | 'research' | 'dev'

  // Injected vào system prompt khi skill active
  systemPrompt: `
    You have expertise in creating marketing campaigns.
    When the user mentions a campaign, you know to:
    1. Navigate to the campaign management tool at [URL]
    2. Fill in required fields: name, target audience, budget, schedule
    3. Confirm with user before submitting
    Use browser_navigate_to, browser_find_elements, browser_type, browser_click.
  `,

  // Tool names to auto-enable khi skill active (optional)
  requiredTools: ['browser_navigate_to', 'browser_click', 'browser_type', 'browser_take_screenshot'],

  // URL patterns where this skill is most relevant (optional — hiện badge gợi ý)
  targetUrls: ['internal-marketing.vng.vn', 'ads.vng.vn'],
}
```

### API: `GET /skills`

```json
[
  {
    "id": "marketing-campaign",
    "name": "Marketing Campaign",
    "description": "Tạo và quản lý campaign marketing trên các platform nội bộ",
    "icon": "📢",
    "category": "work"
  },
  {
    "id": "vng-internal-tools",
    "name": "VNG Internal Tools",
    "description": "Điều hướng và thao tác trên hệ thống nội bộ VNG",
    "icon": "🏢",
    "category": "work"
  },
  {
    "id": "data-analyst",
    "name": "Data Analyst",
    "description": "Phân tích dữ liệu, đọc bảng, tạo summary",
    "icon": "📊",
    "category": "productivity"
  },
  {
    "id": "web-researcher",
    "name": "Web Researcher",
    "description": "Tìm kiếm, đọc nhiều nguồn, tổng hợp thông tin",
    "icon": "🔍",
    "category": "research"
  }
]
```

### POST /chat — activeSkills field

```json
{
  "messages": [...],
  "conversationId": "...",
  "enabledTools": [...],
  "activeSkills": ["marketing-campaign", "vng-internal-tools"]
}
```

Agent-service: khi nhận `activeSkills`, load skill definitions, append `systemPrompt` của từng skill, merge `requiredTools` vào enabled tools.

### UI: SkillsChipBar trong ChatView

Nằm ngay trên input box (hoặc trong toolbar), hiển thị dưới dạng chips có thể click để toggle:

```
[🔧 Tools] [⚙️ Settings]  |  [📢 Marketing] [🏢 VNG Tools] [+ More skills]
```

- Fetch `GET /skills` khi ChatView mount, cache trong state
- Chip được chọn → highlight (accent border), không chọn → muted
- `+ More skills` → dropdown/modal liệt kê tất cả skills theo category
- Active skills lưu vào `chatStore` và gửi kèm mỗi request

### Auto-suggest skill theo URL hiện tại

Nếu tab đang focus match `targetUrls` của một skill chưa active → hiện badge gợi ý nhỏ:
```
💡 Skill "Marketing Campaign" phù hợp với trang này. [Bật]
```

Background service worker gửi message `ACTIVE_TAB_CHANGED` khi user chuyển tab → ChatView kiểm tra `targetUrls` và show suggestion banner.

### Skill management trong Settings

Settings → group "Agent Skills":
- List tất cả built-in skills: icon, name, description
- Toggle enable/disable per skill (disabled skills không hiện trong SkillsChipBar)
- Nút **+ Add custom skill**: nhập JSON hoặc URL trỏ đến skill file (Phase 4-style user-defined skills)

---

## Progress Log

### 2026-06-13 — Phase 1 & 2 core
- [x] Thiết kế kiến trúc tổng thể, viết implementation plan
- [x] Tạo `packages/agent-service`: server.js, chat.js, providers/index.js, mcp/client.js, memory/short-term.js
- [x] Chat UI: ChatView.tsx, ToolsPopover.tsx, agentServiceClient.ts, App.tsx routing, CSS variables
- [x] `better-sqlite3` native module built thành công

### 2026-06-13 — Phase 2 hardening
- [x] **Multi-provider**: Anthropic / OpenAI / openai-compat với runtime `POST /provider-config`
- [x] **SetupView**: first-run wizard khi provider chưa config
- [x] **Settings**: LLM provider re-config + custom instructions không cần SetupView
- [x] **toolsSupported flag**: openai-compat opt-in checkbox (default off = safe cho Gemma)
- [x] **VNGCloud Gemini compat**: `patchToolCallIndexFetch` inject `"index":0` vào SSE chunks
- [x] **Screenshot default ON**: risk `'high'` → `'medium'`, `<all_urls>` host permission
- [x] **Custom system prompt**: stored in extension, pushed to agent-service on startup
- [x] **System prompt escalation**: guide agent text → HTML → find_elements → screenshot
- [x] **503 recovery**: ChatView re-push provider config và retry khi service restart
- [x] **Rate limit (429)**: `maxRetries: 0`, error message via `pipeDataStreamToResponse({ getErrorMessage })`
- [x] **Ordered segments**: ChatMessage dùng `segments: MessageSegment[]` thay vì content+toolInvocations riêng — tool blocks hiện đúng vị trí timeline
- [x] **Assistant rendering**: flat (không bubble), user rendering giữ bubble

### 2026-06-13 — Stability fixes

- [x] **MaxListenersExceededWarning**: `server.setMaxListeners(50)` + track open connections + clean shutdown SIGINT/SIGTERM (`native-server/server.js`)
- [x] **MCP 400 "unknown session"**: thêm `res.status === 400` vào reset+re-init conditions trong `listTools()` và `callTool()` (`mcp/client.js`) — fix tool calls bị render dạng JSON code block

### 2026-06-13 — Sprint 1 complete

- [x] **#2 Skeleton loading**: `SkeletonMessage` component shimmer 3 dòng, `isWaitingFirstChunk` state (`ChatView.tsx`)
- [x] **#7 Merge Tokens → Settings**: `TokensPanel` nhúng vào `Settings.tsx`, xóa tab "🔑 Tokens" khỏi nav (`App.tsx`)
- [x] **#8 Input ↑↓ message history**: `sentHistory[]` state, ArrowUp/Down handler trong textarea (`ChatView.tsx`)
- [x] Remove Settings button từ chat toolbar (đã có trong header nav)

### 2026-06-13 — Sprint 2 complete (Skills)

- [x] **#3 Skills backend**: refactor sang agentskills.io open standard — file-based `skills/<id>/SKILL.md` (YAML frontmatter + markdown body), `skills/registry.js` load lúc startup, `GET /skills` endpoint, inject `systemPrompt` vào `/chat` khi `activeSkills` active
- [x] **Built-in skills**: `web-researcher`, `form-filler`, `data-analyst`, `tab-manager`, `page-monitor` (5 SKILL.md files)
- [x] **#4 SkillsPopover UI**: dropdown button cạnh ToolsPopover trong toolbar, active count badge, toggle per skill với checkmark, thay thế SkillsChipBar cũ

### 2026-06-14 — UI polish (input area)

- [x] **SkillsChipBar → SkillsPopover**: gọn lại thành dropdown next to ToolsPopover
- [x] **Textarea vertical align**: `alignSelf: center` khi 1 dòng, `flex-start` khi multiline (`isMultiline` state)
- [x] **Send button ghost style**: `SendButton` component — transparent background mặc định, accent on hover, container `flex-end` để button ghim xuống khi multiline

### Pending
- [ ] Phase 3: Long-term memory (SQLite + sqlite-vec) — stub hiện tại
- [ ] Phase 4: Custom MCP servers
- [ ] Phase 5 UX: #5 Auto context compression, #6 Chat sessions + History
- [ ] Sprint 2 remaining: #10 Skill auto-suggest theo URL, #11 Skill management trong Settings
- [ ] Phase 6: Context Management — auto compress + streaming truncation investigation
- [ ] Auto-detect toolsSupported cho openai-compat providers
- [ ] Content script auto-reconnect sau SW restart

---

## Phase 3 — Memory System

**Mục tiêu:** Agent nhớ context giữa các conversation.

### Short-term (đã implement)
- In-memory `Map<conversationId, Message[]>` trong `memory/short-term.js`
- Client (Zustand) gửi full history mỗi request; server chỉ dùng để append vào file

### Long-term (chưa implement — `memory/long-term.js` là stub)

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
  content TEXT,
  embedding BLOB,         -- sqlite-vec vector
  importance REAL,        -- 0.0–1.0
  created_at INTEGER
);
```

**Quy trình:**
1. Conversation idle 5 phút → summarize → embed → lưu vào SQLite
2. Đầu conversation → embed user message → semantic search top-5 → inject vào system prompt

**Embedding provider:** `text-embedding-3-small` (OpenAI) hoặc tương đương từ provider đang config.

---

## Phase 4 — Skills + Custom MCP

**Mục tiêu:** Mở rộng agent với skill bundles và external MCP servers.

### Skills

```js
// packages/agent-service/skills/example-skill.js
export default {
  name: 'web-researcher',
  description: 'Searches and summarizes web content',
  systemPrompt: 'When asked to research a topic, open multiple sources...',
  tools: []   // optional extra tool definitions
}
```

UI trong Settings: list skills đã có, nút Add skill (URL hoặc paste JSON), toggle enable/disable per skill.

Agent-service: khi skill enabled, append `skill.systemPrompt` vào system prompt và merge `skill.tools` vào tool set.

### Custom MCP Servers

Lưu trong `chrome.storage.sync`:
```json
{
  "customMcpServers": [
    { "name": "my-tool", "url": "http://localhost:9000/mcp", "token": "...", "enabled": true }
  ]
}
```

UI trong Settings → group mới "External MCP Connections":
- List các server đã add (name, URL, status badge connected/error)
- Nút Add: form nhập name, URL, token
- Toggle enable/disable, nút Delete

Agent-service aggregate tools từ:
1. `native-server` (browser + website tools) — luôn bật
2. Các custom MCP servers user đã add và enable

---

## Phase 5 — UX Improvements

### 5.1 Skeleton loading khi model đang xử lý

Khi stream chưa có chunk đầu tiên (đã gửi request nhưng chưa nhận `0:` text), hiện animated skeleton thay vì `TypingDots` đơn giản.

```tsx
// ChatView.tsx — thêm state: isWaitingFirstChunk
// Khi sendMessage → set isWaitingFirstChunk = true
// Khi nhận chunk type 'text' đầu tiên → set isWaitingFirstChunk = false
// Render: isWaitingFirstChunk → <SkeletonMessage />, else → TypingDots / streaming content
```

`SkeletonMessage`: 3 dòng gradient animated (shimmer effect), chiều rộng 80%/60%/40%.

### 5.2 Chat sessions + History

**Session model:**
```ts
interface ChatSession {
  id: string;
  title: string;        // auto-generated từ first user message (truncate 40 chars)
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}
```

Lưu vào `chrome.storage.local` (key: `chatSessions`). Giới hạn 50 sessions, xóa oldest khi vượt.

**UI changes:**
- Header bar: thêm nút `+` (new chat) và nút `⏱` (history)
- History panel: list sessions sorted by `updatedAt`, click để load lại session
- `clearHistory` → thay bằng close session + create new (session cũ vẫn trong history)
- `chatStore.ts`: thêm `currentSessionId`, action `loadSession(id)`, `saveCurrentSession()`

### 5.3 Message input history (↑↓ browse)

Trong `ChatView.tsx`:
```ts
const [sentHistory, setSentHistory] = useState<string[]>([]);
const [historyIdx, setHistoryIdx] = useState(-1);
```

`onKeyDown` trong textarea:
- `ArrowUp` khi input rỗng hoặc đang browse → cycle backwards
- `ArrowDown` khi đang browse → cycle forwards (về `''` khi hết)
- Khi gửi → `setSentHistory(prev => [text, ...prev].slice(0, 50))`

Lưu `sentHistory` vào `chrome.storage.local` để giữ qua các lần mở extension.

### 5.4 Merge Tokens vào Settings

`TokensPanel.tsx` được nhúng vào `Settings.tsx` dưới group mới **Security**:
- Đặt sau group "Native Server config"
- Hiển thị danh sách tokens, nút Create/Delete như hiện tại
- Xóa tab "🔑 Tokens" khỏi `App.tsx` nav

---

## Phase 6 — Context Management

### 6.1 Điều tra stream truncation (Qwen / openai-compat)

**Triệu chứng:** Model stream được một hồi rồi dừng đột ngột dù task chưa xong.

**Nguyên nhân có thể:**
1. Context window đầy → model emit `finishReason: "length"` thay vì `"stop"`
2. Provider-side timeout (VNGCloud/OpenRouter có timeout riêng ~30s–60s)
3. `maxSteps: 10` bị hit khi có nhiều tool calls liên tiếp
4. SSE connection bị đứt phía client (extension context)

**Điều tra:**
- Log `finishReason` từ `d:` chunk để phân biệt `"length"` vs `"stop"` vs `"tool-calls"`
- Log tổng token count từ `d:` chunk (`usage.totalTokens`)
- Nếu `"length"` → implement context compression (6.2)
- Nếu timeout → tăng `maxSteps` hoặc thêm retry với exponential backoff

### 6.2 Auto compress + summarize context (giống Claude)

**Trigger:** Khi `usage.totalTokens > threshold` (ví dụ 70% context window của model).

**Quy trình:**
1. Lấy full conversation history
2. Gọi LLM (model nhỏ/rẻ hơn nếu có) với prompt summarization:
   ```
   Summarize this conversation history concisely, preserving all key facts,
   decisions, and context needed to continue the task. Output as a single
   paragraph starting with "Previous conversation summary: ..."
   ```
3. Replace messages cũ bằng 1 message `role: "user"` chứa summary
4. Append lại N messages cuối (sliding window, e.g. 6 messages) để giữ context gần nhất
5. UI: hiện indicator "🗜 Context compressed" trong chat

**Implementation trong `routes/chat.js`:**
```js
// Sau khi build allMessages, check estimated token count
// Nếu vượt threshold → compressHistory(messages) → return compressed messages
```

**Token estimation:** dùng `import { countTokens } from 'ai'` hoặc rough estimate (4 chars ≈ 1 token).

---

## Notes & Gotchas

1. **Extension không thể fetch `localhost` trực tiếp** trừ khi được list trong `host_permissions` của manifest. Cần thêm `http://localhost:3000/*` vào `wxt.config.ts`.

2. **CORS:** Agent-service cần allow `chrome-extension://` origin (wildcard vì extension ID thay đổi theo build).

3. **Streaming trong extension:** `fetch` với `ReadableStream` hoạt động tốt trong extension context. Không cần polyfill.

4. **Tool list sync:** Agent-service fetch tool list từ native-server mỗi khi có chat request (hoặc cache 30s). User có thể bật/tắt tools từ extension — agent-service nhận `enabledTools` list từ request, filter trước khi pass cho LLM.

5. **Port conflicts:** native-server = 8080, agent-service = 3000. Hai service hoàn toàn độc lập.

6. **native-server session:** Agent-service maintain một MCP session với native-server (session ID trong header). Nếu native-server restart, cần re-initialize session.

---

## Priority Backlog

Thứ tự ưu tiên dựa trên **impact × effort**: fix blockers trước, quick wins tiếp, rồi mới features phức tạp.

| # | Item | Phase | Impact | Effort | Trạng thái |
|---|------|-------|--------|--------|---------|
| 1 | **Điều tra stream truncation (Qwen/openai-compat)** | 7.1 | 🔴 Cao | S | 🔲 Chưa làm |
| 2 | **Skeleton loading** | 6.1 | 🟡 Trung | XS | ✅ Done |
| 3 | **Pre-defined Skills — backend** | 5 | 🔴 Cao | M | ✅ Done (agentskills.io SKILL.md format) |
| 4 | **Pre-defined Skills — SkillsPopover UI** | 5 | 🔴 Cao | M | ✅ Done |
| 5 | **Auto context compression** | 7.2 | 🔴 Cao | M | 🔲 Chưa làm |
| 6 | **Chat sessions + History** | 6.2 | 🟡 Trung | M | 🔲 Chưa làm |
| 7 | **Merge Tokens vào Settings** | 6.4 | 🟢 Thấp | XS | ✅ Done |
| 8 | **Input ↑↓ message history** | 6.3 | 🟢 Thấp | XS | ✅ Done |
| 9 | **Custom MCP Servers UI** | 4 | 🟡 Trung | M | 🔲 Chưa làm |
| 10 | **Skill auto-suggest theo URL** | 5 | 🟡 Trung | S | 🔲 Chưa làm |
| 11 | **Skill management trong Settings** | 5 | 🟢 Thấp | S | 🔲 Chưa làm |
| 12 | **Phase 3 — Long-term memory** | 3 | 🟡 Trung | L | 🔲 Chưa làm |
| 13 | **toolsSupported auto-detect** | 2 | 🟢 Thấp | S | 🔲 Chưa làm |
| 14 | **Content script auto-reconnect** | — | 🟢 Thấp | S | 🔲 Chưa làm (known Chrome MV3 limitation, workaround: refresh page) |
| 15 | **User login khi startup extension** | 8 | 🔴 Cao | M | 🔲 Chưa làm |
| 16 | **User-custom skills** | 8 | 🟡 Trung | M | 🔲 Chưa làm |

**Effort:** XS < 2h · S < 1 ngày · M 2–3 ngày · L 1+ tuần

### Nhóm theo sprint gợi ý

**Sprint 1 — Stability + Quick wins** (ưu tiên tuyệt đối)
- #1 Điều tra stream truncation
- #2 Skeleton loading
- #7 Merge Tokens → Settings
- #8 Input ↑↓ history

**Sprint 2 — Pre-defined Skills** (core differentiator)
- #3 Skills backend (`GET /skills`, inject vào `/chat`)
- #4 SkillsChipBar UI
- #10 Auto-suggest theo URL
- #11 Settings management

**Sprint 3 — Context + Sessions**
- #5 Auto context compression
- #6 Chat sessions + History

**Sprint 4 — Extensibility**
- #9 Custom MCP Servers
- #12 Long-term memory
- #13 toolsSupported auto-detect
- #14 Content script reconnect

**Sprint 5 — User Auth + Per-user data**
- #15 User login khi startup extension
- #16 User-custom skills

---

## Phase 8 — User Auth + Per-user Data

**Mục tiêu:** Mỗi user có identity riêng, bộ skill riêng, cài đặt riêng.

### 8.1 User login khi startup extension

Khi extension mở lần đầu (hoặc chưa có auth token), hiện login flow:
- Login bằng VNG SSO hoặc simple username/password qua agent-service
- agent-service trả về `userId` + `authToken` (JWT hoặc opaque token)
- Extension lưu token vào `chrome.storage.local` (không sync — bảo mật hơn)
- Mọi request từ extension đến agent-service đính kèm `Authorization: Bearer <token>`
- agent-service xác thực token, extract `userId` cho mọi request

### 8.2 User-custom skills

Built-in skills (file-based) là shared catalog — giữ nguyên. User-custom skills lưu riêng per-user trong DB.

**DB schema (thêm vào SQLite):**
```sql
CREATE TABLE user_skills (
  id        TEXT PRIMARY KEY,         -- uuid
  user_id   TEXT NOT NULL,
  name      TEXT NOT NULL,
  description TEXT NOT NULL,
  icon      TEXT DEFAULT '🔧',
  category  TEXT DEFAULT 'custom',
  instructions TEXT NOT NULL,         -- markdown, same format as SKILL.md body
  is_public INTEGER DEFAULT 0,        -- future: share with other users
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_user_skills_user ON user_skills(user_id);
```

**API:**
| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/skills` | Built-in + user's custom skills (merged) |
| `POST` | `/skills/custom` | Tạo custom skill |
| `PUT` | `/skills/custom/:id` | Cập nhật |
| `DELETE` | `/skills/custom/:id` | Xóa |

**`GET /skills` logic:**
```js
const builtin = getSkillsPublic();           // từ file, shared
const custom = await getUserSkills(userId);  // từ DB, per-user
return [...builtin, ...custom];
```

**UI trong Settings:**
- Section "My Skills": list custom skills, nút Add/Edit/Delete
- Form tạo/sửa: name, description, icon, category, instructions (markdown textarea)
- Preview instructions trước khi save
