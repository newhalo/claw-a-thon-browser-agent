# Browser Agent

**[Website & Installation Guide →](https://endpoint-27165b8c-a455-4662-a014-7b1fdc133186.agentbase-runtime.aiplatform.vngcloud.vn)**

A Chrome extension that turns your browser into an AI agent — controlled by natural language, powered by any LLM, and uniquely capable of using **tools exposed by the websites you visit**.

### Website-Provided Tools

The standout feature: any website can register custom MCP tools that the agent picks up automatically. Add one script tag, declare your tools — and the agent gains domain-specific actions beyond its built-in browser toolkit.

```html
<!-- Add to your website -->
<script src="https://unpkg.com/@mcp-b/webmcp-polyfill@latest/dist/index.iife.js"></script>
<script>
navigator.modelContext.registerTool({
  name: "submit-order",
  description: "Submit the current shopping cart order",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    document.querySelector('#checkout-btn').click();
    return { content: [{ type: "text", text: "Order submitted" }] };
  }
});
</script>
```

The extension detects registered tools from every open tab and makes them available to the agent alongside its ~75 built-in browser tools.

### Built-in Browser Tools

Navigate pages, click elements, fill forms, take screenshots, manage tabs, read page content, access bookmarks, history, downloads — over 75 tools grouped by capability. High-risk tools (cookies, localStorage, execute script) are off by default and must be enabled manually.

### Use via Chat UI

Open the extension side panel, type in any language — the agent reasons step-by-step, streams results in real time. Supports Anthropic, OpenAI, and any OpenAI-compatible provider (VNGCloud, OpenRouter, etc.).

### Use via MCP Clients (Cursor, Claude Desktop, …)

The **native-server** exposes a standard MCP Streamable HTTP endpoint. Any MCP-compatible client can connect and control the active Chrome browser.

```json
{
  "mcpServers": {
    "browser-agent": {
      "type": "http",
      "url": "https://endpoint-9f4b684b-2170-44f7-b9c4-de52e96a75c0.agentbase-runtime.aiplatform.vngcloud.vn/mcp",
      "headers": { "Authorization": "Bearer <your-token>" }
    }
  }
}
```

### Security

Every request to native-server requires a Bearer token. Tokens can be statically configured via `AUTH_TOKEN` / `AUTH_TOKENS` in `.env`, or managed dynamically (create / revoke / disable) from the extension's **Security** tab without restarting the server.

---

## Quick Start

Visit the **[website](https://endpoint-27165b8c-a455-4662-a014-7b1fdc133186.agentbase-runtime.aiplatform.vngcloud.vn)** for the step-by-step installation guide and demo video.

Or grab the latest release from [GitHub Releases](https://github.com/newhalo/claw-a-thon-browser-agent/releases/latest), unzip, then load the folder into Chrome via `chrome://extensions` → **Load unpacked**.

> [!WARNING]
> **Remove the extension after testing.** The extension has broad access to your browser — all open tabs, page content, cookies (if enabled), and navigation. When using a shared test token, anyone with that token can control your browser remotely. Once you finish evaluating, go to `chrome://extensions` and remove Browser Agent to eliminate this attack surface.

---

## Docs

- [Extension User Guide](docs/extension-user-guide.md) — build, configure, chat, tools, MCP clients, website integration
- [Agent Description](docs/agent-description.md) — what the agent does, who it's for, how it works
- [Architecture & Handoff](docs/browser-agent-handoff.md) — full technical details

## Packages

| Package | Description |
|---------|-------------|
| [`packages/chrome-extension`](packages/chrome-extension/README.md) | Chrome Extension (WXT, React, MV3) |
| [`packages/agent-service`](packages/agent-service/README.md) | LLM orchestration backend |
| [`packages/native-server`](packages/native-server/README.md) | MCP gateway (authenticated HTTP) |
| [`packages/WebMCP`](packages/WebMCP) | WebMCP protocol library |
| [`packages/extension-website`](packages/extension-website/README.md) | Documentation website (Next.js) |
