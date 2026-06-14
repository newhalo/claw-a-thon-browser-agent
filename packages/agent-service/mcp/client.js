/**
 * MCP client — supports multiple MCP servers.
 *
 * Native-server (always-on) + optional external servers pushed by extension.
 * Each server maintains its own session. Tool registry maps toolName → serverId.
 */

// ── Server state ──────────────────────────────────────────────────────────────

const NATIVE_ID = 'native';

const servers = new Map(); // id → ServerState
const toolRegistry = new Map(); // toolName → serverId

function makeServer(id, url, token, enabled = true, headers = null, name = '') {
  // headers takes priority; token is legacy shorthand for Authorization: Bearer
  const resolvedHeaders = headers ?? (token ? { Authorization: `Bearer ${token}` } : {});
  return { id, name: name || id, url: url || '', headers: resolvedHeaders, enabled, sessionId: null, toolCache: [], fetchedAt: 0 };
}

// Init native server from env
servers.set(NATIVE_ID, makeServer(
  NATIVE_ID,
  process.env.MCP_SERVER_URL || 'http://localhost:8080/mcp',
  process.env.MCP_AUTH_TOKEN || '',
));

// ── Config API ────────────────────────────────────────────────────────────────

export function setMcpConfig(url, token) {
  const s = servers.get(NATIVE_ID);
  const newHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  const changed = url !== s.url || JSON.stringify(s.headers) !== JSON.stringify(newHeaders);
  s.url = url;
  s.headers = newHeaders;
  if (changed) resetServerSession(NATIVE_ID);
  console.log(`[mcp] Native config updated — url: ${url}`);
}

export function getMcpConfig() {
  const s = servers.get(NATIVE_ID);
  const authHeader = s.headers?.['Authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  return { url: s.url, token };
}

export function setExternalMcpServers(externalList) {
  // Remove stale external servers
  for (const [id] of servers) {
    if (id !== NATIVE_ID && !externalList.find(e => e.id === id)) {
      resetServerSession(id);
      servers.delete(id);
    }
  }
  // Upsert incoming servers
  for (const ext of externalList) {
    if (servers.has(ext.id)) {
      const s = servers.get(ext.id);
      const newHeaders = ext.headers ?? (ext.token ? { Authorization: `Bearer ${ext.token}` } : {});
      if (s.url !== ext.url || JSON.stringify(s.headers) !== JSON.stringify(newHeaders)) {
        resetServerSession(ext.id);
        s.url = ext.url;
        s.headers = newHeaders;
      }
      s.enabled = ext.enabled !== false;
      if (ext.name) s.name = ext.name;
    } else {
      servers.set(ext.id, makeServer(ext.id, ext.url, null, ext.enabled !== false, ext.headers ?? null, ext.name || ext.id));
    }
  }
  // Clear tool cache so it gets rebuilt on next listTools()
  toolRegistry.clear();
  for (const s of servers.values()) s.fetchedAt = 0;
  console.log(`[mcp] External servers updated: ${externalList.map(e => e.name || e.id).join(', ') || '(none)'}`);
}

export function getExternalMcpServers() {
  const result = [];
  for (const [id, s] of servers) {
    if (id === NATIVE_ID) continue;
    result.push({ id, url: s.url, token: s.token, enabled: s.enabled });
  }
  return result;
}

// ── Session management ────────────────────────────────────────────────────────

const STATELESS = '__stateless__'; // sentinel for servers that don't use session IDs

function authHeaders(server) {
  const h = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    ...server.headers,
  };
  if (server.sessionId && server.sessionId !== STATELESS) {
    h['mcp-session-id'] = server.sessionId;
  }
  return h;
}

/**
 * Parse MCP response — handles both plain JSON and text/event-stream (SSE).
 * MCP Streamable HTTP servers may respond with either content type.
 */
async function parseMcpResponse(res) {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  if (contentType.includes('text/event-stream')) {
    // Extract first "data: {...}" line from SSE stream
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        try { return JSON.parse(trimmed.slice(5).trim()); } catch {}
      }
    }
    throw new Error('No valid data line in SSE response');
  }
  return JSON.parse(text);
}

async function initSession(server) {
  const res = await fetch(server.url, {
    method: 'POST',
    headers: authHeaders(server),
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'claw-a-thon-agent-service', version: '1.0.0' },
      },
    }),
  });

  if (!res.ok) throw new Error(`MCP init failed [${server.id}]: ${res.status} ${res.statusText}`);

  // Session ID is optional — stateless servers omit it
  server.sessionId = res.headers.get('mcp-session-id') || STATELESS;

  // Parse and validate response (handles SSE format)
  try {
    await parseMcpResponse(res);
  } catch {
    // Some servers send non-parseable init responses — that's OK
  }

  // Send initialized notification (best-effort, stateless servers may ignore)
  if (server.sessionId !== STATELESS) {
    await fetch(server.url, {
      method: 'POST',
      headers: authHeaders(server),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }).catch(() => {});
  }

  console.log(`[mcp] Session initialized [${server.id}]: ${server.sessionId === STATELESS ? 'stateless' : server.sessionId}`);
}

async function ensureSession(server) {
  if (server.sessionId) return;
  await initSession(server);
}

function resetServerSession(id) {
  const s = servers.get(id);
  if (!s) return;
  s.sessionId = null;
  s.toolCache = [];
  s.fetchedAt = 0;
}

export function resetSession() {
  resetServerSession(NATIVE_ID);
  toolRegistry.clear();
}

// ── Tool listing ──────────────────────────────────────────────────────────────

async function fetchServerTools(server, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && server.toolCache.length > 0 && now - server.fetchedAt < 30_000) {
    return server.toolCache;
  }

  await ensureSession(server);

  const res = await fetch(server.url, {
    method: 'POST',
    headers: { ...authHeaders(server), 'mcp-session-id': server.sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });

  if (!res.ok) {
    if ((res.status === 400 || res.status === 404) && server.sessionId !== STATELESS) {
      server.sessionId = null;
      await initSession(server);
      return fetchServerTools(server, true);
    }
    throw new Error(`tools/list failed [${server.id}]: ${res.status} ${res.statusText}`);
  }

  const data = await parseMcpResponse(res);
  const tools = data?.result?.tools ?? [];
  server.toolCache = tools;
  server.fetchedAt = now;
  console.log(`[mcp] Loaded ${tools.length} tools from [${server.id}]`);
  return tools;
}

export async function listTools(forceRefresh = false) {
  const all = [];
  for (const [id, server] of servers) {
    if (!server.enabled) continue;
    try {
      const tools = await fetchServerTools(server, forceRefresh);
      for (const t of tools) {
        toolRegistry.set(t.name, id);
        all.push({ ...t, _serverId: id, _serverName: server.name || id });
      }
    } catch (err) {
      console.warn(`[mcp] Could not fetch tools from [${id}]:`, err.message);
    }
  }
  return all;
}

// ── Tool calling ──────────────────────────────────────────────────────────────

async function callToolOnServer(server, name, args) {
  await ensureSession(server);

  const res = await fetch(server.url, {
    method: 'POST',
    headers: { ...authHeaders(server), 'mcp-session-id': server.sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
      params: { name, arguments: args ?? {} },
    }),
  });

  if (!res.ok) {
    if ((res.status === 400 || res.status === 404) && server.sessionId !== STATELESS) {
      server.sessionId = null;
      await initSession(server);
      return callToolOnServer(server, name, args);
    }
    throw new Error(`tools/call failed [${server.id}]: ${res.status} ${res.statusText}`);
  }

  const data = await parseMcpResponse(res);
  if (data.error) throw new Error(`Tool error: ${JSON.stringify(data.error)}`);
  return data?.result;
}

export async function callTool(name, args) {
  const serverId = toolRegistry.get(name) ?? NATIVE_ID;
  const server = servers.get(serverId);
  if (!server) throw new Error(`No MCP server found for tool: ${name}`);
  return callToolOnServer(server, name, args);
}
