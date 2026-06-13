# Agent Service

Backend service cho Chat Agent trong Chrome extension. Xử lý LLM orchestration, MCP tool routing, và short-term memory.

Chạy trên port **3000** (độc lập với `native-server` port 8080).

## Cài đặt

```bash
cp .env.example .env
# Điền API key và config vào .env

pnpm install
pnpm rebuild better-sqlite3  # lần đầu cần rebuild native module
```

## Chạy

```bash
# Dev (auto-restart khi thay đổi file)
pnpm dev

# Production
pnpm start
```

## Cấu hình `.env`

| Biến | Mô tả | Bắt buộc |
|------|-------|----------|
| `PROVIDER` | `anthropic` \| `openai` \| `openai-compat` | Có |
| `ANTHROPIC_API_KEY` | Anthropic API key | Nếu dùng Anthropic |
| `ANTHROPIC_MODEL` | Model ID (default: `claude-sonnet-4-6`) | Không |
| `OPENAI_API_KEY` | OpenAI API key | Nếu dùng OpenAI |
| `OPENAI_MODEL` | Model ID (default: `gpt-4o`) | Không |
| `CUSTOM_BASE_URL` | Base URL cho OpenAI-compat providers | Nếu dùng openai-compat |
| `CUSTOM_API_KEY` | API key cho custom provider | Nếu dùng openai-compat |
| `CUSTOM_MODEL` | Model ID cho custom provider | Nếu dùng openai-compat |
| `MCP_SERVER_URL` | URL native-server MCP endpoint | Có |
| `MCP_AUTH_TOKEN` | Bearer token cho native-server | Có |
| `PORT` | Port của service (default: 3000) | Không |
| `CORS_ORIGINS` | Allowed origins, phân cách bởi dấu phẩy | Không |

## OpenAI-compatible providers

Bất kỳ provider nào hỗ trợ OpenAI API format đều dùng được:

```bash
# OpenRouter
PROVIDER=openai-compat
CUSTOM_BASE_URL=https://openrouter.ai/api/v1
CUSTOM_API_KEY=sk-or-...
CUSTOM_MODEL=anthropic/claude-3-5-sonnet

# LiteLLM
PROVIDER=openai-compat
CUSTOM_BASE_URL=http://localhost:4000
CUSTOM_API_KEY=anything
CUSTOM_MODEL=claude-3-5-sonnet-20241022

# VNGCloud AI Platform
PROVIDER=openai-compat
CUSTOM_BASE_URL=https://your-vng-endpoint/v1
CUSTOM_API_KEY=your-key
CUSTOM_MODEL=your-model
```

## API Endpoints

### `POST /chat`

Streaming chat với browser agent.

```bash
curl -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [{"role": "user", "content": "Liệt kê các tab đang mở"}],
    "conversationId": "optional-uuid"
  }'
```

Response: `text/event-stream` theo Vercel AI SDK data stream format.

### `GET /health`

```bash
curl http://localhost:3000/health
# {"status":"ok","service":"agent-service","port":3000}
```

### `GET /tools`

List các MCP tools available từ native-server.

### `POST /mcp/reset`

Reset MCP session (dùng khi native-server restart).

## Kiến trúc

```
Chrome Extension (useChat)
    │
    │ POST /chat (SSE stream)
    ▼
agent-service (port 3000)
    ├── providers/     → Anthropic / OpenAI / Custom
    ├── mcp/client.js  → native-server (port 8080) MCP tools
    ├── memory/        → short-term conversation history
    └── skills/        → (Phase 4) skill registry
    │
    │ MCP Streamable HTTP
    ▼
native-server (port 8080)
    └── extension provider relay → browser tools
```
