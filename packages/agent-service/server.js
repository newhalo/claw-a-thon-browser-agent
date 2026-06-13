import http from 'node:http';
import { listTools, resetSession, setMcpConfig, getMcpConfig } from './mcp/client.js';
import { setProviderConfig, getProviderStatus } from './providers/index.js';
import chatRoute from './routes/chat.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'chrome-extension://,http://localhost')
  .split(',').map(o => o.trim());

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

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
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  const url = new URL(req.url, 'http://localhost');

  // ── Health & status ──────────────────────────────────────────────────────
  if (url.pathname === '/health' && req.method === 'GET') {
    const providerStatus = getProviderStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'agent-service',
      port: PORT,
      provider: providerStatus,
      mcp: getMcpConfig().url,
    }));
    return;
  }

  // ── Tools list ───────────────────────────────────────────────────────────
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

  // ── MCP session reset ────────────────────────────────────────────────────
  if (url.pathname === '/mcp/reset' && req.method === 'POST') {
    resetSession();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Native-server config (pushed from extension) ─────────────────────────
  if (url.pathname === '/native-config' && req.method === 'POST') {
    try {
      const { nativeServerUrl, authToken } = await readBody(req);
      if (!nativeServerUrl) { res.writeHead(400).end('nativeServerUrl required'); return; }
      const mcpUrl = nativeServerUrl.endsWith('/mcp') ? nativeServerUrl : `${nativeServerUrl}/mcp`;
      setMcpConfig(mcpUrl, authToken || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mcpUrl }));
    } catch { res.writeHead(400).end('Invalid JSON'); }
    return;
  }

  // ── LLM Provider config (pushed from extension setup UI) ─────────────────
  if (url.pathname === '/provider-config' && req.method === 'POST') {
    try {
      const { provider, apiKey, model, baseUrl } = await readBody(req);
      if (!provider || !apiKey) { res.writeHead(400).end('provider and apiKey required'); return; }
      setProviderConfig({ provider, apiKey, model, baseUrl });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: getProviderStatus() }));
    } catch { res.writeHead(400).end('Invalid JSON'); }
    return;
  }

  // ── Chat ─────────────────────────────────────────────────────────────────
  if (url.pathname === '/chat') {
    await chatRoute(req, res);
    return;
  }

  res.writeHead(404).end('Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  const ps = getProviderStatus();
  console.log(`[agent-service] Running on http://127.0.0.1:${PORT}`);
  console.log(`[agent-service] Provider: ${ps.configured ? `${ps.provider} (${ps.model || 'default'})` : 'NOT CONFIGURED — use setup UI'}`);
  console.log(`[agent-service] MCP server: ${getMcpConfig().url}`);
});

server.on('error', (err) => { console.error('[agent-service] Server error:', err); process.exit(1); });

process.on('unhandledRejection', (reason) => {
  console.error('[agent-service] Unhandled rejection:', reason?.message || reason);
});
