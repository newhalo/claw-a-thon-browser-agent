# Bug: Save Memory không hoạt động

## Triệu chứng

- Tool `Save Memory` được gọi thành công (hiển thị trong chat với trạng thái completed)
- Sau khi Refresh ở trang Settings > Memory, không thấy memory nào được lưu
- Memory list vẫn hiển thị "Chưa có memory nào"

## Ảnh chụp

Session: user nói "tôi tên Luân" → agent gọi tool Save Memory → refresh → list trống

## Hướng điều tra

1. **Kiểm tra agent-service memory route** — `POST /memory` có nhận được request không? Xem logs của agent-service sau khi tool được gọi
2. **Kiểm tra MCP tool call** — Tool `Save Memory` thực ra gọi qua MCP (native-server). Verify MCP server URL còn hoạt động: `GET /health` trên MCP endpoint
3. **Kiểm tra storage backend** — Long-term memory lưu ở đâu? File-based hay in-memory? Nếu in-memory thì mất khi restart service
4. **Kiểm tra GET /memory** — UI Refresh gọi endpoint nào để fetch list? Đảm bảo cùng namespace/conversationId với lúc save
5. **So sánh save vs fetch** — Có thể save dùng một key/scope, fetch dùng key khác → không match

## Files liên quan cần đọc

- `packages/agent-service/memory/long-term.js` — logic save/fetch memory
- `packages/agent-service/routes/chat.js` — cách tool Save Memory được gọi
- `packages/chrome-extension/entrypoints/options/App.tsx` — MemoryTab, cách fetch memory list để hiển thị
- `packages/native-server/` (nếu có) — MCP server xử lý tool Save Memory
