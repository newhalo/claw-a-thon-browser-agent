# Claw-a-thon Browser Agent

AI agent tích hợp vào Chrome, tự động hóa tác vụ trình duyệt bằng ngôn ngữ tự nhiên.

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
