import http from 'node:http';
import { listTools, resetSession, setMcpConfig, getMcpConfig, setExternalMcpServers, getExternalMcpServers } from './mcp/client.js';
import { setProviderConfig, getProviderStatus, getProviderCfg } from './providers/index.js';
import { setCustomSystemPrompt, getCustomSystemPrompt } from './config.js';
import chatRoute, { screenshotStore } from './routes/chat.js';
import { getRecentMemories, deleteMemory, clearAllMemories, getMemoryStats, setMemoryConfig, getMemoryConfig, deduplicateMemories } from './memory/long-term.js';
import { PREDEFINED_MODELS } from './models.js';
import { getSkillsPublic } from './skills/registry.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || 'localhost';

// Support multiple tokens via AUTH_TOKENS (comma-separated) or legacy AGENT_TOKEN
const VALID_TOKENS = [
  ...((process.env.AUTH_TOKENS || '').split(',').map(t => t.trim()).filter(Boolean)),
  ...(process.env.AGENT_TOKEN ? [process.env.AGENT_TOKEN.trim()] : []),
];

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
      authRequired: VALID_TOKENS.length > 0,
      provider: providerStatus,
      mcp: getMcpConfig().url,
    }));
    return;
  }

  // ── Auth middleware ──────────────────────────────────────────────────────────
  if (VALID_TOKENS.length > 0) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!VALID_TOKENS.includes(token)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized', message: 'Invalid or missing agent token' }));
      return;
    }
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

  // ── Native-server config — GET returns config for extension, POST accepts override ─
  if (url.pathname === '/native-config' && req.method === 'GET') {
    const mcpCfg = getMcpConfig();
    // Strip /mcp suffix and normalize 0.0.0.0 → localhost (bind addr not routable by clients)
    const nativeServerUrl = mcpCfg.url
      ? mcpCfg.url.replace(/\/mcp$/, '').replace('//0.0.0.0:', '//localhost:')
      : null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: nativeServerUrl, token: mcpCfg.token }));
    return;
  }

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

  // ── Provider capability auto-detect ─────────────────────────────────────
  if (url.pathname === '/detect-capabilities' && req.method === 'POST') {
    try {
      const { provider, baseUrl, modelId, apiKey } = await readBody(req);
      if (!apiKey) { res.writeHead(400).end('apiKey required'); return; }

      const effectiveBaseUrl = (provider === 'openai') ? 'https://api.openai.com/v1'
        : (provider === 'anthropic') ? null   // Anthropic uses its own SDK — skip raw test
        : baseUrl;

      // Anthropic always supports tools + vision
      if (provider === 'anthropic') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ toolsSupported: true, visionSupported: true }));
        return;
      }
      // OpenAI known-good
      if (provider === 'openai') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ toolsSupported: true, visionSupported: true }));
        return;
      }

      if (!effectiveBaseUrl || !modelId) {
        res.writeHead(400).end('baseUrl and modelId required for openai-compat detection');
        return;
      }

      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
      const completionsUrl = `${effectiveBaseUrl.replace(/\/$/, '')}/chat/completions`;

      // ── Test 1: tool calls ──────────────────────────────────────────────
      let toolsSupported = false;
      try {
        const toolRes = await fetch(completionsUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: 'Say "ok"' }],
            tools: [{
              type: 'function',
              function: { name: 'noop', description: 'no-op', parameters: { type: 'object', properties: {} } },
            }],
            tool_choice: 'auto',
            max_tokens: 16,
          }),
          signal: AbortSignal.timeout(12000),
        });
        if (toolRes.ok || toolRes.status === 200) {
          toolsSupported = true;
        } else {
          const body = await toolRes.text();
          // Some providers return 200 but error body on unsupported feature
          toolsSupported = !body.toLowerCase().includes('tool') || toolRes.ok;
        }
      } catch { /* network error = unsupported or unreachable */ }

      // ── Test 2: vision (image_url content) ─────────────────────────────
      // Tiny 1×1 transparent PNG base64
      const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ' +
                      'AABjkB6QAAAABJRU5ErkJggg==';
      let visionSupported = false;
      try {
        const visionRes = await fetch(completionsUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: modelId,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:image/png;base64,${tinyPng}` } },
                { type: 'text', text: 'Describe this image in one word.' },
              ],
            }],
            max_tokens: 16,
          }),
          signal: AbortSignal.timeout(12000),
        });
        if (visionRes.ok) {
          visionSupported = true;
        } else {
          const body = await visionRes.text();
          visionSupported = !body.toLowerCase().includes('vision') && !body.toLowerCase().includes('image') && visionRes.ok;
        }
      } catch { /* vision not supported */ }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ toolsSupported, visionSupported }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ toolsSupported: false, visionSupported: false, error: err.message }));
    }
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

  // ── List models (proxy to avoid CORS; no body = use configured provider) ────
  if (url.pathname === '/list-models' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const cfg = getProviderCfg();
      // Resolve baseUrl and apiKey: body overrides server config
      let resolvedBaseUrl = (body.baseUrl || '').trim() || cfg.baseUrl || '';
      let resolvedKey = (body.apiKey || '').trim() || cfg.apiKey || '';
      const resolvedProvider = body.provider || cfg.provider || 'openai-compat';

      // Provide default baseUrls for known providers when none supplied
      if (!resolvedBaseUrl) {
        if (resolvedProvider === 'openai') resolvedBaseUrl = 'https://api.openai.com/v1';
        else if (resolvedProvider === 'anthropic') resolvedBaseUrl = 'https://api.anthropic.com/v1';
      }

      if (!resolvedBaseUrl && resolvedProvider !== 'anthropic' && resolvedProvider !== 'openai') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'baseUrl required — no provider configured on server' }));
        return;
      }
      if (!resolvedKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'apiKey required — no API key configured on server' }));
        return;
      }

      let modelsUrl, fetchHeaders;
      if (resolvedProvider === 'anthropic') {
        modelsUrl = 'https://api.anthropic.com/v1/models';
        fetchHeaders = { 'x-api-key': resolvedKey, 'anthropic-version': '2023-06-01' };
      } else {
        // vngcloud, gemini, openai, openai-compat — all use OpenAI-compatible /models endpoint
        modelsUrl = `${resolvedBaseUrl.replace(/\/+$/, '')}/models`;
        fetchHeaders = { 'Authorization': `Bearer ${resolvedKey}` };
      }

      const upstream = await fetch(modelsUrl, { headers: fetchHeaders, signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Provider returned ${upstream.status}: ${text.slice(0, 200)}` }));
        return;
      }
      const data = await upstream.json();
      const list = Array.isArray(data) ? data : (data.data ?? data.models ?? []);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: list.map(m => ({ id: m.id, name: m.display_name || m.id, model_type: m.model_type || null, status: m.status || 'enabled' })) }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
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

  // ── LLM Provider config GET — return current config (no apiKey) ─────────
  if (url.pathname === '/provider-config' && req.method === 'GET') {
    const cfg = getProviderCfg();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl, toolsSupported: cfg.toolsSupported, visionSupported: cfg.visionSupported }));
    return;
  }

  // ── LLM Provider config POST — update from extension setup UI ────────────
  if (url.pathname === '/provider-config' && req.method === 'POST') {
    try {
      const { provider, apiKey, model, baseUrl, toolsSupported, visionSupported, embeddingModel } = await readBody(req);
      if (!provider) { res.writeHead(400).end('provider required'); return; }
      const cfg = getProviderCfg();
      // Fall back to env-configured values so extension can omit what it doesn't know
      const effectiveApiKey = apiKey || cfg.apiKey;
      const effectiveBaseUrl = baseUrl || cfg.baseUrl;
      if (!effectiveApiKey) { res.writeHead(400).end('apiKey required — server has no env API key configured'); return; }
      setProviderConfig({ provider, apiKey: effectiveApiKey, model, baseUrl: effectiveBaseUrl, toolsSupported, visionSupported, embeddingModel });
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

  // ── Long-term memory ─────────────────────────────────────────────────────
  if (url.pathname === '/memories' && req.method === 'GET') {
    try {
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      const memories = getRecentMemories(limit);
      const stats = getMemoryStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ memories, stats }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/memory-config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getMemoryConfig()));
    return;
  }

  if (url.pathname === '/memory-config' && req.method === 'POST') {
    try {
      const { maxEntries } = await readBody(req);
      setMemoryConfig({ maxEntries });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, config: getMemoryConfig() }));
    } catch { res.writeHead(400).end('Invalid JSON'); }
    return;
  }

  if (url.pathname === '/memories/deduplicate' && req.method === 'POST') {
    try {
      const body = req.headers['content-length'] > 0 ? await readBody(req).catch(() => ({})) : {};
      const threshold = body.threshold ?? 0.82;
      const result = deduplicateMemories(threshold);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Optimize = deduplicate + prune-to-max
  if (url.pathname === '/memories/optimize' && req.method === 'POST') {
    try {
      const body = req.headers['content-length'] > 0 ? await readBody(req).catch(() => ({})) : {};
      const threshold = body.threshold ?? 0.82;
      const dedup = deduplicateMemories(threshold);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, dedup }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/memories/clear' && req.method === 'POST') {
    try {
      clearAllMemories();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  const memoryDeleteMatch = url.pathname.match(/^\/memories\/(\d+)$/);
  if (memoryDeleteMatch && req.method === 'DELETE') {
    try {
      deleteMemory(parseInt(memoryDeleteMatch[1], 10));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
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

server.listen(PORT, HOST, () => {
  const ps = getProviderStatus();
  console.log(`[agent-service] Running on http://${HOST}:${PORT}`);
  console.log(`[agent-service] Provider: ${ps.configured ? `${ps.provider} (${ps.model || 'default'})` : 'NOT CONFIGURED — use setup UI'}`);
  console.log(`[agent-service] MCP server: ${getMcpConfig().url}`);
});

server.on('error', (err) => { console.error('[agent-service] Server error:', err); process.exit(1); });

process.on('unhandledRejection', (reason) => {
  console.error('[agent-service] Unhandled rejection:', reason?.message || reason);
});
