# Extension User Guide

## System Overview

Browser Agent is a three-component system. Together they let any AI assistant control Chrome via the Model Context Protocol (MCP).

| Component | Role | Default port |
|-----------|------|--------------|
| **Chrome Extension** | Chat UI + executes ~75 browser tools + collects website-provided tools | — |
| **native-server** | MCP gateway — queues and relays tool calls between MCP clients and the extension | `8080` |
| **agent-service** | LLM orchestration — receives chat, calls the LLM, invokes tools via native-server | `3000` (local) / `8080` (prod) |

### Website-Provided Tools

The key differentiator: websites can register their own MCP tools using the WebMCP polyfill. The extension picks these up from open tabs and exposes them to the agent alongside the built-in browser tools — giving the agent domain-specific actions that only that site can provide.

See [Website Tool Integration](#website-tool-integration) for how to add tools to your own site.

---

## Part 1: Build the Extension

### Requirements

- Node.js 20+
- pnpm 10+

### Steps

```bash
cd packages/chrome-extension
pnpm install

# Production build
pnpm build
# Output: packages/chrome-extension/dist/chrome-mv3/

# Development (watch mode)
pnpm dev
```

---

## Part 2: Load into Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select: `packages/chrome-extension/dist/chrome-mv3`

To open the side panel: click the extension icon in the toolbar.

---

## Part 3: Run Backend Services

### 3a. native-server (required)

```bash
cd packages/native-server
cp .env.example .env
# Set AUTH_TOKEN and PORT in .env

pnpm install
pnpm start
```

Key environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `AUTH_TOKEN` | Bearer token for all requests | Yes |
| `AUTH_TOKENS` | Comma-separated list (multiple tokens) | No |
| `PORT` | Gateway port (default `8080`) | No |
| `ALLOW_NO_AUTH` | Skip auth for local dev (`true`) | No |

### 3b. agent-service (required for chat)

```bash
cd packages/agent-service
cp .env.example .env
# Set PROVIDER and corresponding API key

pnpm install
pnpm start
```

Key environment variables:

| Variable | Description |
|----------|-------------|
| `PROVIDER` | `anthropic` \| `openai` \| `openai-compat` |
| `ANTHROPIC_API_KEY` | Key for Anthropic |
| `OPENAI_API_KEY` | Key for OpenAI |
| `CUSTOM_BASE_URL` | Base URL for openai-compat providers |
| `CUSTOM_API_KEY` | API key for custom provider |
| `CUSTOM_MODEL` | Model ID for custom provider |
| `MCP_SERVER_URL` | URL of native-server (default `http://localhost:8080`) |
| `MCP_AUTH_TOKEN` | Auth token for native-server |
| `PORT` | **Must be `8080` when deploying to AgentBase** |
| `MAX_STEPS` | Max agent reasoning steps (default `50`) |

> Provider can also be configured directly in the extension UI — no `.env` needed.

---

## Part 4: First-Run Setup

The first time you open the extension without a configured provider, the **SetupView** appears:

1. **Native Server URL** — e.g. `http://localhost:8080` or the prod endpoint URL
2. **Auth Token** — must match `AUTH_TOKEN` in native-server's `.env`
3. **LLM Provider** — choose one:
   - `anthropic` — enter API key, select model
   - `openai` — enter API key, select model
   - `openai-compat` — enter Base URL + API key + Model ID. Tick **"Supports tool calling"** for models that support function calling (most modern models do). Leave unticked for models that don't.
4. Click **Save**

Settings are saved to `chrome.storage.sync` and restored on reopen.

---

## Part 5: Chat with the Agent

After setup, the chat interface appears:

- Type a request in any language and press **Enter**
- The agent reasons step-by-step and streams results in real time:
  - **Text** — reasoning and explanations
  - **Tool call blocks** — tool name, parameters, and result
- The agent uses both its built-in browser tools and any website-provided tools from open tabs

**Example requests:**

```
Open a new tab and navigate to google.com
List all open tabs
Take a screenshot of the current page
Fill the registration form: name = "John Doe", email = "john@example.com"
Summarize the content of this page
```

---

## Part 6: Manage Tools

Click the **Tools** icon to open the tool selector:

- ~75 browser tools grouped by category: Tabs, Navigation, Page Interaction, Storage, etc.
- Toggle tools on/off individually
- **Off by default** (high-risk): `execute_script`, cookies, localStorage, browser history, downloads
- **On by default**: `browser_take_screenshot`, navigation, click, fill, scroll

Only enabled tools are sent with each request — the model cannot call a disabled tool.

Website-provided tools from open tabs appear automatically when a page has registered them.

---

## Part 7: Settings

Click the ⚙ **Settings** icon to reconfigure after initial setup.

### Native Server
- Change URL and auth token
- Status badge shows live connection health

### LLM Provider
- View current provider and model
- Click **Edit** to switch provider/model/key without going through SetupView again

### Custom Instructions
- Additional instructions appended to the system prompt
- Example: "Always answer in Vietnamese", "Ask for confirmation before submitting forms"

---

## Part 8: Token Management (Security Tab)

The **Security** tab in Options manages MCP client tokens:

- **View** all existing tokens (name, prefix, last used)
- **Create** — choose a preset (Cursor / Claude / ChatGPT) or enter a custom name. The full token is shown **once** — copy it immediately.
- **Revoke** — immediately blocks that token
- After creating a token, the extension generates a ready-to-paste MCP config snippet showing the real native server URL

Static tokens (`AUTH_TOKEN` in `.env`) are not shown here — only dynamically created tokens are managed from the UI.

---

## Part 9: Connect External MCP Clients

native-server exposes a standard MCP Streamable HTTP endpoint. Any MCP-compatible client can connect:

```
URL: <native-server-url>/mcp
Auth: Authorization: Bearer <token>
```

**Cursor / Claude Desktop config:**

```json
{
  "mcpServers": {
    "browser-agent": {
      "type": "http",
      "url": "https://endpoint-9f4b684b-2170-44f7-b9c4-de52e96a75c0.agentbase-runtime.aiplatform.vngcloud.vn/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

**Test with curl:**

```bash
# Initialize session
curl -X POST https://<native-server-url>/mcp \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"test","version":"1.0"}},"id":1}'

# List tools (use mcp-session-id from the response above)
curl -X POST https://<native-server-url>/mcp \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: <session-id>" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'
```

---

## Part 10: Website Tool Integration

Any website can expose custom tools to the agent using the WebMCP polyfill. The extension automatically discovers registered tools from all open tabs.

### Quick Start (plain HTML)

```html
<!-- Step 1: Load the polyfill (no build tools needed) -->
<script src="https://unpkg.com/@mcp-b/webmcp-polyfill@latest/dist/index.iife.js"></script>

<!-- Step 2: Register your tools -->
<script>
navigator.modelContext.registerTool({
  name: "submit-order",
  description: "Submit the current shopping cart order",
  inputSchema: {
    type: "object",
    properties: {}
  },
  async execute() {
    document.querySelector('#checkout-btn').click();
    return { content: [{ type: "text", text: "Order submitted successfully" }] };
  }
});

navigator.modelContext.registerTool({
  name: "apply-filter",
  description: "Filter the product list by category",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", description: "Product category to filter by" }
    },
    required: ["category"]
  },
  async execute({ category }) {
    // Your filtering logic
    document.querySelector(`[data-category="${category}"]`).click();
    return { content: [{ type: "text", text: `Filtered by: ${category}` }] };
  }
});
</script>
```

### How It Works

1. Your page loads the polyfill and registers tools via `navigator.modelContext.registerTool()`
2. The Browser Agent extension detects these tools from the active tab
3. The agent sees them alongside its built-in tools in every request
4. When the agent calls your tool, your `execute()` function runs in the page context — with full access to the DOM, app state, and APIs

### Tool Response Format

All tools must return:

```javascript
return {
  content: [
    { type: "text", text: "Your result string" }
  ]
};
```

### Verify Your Tools

Open the browser console and check:

```javascript
// List registered tools
navigator.modelContextTesting.listTools();

// Test a tool
navigator.modelContextTesting.executeTool("submit-order", "{}");
```

### React / Framework Example

```jsx
import { useEffect } from 'react';

export function useAgentTool(name, description, schema, execute) {
  useEffect(() => {
    if (!navigator.modelContext) return;
    navigator.modelContext.registerTool({ name, description, inputSchema: schema, execute });
  }, []);
}

// In your component:
useAgentTool(
  "export-data",
  "Export the current table data as CSV",
  { type: "object", properties: {} },
  async () => {
    const csv = generateCSV(tableData);
    downloadFile(csv, "export.csv");
    return { content: [{ type: "text", text: "CSV exported" }] };
  }
);
```

---

## Part 11: Deploy to AgentBase (Production)

See the README in each package for deployment details:

- [`packages/agent-service/README.md`](../packages/agent-service/README.md) — PORT=8080, bind 0.0.0.0, node:20-slim
- [`packages/native-server/README.md`](../packages/native-server/README.md) — corepack, pnpm-lock.yaml

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Extension opens to SetupView | Provider not configured or agent-service not running | Start agent-service, re-enter config |
| "Connection failed" for native server | Server not running or wrong token | Check server + token |
| Agent can't call any tools | Tool disabled or native-server lost extension connection | Enable tools; reload page to reconnect |
| Stream cuts off mid-response | Rate limit (429) or context window full | Wait and retry; use a model with larger context |
| Tool calls don't work (openai-compat) | `toolsSupported` not enabled | Settings → LLM Provider → tick "Supports tool calling" |
| Extension errors after Chrome idle | Background service worker suspended by Chrome | Reload the page to reconnect content script |
| Website tools not showing | Polyfill not loaded or tools registered after extension checked | Reload the tab; ensure polyfill loads before tool registration |
