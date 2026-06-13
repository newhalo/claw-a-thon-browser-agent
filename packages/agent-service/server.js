/**
 * Claw-a-thon Agent Service
 *
 * Provides the backend for the Chat Agent in the Chrome extension.
 * - POST /chat   → streaming LLM chat with MCP browser tools
 * - GET  /health → health check
 * - GET  /tools  → list available MCP tools
 *
 * Runs on PORT (default 3000), independent of native-server (port 8080).
 */

import http from 'node:http';
import { listTools, resetSession, setMcpConfig, getMcpConfig } from './mcp/client.js';
import chatRoute from './routes/chat.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

// CORS origins: allow chrome-extension:// and configured origins
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'chrome-extension://,http://localhost')
  .split(',')
  .map(o => o.trim());

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'X-Conversation-Id');
  }
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url, `http://localhost`);

  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'agent-service', port: PORT }));
    return;
  }

  if (url.pathname === '/tools' && req.method === 'GET') {
    try {
      const tools = await listTools();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tools }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/mcp/reset' && req.method === 'POST') {
    resetSession();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Extension pushes native-server URL + token so agent-service can connect to MCP
  if (url.pathname === '/native-config' && req.method === 'POST') {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const { nativeServerUrl, authToken } = JSON.parse(Buffer.concat(chunks).toString());
      if (!nativeServerUrl) { res.writeHead(400).end('nativeServerUrl required'); return; }
      setMcpConfig(nativeServerUrl.endsWith('/mcp') ? nativeServerUrl : `${nativeServerUrl}/mcp`, authToken || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mcpUrl: getMcpConfig().url }));
    } catch (err) {
      res.writeHead(400).end('Invalid JSON');
    }
    return;
  }

  if (url.pathname === '/chat') {
    await chatRoute(req, res);
    return;
  }

  res.writeHead(404).end('Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[agent-service] Running on http://127.0.0.1:${PORT}`);
  console.log(`[agent-service] Provider: ${process.env.PROVIDER || 'anthropic'}`);
  console.log(`[agent-service] MCP server: ${process.env.MCP_SERVER_URL || 'http://localhost:8080/mcp'}`);
});

server.on('error', (err) => {
  console.error('[agent-service] Server error:', err);
  process.exit(1);
});
