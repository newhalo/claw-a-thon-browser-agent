# MCP-B Native Server Gateway

Service này bọc `@mcp-b/native-server` bằng một lớp authenticated gateway để bạn có thể deploy public nhưng vẫn chặn request không hợp lệ.

## Chức năng

- Tự start MCP-B native host (`mcp-chrome-bridge`) trong cùng process group.
- Expose public HTTP gateway và proxy toàn bộ request vào native host nội bộ.
- Bắt buộc auth token cho mọi endpoint ngoại trừ health/readiness.
- Hỗ trợ chạy bằng Docker để deploy lên AgentBase.

## Yêu cầu

- Node.js 20+
- Chrome extension MCP-B đã kết nối tới native host

## Cấu hình môi trường

Copy file mẫu:

```bash
cp .env.example .env
```

Biến quan trọng:

- `AUTH_TOKEN` hoặc `AUTH_TOKENS`: token dùng để gọi gateway.
- `PORT`: cổng public cho gateway (mặc định `8080`).
- `NATIVE_SERVER_INTERNAL_PORT`: cổng nội bộ cho native host (mặc định `12306`).
- `NATIVE_SERVER_BIN`: tùy chọn override command chạy native host (mặc định auto dùng `@mcp-b/native-server/dist/index.js`).
- `NATIVE_SERVER_ARGS`: tham số bổ sung cho native host (VD `--verbose --log-level debug`).
- `ALLOW_NO_AUTH`: chỉ bật `true` khi debug local.
- `DEV_EXTENSION_ID`: extension ID của bản Chrome extension dev (theo WebMCP native-server).
- `EXTENSION_ID`: alias tương thích ngược; nếu có sẽ được map sang `DEV_EXTENSION_ID`.

## Chạy local

```bash
pnpm install
AUTH_TOKEN="your-strong-token" pnpm start
```

Nếu chạy với extension dev chưa publish, thêm `DEV_EXTENSION_ID`:

```bash
AUTH_TOKEN="your-strong-token" \
DEV_EXTENSION_ID="your_extension_id_from_chrome_extensions" \
pnpm start
```

## API chính

- `GET /health`: liveness probe.
- `GET /ready`: readiness probe (kiểm tra native host đã sẵn sàng chưa).
- `/*`: proxy về native host (bao gồm `/mcp`) và yêu cầu auth.

Lưu ý MCP session (quan trọng):

- `GET /mcp/tools` không tồn tại trên `@mcp-b/native-server`.
- Cần flow chuẩn MCP streamable HTTP: `initialize` -> lấy `mcp-session-id` -> `tools/list` / `tools/call` qua `POST /mcp`.

Auth header hỗ trợ:

- `Authorization: Bearer <token>`
- `x-api-key: <token>`

## Test nhanh

Không token (bị chặn):

```bash
curl -i http://127.0.0.1:8080/mcp
```

Có token:

```bash
curl -i http://127.0.0.1:8080/health
curl -i http://127.0.0.1:8080/ready
curl -i http://127.0.0.1:8080/mcp -H "Authorization: Bearer your-strong-token"
```

## Docker

Build image:

```bash
docker build -t mcpb-native-server-gateway:latest .
```

Run container:

```bash
docker run --rm -p 8080:8080 \
  -e AUTH_TOKEN="your-strong-token" \
  mcpb-native-server-gateway:latest
```

## Gợi ý hardening khi deploy public

- Luôn đặt token dài và random, xoay vòng định kỳ.
- Đặt service sau reverse proxy TLS (Nginx/ALB/Cloudflare).
- Chỉ mở cổng tới các nguồn tin cậy (IP allowlist/security group).
- Bật logging của native host qua `NATIVE_SERVER_ARGS="--verbose --log-level debug"` khi cần điều tra.
