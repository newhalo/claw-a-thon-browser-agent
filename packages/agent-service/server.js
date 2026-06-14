import http from 'node:http';
import { listTools, resetSession, setMcpConfig, getMcpConfig, setExternalMcpServers, getExternalMcpServers } from './mcp/client.js';
import { setProviderConfig, getProviderStatus } from './providers/index.js';
import { setCustomSystemPrompt, getCustomSystemPrompt } from './config.js';
import chatRoute, { screenshotStore } from './routes/chat.js';
import { PREDEFINED_MODELS } from './models.js';
import { getSkillsPublic } from './skills/registry.js';

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
    res.setHeader('Access-Control-Expose-Headers', 'X-Conversation-Id, X-Context-Compressed');
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

  // ── External MCP servers ─────────────────────────────────────────────────
  if (url.pathname === '/external-mcp-config' && req.method === 'POST') {
    try {
      const { servers: list } = await readBody(req);
      if (!Array.isArray(list)) { res.writeHead(400).end('servers array required'); return; }
      setExternalMcpServers(list);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: list.length }));
    } catch { res.writeHead(400).end('Invalid JSON'); }
    return;
  }

  if (url.pathname === '/external-mcp-config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ servers: getExternalMcpServers() }));
    return;
  }

  // ── MCP server test (proxy — avoids CORS from browser) ───────────────────
  if (url.pathname === '/test-mcp' && req.method === 'POST') {
    try {
      const { url: mcpUrl, headers: mcpHeaders = {} } = await readBody(req);
      if (!mcpUrl) { res.writeHead(400).end('url required'); return; }
      const testRes = await fetch(mcpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', ...mcpHeaders },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
        }),
        signal: AbortSignal.timeout(6000),
      });
      const text = await testRes.text().catch(() => '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: testRes.ok, status: testRes.status, statusText: testRes.statusText, body: text.slice(0, 500) }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // ── Models catalog ───────────────────────────────────────────────────────
  if (url.pathname === '/models' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(PREDEFINED_MODELS));
    return;
  }

  // ── Skills catalog ───────────────────────────────────────────────────────
  if (url.pathname === '/skills' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getSkillsPublic()));
    return;
  }

  // ── LLM Provider config (pushed from extension setup UI) ─────────────────
  if (url.pathname === '/provider-config' && req.method === 'POST') {
    try {
      const { provider, apiKey, model, baseUrl, toolsSupported, visionSupported } = await readBody(req);
      if (!provider || !apiKey) { res.writeHead(400).end('provider and apiKey required'); return; }
      setProviderConfig({ provider, apiKey, model, baseUrl, toolsSupported, visionSupported });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: getProviderStatus() }));
    } catch { res.writeHead(400).end('Invalid JSON'); }
    return;
  }

  // ── Custom system prompt ─────────────────────────────────────────────────
  if (url.pathname === '/system-prompt' && req.method === 'POST') {
    try {
      const { systemPrompt } = await readBody(req);
      setCustomSystemPrompt(systemPrompt || null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, set: !!systemPrompt }));
    } catch { res.writeHead(400).end('Invalid JSON'); }
    return;
  }

  if (url.pathname === '/system-prompt' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ systemPrompt: getCustomSystemPrompt() }));
    return;
  }

  // ── Screenshot store ─────────────────────────────────────────────────────
  const screenshotMatch = url.pathname.match(/^\/screenshot\/([a-f0-9-]+)$/);
  if (screenshotMatch && req.method === 'GET') {
    const entry = screenshotStore.get(screenshotMatch[1]);
    if (!entry) { res.writeHead(404).end('Not found'); return; }
    const [, mimeType, b64] = entry.dataUrl.match(/^data:([^;]+);base64,(.+)$/) || [];
    const buf = Buffer.from(b64, 'base64');
    res.writeHead(200, { 'Content-Type': mimeType, 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=600' });
    res.end(buf);
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
