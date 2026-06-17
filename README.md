# Claw-a-thon Browser Agent

**[Trang chủ & Hướng dẫn cài đặt →](https://endpoint-27165b8c-a455-4662-a014-7b1fdc133186.agentbase-runtime.aiplatform.vngcloud.vn)**

Chrome extension biến trình duyệt thành một AI agent có thể nhận lệnh bằng ngôn ngữ tự nhiên và tự thực hiện các tác vụ — điều hướng, click, điền form, chụp màn hình, quản lý tab, đọc nội dung trang, và hơn 75 browser tool khác.

### Dùng qua Chat UI

Mở side panel của extension, nhập yêu cầu bằng tiếng Việt hay tiếng Anh — agent tự suy luận và thực hiện từng bước, stream kết quả trực tiếp. Hỗ trợ Anthropic, OpenAI, và bất kỳ provider nào tương thích OpenAI API (VNGCloud, OpenRouter, v.v.).

### Dùng qua MCP client (Cursor, Claude Desktop, ...)

**native-server** expose một MCP Streamable HTTP endpoint — cho phép bất kỳ MCP client nào trên máy người dùng kết nối vào và điều khiển trình duyệt Chrome đang mở, không cần thêm cài đặt nào khác.

```json
// Cursor / Claude Desktop mcp config
{
  "mcpServers": {
    "browser-agent": {
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer <your-token>" }
    }
  }
}
```

### Bảo mật

Mọi request đến native-server đều yêu cầu Bearer token — không có token hợp lệ thì bị chặn, kể cả từ localhost. Token có thể cấu hình tĩnh qua `AUTH_TOKEN` / `AUTH_TOKENS` trong `.env`, hoặc quản lý động (thêm / xóa / bật / tắt) qua tab **Tokens** trong extension mà không cần restart server. Các browser tool có nguy cơ cao (cookies, localStorage, lịch sử, download, execute script...) mặc định bị tắt và phải bật thủ công.

---

## Cài đặt nhanh

Truy cập **[trang chủ](https://endpoint-27165b8c-a455-4662-a014-7b1fdc133186.agentbase-runtime.aiplatform.vngcloud.vn)** để tải extension và xem hướng dẫn cài đặt từng bước.

Hoặc tải trực tiếp bản mới nhất tại [GitHub Releases](https://github.com/newhalo/claw-a-thon-browser-agent/releases/latest), giải nén rồi load folder `dist/chrome-mv3/` vào Chrome qua `chrome://extensions` → **Load unpacked**.

## Docs

- [Mô tả Agent](docs/agent-description.md) — Agent giải quyết gì, ai dùng, hoạt động ra sao
- [Hướng dẫn sử dụng Extension](docs/extension-user-guide.md) — Build, load Chrome, cấu hình servers, chat, tools, MCP
- [Kiến trúc & Handoff](docs/browser-agent-handoff.md) — Chi tiết kỹ thuật toàn hệ thống

## Packages

| Package | Mô tả |
|---------|-------|
| [`packages/chrome-extension`](packages/chrome-extension/README.md) | Chrome Extension (WXT, React) |
| [`packages/agent-service`](packages/agent-service/README.md) | LLM orchestration backend |
| [`packages/native-server`](packages/native-server/README.md) | MCP gateway (authenticated) |
| [`packages/WebMCP`](packages/WebMCP) | WebMCP protocol library |
