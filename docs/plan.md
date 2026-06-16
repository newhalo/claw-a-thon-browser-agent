# Browser Agent — Plan

> Last updated: 2026-06-15

| # | Item | Status |
|---|------|--------|
| 1 | Stream truncation handling — log `finishReason`, alert user on `"length"` | ✅ Done |
| 2 | Skeleton loading — shimmer khi model đang suy nghĩ | ✅ Done |
| 3 | Chat sessions / history — lưu `chrome.storage.local`, new chat + history panel | ✅ Done |
| 4 | ↑↓ navigate message history trong input box | ✅ Done |
| 5 | TokensPanel gộp vào Settings dưới group Security | ✅ Done |
| 6 | Long-term memory — SQLite + FTS5, inject top-5 vào system prompt | ✅ Done |
| 7 | Custom MCP Servers — Settings UI + multi-client trong agent-service | ✅ Done |
| 8 | Pre-defined Agent Skills — `/skills` endpoint + SkillsChipBar UI | ✅ Done |
| 9 | Auto context compression — `compressHistory()` trong `routes/chat.js` | ✅ Done |
| 10 | VNGCloud Gemini 429 auto retry/backoff — hiện detect + báo user, chưa tự retry | ⚠️ Partial |
| 11 | Re-design UI extension — giao diện đẹp hơn, thân thiện hơn | 📋 Todo |
