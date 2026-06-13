/**
 * Content script: connects to page MCP server (TabServerTransport) and
 * relays discovered tools + tool calls to/from the background service worker.
 */

import { TabClientTransport } from '@mcp-b/transports';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  async main() {
    // Skip non-navigable / special pages early
    const origin = window.location.origin;
    if (!origin || origin === 'null' || origin.startsWith('chrome-extension://')) return;

    const port = chrome.runtime.connect({ name: 'mcp-content-script-proxy' });
    let mcpClient: Client | null = null;

    // Forward tool-execution requests from background to page MCP server
    port.onMessage.addListener(async (message: any) => {
      if (message.type === 'execute-tool' && message.requestId) {
        if (!mcpClient) {
          port.postMessage({
            type: 'tool-result',
            requestId: message.requestId,
            data: { success: false, payload: 'No page MCP client connected' },
          });
          return;
        }
        try {
          const result = await mcpClient.callTool({
            name: message.toolName,
            arguments: message.args ?? {},
          });
          port.postMessage({
            type: 'tool-result',
            requestId: message.requestId,
            data: { success: true, payload: result },
          });
        } catch (err) {
          port.postMessage({
            type: 'tool-result',
            requestId: message.requestId,
            data: { success: false, payload: err instanceof Error ? err.message : String(err) },
          });
        }
      }

      if (message.type === 'request-tools-refresh' && mcpClient) {
        try {
          const { tools } = await mcpClient.listTools();
          port.postMessage({ type: 'tools-updated', tools });
        } catch { /* ignore */ }
      }
    });

    // Try connecting to the page's MCP server.
    // Most pages won't have one — we silently bail out after 5s.
    try {
      const client = new Client({ name: 'ExtensionProxy', version: '1.0.0' });
      const transport = new TabClientTransport({ targetOrigin: origin });

      transport.onclose = () => {
        mcpClient = null;
        port.postMessage({ type: 'tools-updated', tools: [] });
      };

      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('no-mcp-server')), 5000)
        ),
      ]);

      mcpClient = client;

      const { tools } = await client.listTools();
      port.postMessage({ type: 'register-tools', tools });

      const caps = client.getServerCapabilities();
      if (caps?.tools?.listChanged) {
        client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
          try {
            const { tools: updated } = await client.listTools();
            port.postMessage({ type: 'tools-updated', tools: updated });
          } catch { /* ignore */ }
        });
      }
    } catch (err: any) {
      if (err?.message !== 'no-mcp-server') {
        console.debug('[MCP content] connection error:', err?.message);
      }
    }

    port.onDisconnect.addListener(() => {
      mcpClient = null;
    });
  },
});
