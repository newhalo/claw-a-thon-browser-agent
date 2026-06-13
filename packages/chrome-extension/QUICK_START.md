# Quick Start Guide - Claw-a-thon MCP Chrome Extension

Hướng dẫn nhanh để setup và chạy extension.

## 🚀 Setup (5 phút)

### 1. Cài dependencies

```bash
cd packages/chrome-extension
pnpm install
```

### 2. Copy env template

```bash
cp .env.example .env
```

### 3. Cấu hình native server URL & token

Edit `.env`:

```env
NATIVE_SERVER_URL=http://localhost:8080
NATIVE_SERVER_AUTH_TOKEN=your-strong-token-here
```

### 4. Build extension

```bash
pnpm build
```

Output: `dist/` folder chứa extension

## 🔧 Load vào Chrome

1. Mở `chrome://extensions/`
2. Bật **Developer mode** (top right)
3. Click **Load unpacked**
4. Chọn folder `packages/chrome-extension/dist/`
5. Extension sẽ appear trong list

## ⚙️ Cấu hình trong Extension

1. Click extension icon (sidebar hoặc toolbar)
2. Click **Settings** tab
3. Nhập:
   - **Native Server URL**: `http://localhost:8080`
   - **Auth Token**: Copy từ `packages/native-server/.env`
4. Click **Test Connection** → Verify success
5. Click **Save Configuration**

## 🎯 Gọi MCP Tools

1. Click extension icon
2. Click **Tools** tab
3. Danh sách tools load tự động từ native-server
4. Expand tool → Enter params → Click **▶ Call Tool**
5. Result hiển thị bên dưới

## 🔄 Development Workflow

### Auto-rebuild on file changes

```bash
pnpm dev
```

Khi thay đổi code, extension sẽ rebuild. Reload extension từ `chrome://extensions/` để test.

### Debug logs

**Background worker logs:**
- `chrome://extensions/` → Find extension → Click **Errors**

**Sidepanel logs:**
- Right-click sidepanel → **Inspect** → Console

## 🐛 Troubleshooting

### ❌ "Connection failed"

✅ Check:
- Native server đang chạy: `cd packages/native-server && pnpm start`
- URL đúng: `http://localhost:8080`
- Token match `.env`

### ❌ "No tools available"

✅ Check:
- Native server `/ready` endpoint returning 200
- Try click "Refresh" button

### ❌ Extension không load

✅ Check:
- Chrome version >= 120
- Run `pnpm build` lại
- Clear Chrome cache: Settings → Privacy → Clear browsing data

## 📦 Structure

```
chrome-extension/
├── src/
│   ├── background/           # Service worker (handles MCP)
│   ├── services/            # Auth, storage, MCP logic
│   └── sidepanel/           # React UI
├── dist/                     # Build output (load into Chrome)
└── README.md               # Full documentation
```

## 📚 More Info

- Full README: [README.md](./README.md)
- Native server docs: [packages/native-server/README.md](../native-server/README.md)
- MCP protocol: [WebMCP README](../WebMCP/README.md)

## ✅ Success Checklist

- [ ] Dependencies installed (`pnpm install`)
- [ ] `.env` configured with native server URL & token
- [ ] Extension built (`pnpm build`)
- [ ] Extension loaded in Chrome (`chrome://extensions/`)
- [ ] Settings configured with correct URL & token
- [ ] Test connection successful ✅
- [ ] Tools tab shows available tools
- [ ] Can call a tool successfully

## 🎉 Done!

Your extension is ready to connect to the native server and call MCP tools!

For questions, check the full [README.md](./README.md).
