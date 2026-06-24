# Browser Agent — Master Plan

> Last updated: 2026-06-23

## Backlog

Thứ tự ưu tiên theo **impact × effort**. Cập nhật trạng thái sau mỗi sprint.

| # | Item | Impact | Effort | Status |
|---|------|--------|--------|--------|
| 1 | Stream truncation — log `finishReason`, alert user on `"length"` | 🔴 Cao | S | ✅ Done |
| 2 | Skeleton loading — shimmer khi model đang suy nghĩ | 🟡 Trung | XS | ✅ Done |
| 3 | Chat sessions / history — `chrome.storage.local`, new chat + history panel | 🟡 Trung | M | ✅ Done |
| 4 | ↑↓ navigate message history trong input box | 🟢 Thấp | XS | ✅ Done |
| 5 | TokensPanel gộp vào Settings dưới group Security | 🟢 Thấp | XS | ✅ Done |
| 6 | Long-term memory — SQLite + FTS5, inject top-5 vào system prompt | 🟡 Trung | L | ✅ Done |
| 7 | Custom MCP Servers — Settings UI + multi-client trong agent-service | 🟡 Trung | M | ✅ Done |
| 8 | Pre-defined Agent Skills — `/skills` endpoint + SkillsPopover UI | 🔴 Cao | M | ✅ Done |
| 9 | Auto context compression — `compressHistory()` trong `routes/chat.js` | 🔴 Cao | M | ✅ Done |
| 10 | Re-design UI extension — giao diện đẹp hơn, thân thiện hơn | 🔴 Cao | L | ✅ Done |
| 11 | toolsSupported auto-detect — `POST /detect-capabilities`, Auto-detect button | 🟢 Thấp | S | ✅ Done |
| 12 | User login khi startup — Google OAuth (Phase 1) + VNG SSO stub (Phase 2) | 🔴 Cao | M | ✅ Done |
| 13 | Skill auto-suggest theo URL — badge gợi ý khi tab match `targetUrls` của skill | 🔴 Cao | S | ✅ Done |
| 14 | Memory Settings UI — phân trang + search box (FTS5), sort theo importance/date | 🟡 Trung | S | ❌ Todo |
| 15 | Context Management — loading indicator khi `compressHistory` đang chạy trong chat view | 🟡 Trung | XS | ✅ Done |
| 16 | VNGCloud Gemini 429 auto retry/backoff — exponential backoff + `Retry-After` header | 🟡 Trung | S | ❌ Todo |
| 17 | User-custom skills — DB `user_skills`, CRUD API `/skills/custom`, UI form | 🟡 Trung | M | ❌ Todo |
| 18 | Memory summarization dùng model nhỏ hơn — giảm latency/cost cho consolidation | 🟢 Thấp | S | ❌ Todo |
| 19 | Memory embedding search — pagination + ANN khi DB > 500 rows | 🟢 Thấp | M | ❌ Todo |
| 20 | Memory recency scoring — ưu tiên memories gần đây trong FTS5 fallback | 🟢 Thấp | S | ❌ Todo |
| 21 | Content script auto-reconnect sau Service Worker restart (Chrome MV3) | 🟢 Thấp | S | ❌ Todo |

**Effort:** XS < 2h · S < 1 ngày · M 2–3 ngày · L 1+ tuần

---

## Changelog

### 2026-06-13 — Phase 1 & 2 core
- Thiết kế kiến trúc tổng thể
- Tạo `packages/agent-service`: server.js, chat.js, providers/index.js, mcp/client.js, memory/short-term.js
- Chat UI: ChatView.tsx, ToolsPopover.tsx, agentServiceClient.ts, App.tsx routing, CSS variables
- `better-sqlite3` native module built thành công

### 2026-06-13 — Phase 2 hardening
- **Multi-provider**: Anthropic / OpenAI / openai-compat với runtime `POST /provider-config`
- **SetupView**: first-run wizard khi provider chưa config
- **VNGCloud Gemini compat**: `patchToolCallIndexFetch` inject `"index":0` vào SSE chunks
- **Custom system prompt**: stored in extension, pushed to agent-service on startup
- **System prompt escalation**: guide agent text → HTML → find_elements → screenshot
- **503 recovery**: ChatView re-push provider config và retry khi service restart
- **Rate limit (429)**: `maxRetries: 0`, error message qua `getErrorMessage`
- **Ordered segments**: `segments: MessageSegment[]` — tool blocks hiện đúng vị trí timeline

### 2026-06-13 — Stability fixes
- **MaxListenersExceededWarning**: `server.setMaxListeners(50)` + clean shutdown (`native-server/server.js`)
- **MCP 400 "unknown session"**: reset+re-init khi gặp 400 trong `listTools()` và `callTool()`

### 2026-06-13 — Sprint 1
- **#2 Skeleton loading**: `SkeletonMessage` shimmer 3 dòng, `isWaitingFirstChunk` state
- **#4 Input ↑↓ history**: `sentHistory[]`, ArrowUp/Down handler trong textarea
- **#5 Merge Tokens → Settings**: `TokensPanel` nhúng vào Settings, xóa tab "🔑 Tokens"

### 2026-06-13 — Sprint 2 (Skills)
- **#8 Skills backend**: file-based `skills/<id>/SKILL.md` (agentskills.io format), `GET /skills`, inject systemPrompt vào `/chat`
- **Built-in skills**: `web-researcher`, `form-filler`, `data-analyst`, `tab-manager`, `page-monitor`
- **#8 SkillsPopover UI**: dropdown cạnh ToolsPopover, active count badge, toggle per skill

### 2026-06-14 — UI polish
- SkillsChipBar → SkillsPopover (gọn hơn)
- Textarea vertical align: `alignSelf: center` (1 dòng) / `flex-start` (multiline)
- Send button ghost style: transparent default, accent on hover

### 2026-06-14 — Sprint 2 remaining + Settings UX overhaul
- Options page full-screen (`entrypoints/options/`) với sidebar 4 tabs: General, Provider, Skills, Security
- Custom skills từ URL: skills.sh, GitHub directory, raw SKILL.md — `hasScripts` warning badge
- Create skill manual: form nhập name, icon, description, category, instructions
- `chrome.storage.sync.onChanged` — side panel tự update khi options page thay đổi

### 2026-06-14 — Long-term memory (#6)
- `memory/long-term.js`: SQLite + FTS5 + cosine similarity trong JS
- `getEmbeddingModel()`: `text-embedding-3-small` cho openai/openai-compat, fallback FTS5 cho anthropic
- Inject relevant memories vào system prompt trước mỗi request; `consolidateConversation` async sau `onFinish`
- `GET /memories`, `POST /memories/clear`, `DELETE /memories/:id`
- Options page tab 🧠 Memory: xem list, stats, xóa entry, clear all

### 2026-06-14 — Provider UX + auto-detect (#11)
- Custom LLM Provider form: type selector (openai-compat / anthropic / openai), Base URL, Model ID, Tools/Vision checkboxes
- `POST /detect-capabilities`: test tool call thật + vision test (1×1 PNG)
- ExternalMcpGroupCard: collapse/expand + per-tool toggle + bulk toggle, `disabledTools` denylist

### 2026-06-15 — Long-term memory bugfixes
- Consolidation silent fail → đổi `.catch(() => {})` thành `.catch(err => console.warn(...))`
- Embedding model hardcoded → thêm `embeddingModel` field toàn bộ stack, configurable trong UI
- `generateText` hang → bypass AI SDK, dùng `fetch` trực tiếp với `AbortSignal.timeout(30_000)`

### 2026-06-15 — Context compression bugfix (#9)
- `compressHistory` hang: same root cause — dùng `fetch` trực tiếp cho openai/openai-compat, AI SDK chỉ cho Anthropic

### 2026-06-15 — Long-term memory improvements
- Turn-based consolidation: `CONSOLIDATE_EVERY_N_TURNS=5` thay vì time-based debounce
- Topic merge on save: cosine similarity ≥ 0.85 → UPDATE thay vì INSERT
- `memoryConfig.maxEntries` (default 200) + auto-prune theo importance
- `save_memory` built-in tool: agent gọi proactively khi gặp thông tin quan trọng
- `deduplicateMemories(threshold)`: merge pairs ≥ 0.82, endpoint `POST /memories/deduplicate`

### 2026-06-15 — GFM table rendering fix
- `remarkGfm` missing trong `AssistantMessage` segments renderer → thêm vào cả hai `ReactMarkdown` usages

### 2026-06-14 — Sprint 3 & 4
- **#9 Auto context compression**: `estimateTokens()` + `compressHistory()`, trigger ở 60k tokens, `X-Context-Compressed` header, UI indicator
- **#3 Chat sessions + History**: `HistoryPanel` overlay, auto-save sau mỗi response, `handleNewChat` lưu session trước khi tạo mới
- **#7 Custom MCP Servers**: Options page tab MCP, Paste JSON import (Cursor/Claude format), Manual form, `POST /test-mcp` proxy; multi-server backend `Map<serverId, ServerState>`, `POST /external-mcp-config`

---

## Notes & Gotchas

1. Extension không thể fetch `localhost` trừ khi được list trong `host_permissions` — cần thêm `http://localhost:3000/*` vào `wxt.config.ts`.
2. CORS: agent-service cần allow `chrome-extension://` origin (wildcard vì extension ID thay đổi theo build).
3. Port conflicts: native-server = 8080, agent-service = 3000. Hai service hoàn toàn độc lập.
4. Agent-service maintain MCP session với native-server. Nếu native-server restart cần re-initialize session.
5. `patchToolCallIndexFetch` (VNGCloud compat) wrap streaming — AI SDK `generateText` không resolve được khi wrapped → luôn dùng `fetch` trực tiếp với `AbortSignal.timeout` cho các call ngoài main chat stream.
