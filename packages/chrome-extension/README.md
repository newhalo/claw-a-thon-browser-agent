# Claw-a-thon MCP Chrome Extension

Chrome extension connecting to `packages/native-server` with authenticated MCP (Model Context Protocol) support.

## Tính năng

- 🔐 Authenticated connection to native server (Bearer token)
- 🛠️ Display available MCP tools
- 🎯 Call MCP tools with parameters
- 💾 Persist configuration in Chrome storage
- 🔗 Health checks and connection testing

## Yêu cầu

- Chrome/Chromium 120+
- Node.js 20+
- pnpm 10+
- Running `packages/native-server` instance

## Cấu hình

### 1. Copy environment template

```bash
cp .env.example .env
```

### 2. Update .env với native server details

```env
NATIVE_SERVER_URL=http://localhost:8080
NATIVE_SERVER_AUTH_TOKEN=your-strong-token-here
```

## Phát triển

### Install dependencies

```bash
pnpm install
```

### Build extension

```bash
pnpm build
```

Output sẽ có trong `dist/` folder.

### Development build with watch

```bash
pnpm dev
```

Khi thay đổi code, extension sẽ rebuild tự động.

## Load extension vào Chrome

1. Mở Chrome DevTools: `chrome://extensions/`
2. Bật "Developer mode" (toggle ở top right)
3. Click "Load unpacked"
4. Chọn `dist/` folder từ project này
5. Extension sẽ appear trong list

## Cách dùng

### 1. Cấu hình Settings

- Click extension icon → Settings tab
- Nhập Native Server URL (e.g., `http://localhost:8080`)
- Nhập Auth Token (token từ `.env` của native-server)
- Click "Test Connection" để verify
- Click "Save Configuration"

### 2. Gọi Tools

- Click extension icon → Tools tab
- Danh sách tools sẽ load từ native server
- Click expand (▶) tool name để xem details
- Enter parameters nếu cần
- Click "▶ Call Tool"
- Result sẽ display bên dưới

## Cấu trúc thư mục

```
chrome-extension/
├── src/
│   ├── background/          # Service worker (background.ts)
│   ├── services/            # Core services
│   │   ├── nativeServerClient.ts    # HTTP client with auth
│   │   ├── storageManager.ts        # Chrome storage
│   │   └── mcpServer.ts             # MCP server logic
│   └── sidepanel/           # UI React components
│       ├── components/
│       │   ├── Settings.tsx         # Config UI
│       │   └── ToolsPanel.tsx       # Tools list & caller
│       ├── App.tsx
│       ├── main.tsx
│       ├── index.html
│       └── index.css
├── wxt.config.ts            # WXT config (manifest generation)
├── tsconfig.json
├── package.json
└── README.md
```

## API Endpoint Details

Extension connects tới native-server qua:

- **URL Base**: `NATIVE_SERVER_URL` (từ config)
- **Auth**: `Authorization: Bearer <NATIVE_SERVER_AUTH_TOKEN>`
- **Headers**: `Content-Type: application/json`

### Health Check

```
GET /health
→ 200 OK (always)
```

### Readiness

```
GET /ready
→ 200 OK (if native host ready)
→ 503 Service Unavailable (if not ready yet)
```

### MCP Proxy

```
POST /mcp
Authorization: Bearer <token>
Content-Type: application/json

Body: MCP message (tool calls, etc.)
Response: MCP response
```

## Debug

### View extension logs

1. Open `chrome://extensions/`
2. Find "Claw-a-thon MCP" extension
3. Click "Details" → "Errors"
4. Or: Right-click extension icon → "Inspect" (for sidepanel)

### Console output

Background worker console:
- `chrome://extensions/` → Find extension → "Details" → "Errors" → "background.ts"

Sidepanel console:
- Right-click in sidepanel → "Inspect"

## Troubleshooting

### ❌ "Connection failed"

- Check native-server is running: `cd packages/native-server && pnpm start`
- Verify URL is correct (default: `http://localhost:8080`)
- Check Auth Token matches native-server `.env`
- Check firewall/CORS not blocking requests

### ❌ "No tools available"

- Native server may not be ready yet
- Check native-server logs for errors
- Try "Refresh" button in Tools tab
- Verify `/mcp` endpoint is working with curl:

```bash
curl -i http://localhost:8080/health \
  -H "Authorization: Bearer your-token"
```

### ❌ Extension doesn't load in Chrome

- Check Chrome version >= 120
- Try `pnpm build` again
- Clear Chrome cache: Settings → Privacy → Clear browsing data
- Reload extension from extensions page

## Build & Distribution

### Production build

```bash
pnpm build
```

Output: `dist/` folder ready for:
- Manual install (Load unpacked in Chrome)
- Chrome Web Store submission
- Distribution to internal teams

### Create ZIP for distribution

```bash
pnpm zip
```

Output: `dist/claw-a-thon-mcp-extension-1.0.0.zip`

## Performance Notes

- Extension loads tools on-demand (caches in state)
- All requests authenticated with Bearer token
- Native-server handles rate limiting / caching
- Storage is Chrome's sync storage (cleared with extension uninstall)

## Security

- ✅ Auth tokens stored in Chrome sync storage (encrypted at rest)
- ✅ All requests use HTTPS-ready bearer auth
- ✅ No secrets in code/git
- ✅ CSP restrictive (only data: and self)

## Support

For issues:
- Check Chrome console for errors
- Verify native-server is running and healthy
- Ensure token is correct
- File issue with logs attached
