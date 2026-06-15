# Hướng dẫn sử dụng Chrome Extension

## Tổng quan hệ thống

Extension hoạt động cùng với 2 server backend:

| Component | Vai trò | Port mặc định |
|-----------|---------|---------------|
| **native-server** | MCP gateway — relay tool calls từ LLM về browser | `8080` |
| **agent-service** | LLM orchestration — nhận chat, gọi model, gọi tools | `3000` (local) / `8080` (prod) |
| **Chrome Extension** | Chat UI + browser tool executor | — |

---

## Phần 1: Build Extension

### Yêu cầu

- Node.js 20+
- pnpm 10+

### Các bước

```bash
# Cài dependencies
cd packages/chrome-extension
pnpm install

# Build production
pnpm build
# Output: packages/chrome-extension/dist/chrome-mv3/

# Build development (watch mode — tự rebuild khi thay đổi file)
pnpm dev
```

---

## Phần 2: Load Extension vào Chrome

1. Mở `chrome://extensions/`
2. Bật **Developer mode** (toggle góc trên bên phải)
3. Click **Load unpacked**
4. Chọn thư mục: `packages/chrome-extension/dist/chrome-mv3`
5. Extension xuất hiện trong danh sách với tên **Claw-a-thon Browser Agent**

Để mở side panel: click icon extension trên thanh toolbar (hoặc dùng phím tắt).

---

## Phần 3: Chạy Backend Servers

### 3a. native-server (bắt buộc)

```bash
cd packages/native-server
cp .env.example .env
# Sửa AUTH_TOKEN và PORT trong .env

pnpm install
pnpm start
```

Hoặc chạy nhanh không qua .env:

```bash
AUTH_TOKEN=my-secret-token PORT=8080 node server.js
```

Biến môi trường quan trọng:

| Biến | Mô tả | Bắt buộc |
|------|-------|----------|
| `AUTH_TOKEN` | Token xác thực cho mọi request | Có |
| `AUTH_TOKENS` | Danh sách token phân cách bởi dấu phẩy (nhiều token) | Không |
| `PORT` | Port public của gateway (mặc định `8080`) | Không |
| `ALLOW_NO_AUTH` | Bỏ qua xác thực khi dev local (`true`) | Không |
| `DEV_EXTENSION_ID` | Extension ID khi dùng bản dev chưa publish | Không |

### 3b. agent-service (bắt buộc cho chat)

```bash
cd packages/agent-service
cp .env.example .env
# Điền PROVIDER và API key tương ứng

pnpm install
pnpm start
```

Biến môi trường quan trọng:

| Biến | Mô tả |
|------|-------|
| `PROVIDER` | `anthropic` \| `openai` \| `openai-compat` |
| `ANTHROPIC_API_KEY` | API key nếu dùng Anthropic |
| `OPENAI_API_KEY` | API key nếu dùng OpenAI |
| `CUSTOM_BASE_URL` | Base URL nếu dùng openai-compat (VNGCloud, OpenRouter...) |
| `CUSTOM_API_KEY` | API key cho custom provider |
| `CUSTOM_MODEL` | Model ID cho custom provider |
| `MCP_SERVER_URL` | URL native-server (mặc định `http://localhost:8080`) |
| `MCP_AUTH_TOKEN` | Auth token của native-server |
| `PORT` | Port agent-service. **Bắt buộc `8080` khi deploy lên AgentBase** |

> **Lưu ý:** Provider cũng có thể cấu hình trực tiếp qua giao diện extension (không cần .env).

---

## Phần 4: Cấu hình Extension lần đầu (SetupView)

Lần đầu mở extension khi chưa có provider được cấu hình, màn hình **SetupView** sẽ hiện ra:

1. **Native Server URL** — nhập URL của native-server (VD: `http://localhost:8080` hoặc URL prod)
2. **Auth Token** — token khớp với `AUTH_TOKEN` trong .env của native-server
3. **LLM Provider** — chọn một trong:
   - `anthropic` — nhập Anthropic API key, chọn model
   - `openai` — nhập OpenAI API key, chọn model
   - `openai-compat` — nhập Base URL + API key + Model. Tick **"Hỗ trợ function/tool calling"** nếu model hỗ trợ (Gemini Flash, GPT-4o qua custom endpoint). Để trống nếu model không hỗ trợ tool calling (Gemma, v.v.)
4. Click **Lưu cấu hình**

Cấu hình được lưu vào `chrome.storage.sync` và tự động restore khi mở lại extension.

---

## Phần 5: Chat với Agent

Sau khi cấu hình xong, màn hình chat hiện ra:

- Nhập yêu cầu bằng ngôn ngữ tự nhiên (tiếng Việt hoặc tiếng Anh) vào ô nhập liệu phía dưới
- Nhấn **Enter** hoặc click nút gửi
- Agent sẽ suy nghĩ và thực hiện từng bước, hiển thị:
  - **Text** — suy luận và giải thích của agent
  - **Tool call block** — tên tool được gọi + tham số + kết quả trả về
- Stream kết quả hiển thị theo thời gian thực

**Ví dụ yêu cầu:**

```
Mở tab mới và truy cập google.com
Liệt kê tất cả tab đang mở
Chụp màn hình trang hiện tại
Điền form đăng ký với thông tin: tên = "Nguyen Van A", email = "a@example.com"
Tổng hợp nội dung bài viết trên trang này
```

---

## Phần 6: Quản lý Tools

Click icon **Tools** (⚙ hoặc công cụ) để mở ToolsPopover:

- Danh sách ~75 browser tools được nhóm theo chức năng (Tabs, Navigation, Page Interaction, Storage, v.v.)
- Toggle bật/tắt từng tool
- Các tool **mặc định tắt** (nguy cơ cao) gồm: `execute_script`, cookies, localStorage, lịch sử trình duyệt, download, v.v.
- `browser_take_screenshot` mặc định **bật** (agent cần để nhìn trang)

Chỉ các tool đang bật mới được gửi kèm request chat — model sẽ không thể gọi tool đã tắt.

---

## Phần 7: Settings

Click icon ⚙ **Settings** để thay đổi cấu hình sau khi đã setup:

### Native Server
- Thay đổi URL và auth token của native-server
- Badge trạng thái hiển thị kết nối đang OK hay lỗi

### LLM Provider
- Xem provider + model đang dùng
- Click **Chỉnh sửa** để đổi provider/model/API key mà không cần qua SetupView lại

### Custom Instructions
- Textarea để nhập hướng dẫn bổ sung cho agent (appended vào system prompt)
- VD: "Luôn trả lời bằng tiếng Việt", "Khi điền form luôn hỏi xác nhận trước"
- Lưu vào `chrome.storage.sync`, tự động restore

---

## Phần 8: Quản lý Token native-server

Tab **Tokens** (🔑) cho phép quản lý dynamic tokens của native-server:

- **Xem danh sách token** hiện có (tên + trạng thái active)
- **Thêm token mới** — tên + token string
- **Xóa token** — xóa ngay trên server
- **Kích hoạt / tắt** token không cần xóa

> Token tĩnh (`AUTH_TOKEN` trong .env) không hiển thị ở đây — chỉ quản lý được dynamic tokens.

---

## Phần 9: Kết nối MCP từ client ngoài (Cursor, Claude Desktop...)

native-server expose MCP Streamable HTTP endpoint. Bất kỳ MCP client nào cũng có thể kết nối:

```
URL: http://localhost:8080/mcp  (hoặc URL prod)
Auth: Authorization: Bearer <AUTH_TOKEN>
```

**Ví dụ với curl:**

```bash
# Initialize session
curl -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer my-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"test","version":"1.0"}},"id":1}'

# List tools (dùng mcp-session-id từ response trên)
curl -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer my-secret-token" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: <session-id>" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'
```

**Cấu hình trong Cursor / Claude Desktop:**

```json
{
  "mcpServers": {
    "browser-agent": {
      "url": "http://localhost:8080/mcp",
      "headers": {
        "Authorization": "Bearer my-secret-token"
      }
    }
  }
}
```

---

## Phần 10: Deploy lên AgentBase (Production)

Xem hướng dẫn trong README của từng package:

- [`packages/agent-service/README.md`](../packages/agent-service/README.md#deploy-lên-agentbase) — Gotchas: PORT=8080, bind 0.0.0.0, node:20-slim
- [`packages/native-server/README.md`](../packages/native-server/README.md#deploy-lên-agentbase) — Gotchas: corepack, copy pnpm-lock.yaml

Runtime IDs và endpoints prod được ghi trong các README trên.

---

## Troubleshooting

| Triệu chứng | Nguyên nhân | Giải pháp |
|------------|-------------|-----------|
| Extension mở ra toàn SetupView | Provider chưa cấu hình hoặc agent-service chưa chạy | Chạy agent-service, nhập lại cấu hình |
| "Connection failed" khi test native server | native-server chưa chạy hoặc sai token | Kiểm tra server + token |
| Agent không gọi được tool nào | Tool bị tắt hoặc native-server mất kết nối extension | Bật tool, reload trang sau khi service worker restart |
| Stream bị cắt giữa chừng | Rate limit 429 hoặc context window đầy | Chờ và thử lại; với model openai-compat nên dùng model có context lớn |
| Tool calls không hoạt động với openai-compat | `toolsSupported` chưa bật | Vào Settings → LLM Provider → tick "Hỗ trợ tool calling" |
| Extension báo lỗi sau khi Chrome idle lâu | Background service worker bị Chrome suspend | Reload trang để content script reconnect |
