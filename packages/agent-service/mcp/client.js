/**
 * MCP client connecting to native-server.
 * Config can be set from .env at startup OR pushed at runtime via setMcpConfig().
 */

let mcpServerUrl = process.env.MCP_SERVER_URL || 'http://localhost:8080/mcp';
let mcpAuthToken = process.env.MCP_AUTH_TOKEN || '';

// Active MCP session ID
let sessionId = null;
// Cached tool list (refreshed every 30s)
let toolCache = { tools: [], fetchedAt: 0 };

/** Called by the /native-config endpoint when extension pushes its config */
export function setMcpConfig(url, token) {
  const changed = url !== mcpServerUrl || token !== mcpAuthToken;
  mcpServerUrl = url;
  mcpAuthToken = token;
  if (changed) resetSession();
  console.log(`[mcp] Config updated — url: ${url}`);
}

export function getMcpConfig() {
  return { url: mcpServerUrl, token: mcpAuthToken };
}

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (mcpAuthToken) h['Authorization'] = `Bearer ${mcpAuthToken}`;
  return h;
}

async function initSession() {
  const res = await fetch(mcpServerUrl, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'claw-a-thon-agent-service', version: '1.0.0' },
      },
    }),
  });

  if (!res.ok) throw new Error(`MCP init failed: ${res.status} ${res.statusText}`);

  sessionId = res.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('No mcp-session-id in response headers');

  await fetch(mcpServerUrl, {
    method: 'POST',
    headers: { ...authHeaders(), 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  console.log(`[mcp] Session initialized: ${sessionId}`);
}

async function ensureSession() {
  if (sessionId) return;
  await initSession();
}

export async function listTools(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && toolCache.tools.length > 0 && now - toolCache.fetchedAt < 30_000) {
    return toolCache.tools;
  }

  await ensureSession();

  const res = await fetch(mcpServerUrl, {
    method: 'POST',
    headers: { ...authHeaders(), 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 404 || res.status === 401) {
      sessionId = null;
      await initSession();
      return listTools(true);
    }
    throw new Error(`tools/list failed: ${res.status}`);
  }

  const data = await res.json();
  const tools = data?.result?.tools ?? [];
  toolCache = { tools, fetchedAt: now };
  return tools;
}

export async function callTool(name, args) {
  await ensureSession();

  const res = await fetch(mcpServerUrl, {
    method: 'POST',
    headers: { ...authHeaders(), 'mcp-session-id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args ?? {} },
    }),
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 404 || res.status === 401) {
      sessionId = null;
      await initSession();
      return callTool(name, args);
    }
    throw new Error(`tools/call failed: ${res.status}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(`Tool error: ${JSON.stringify(data.error)}`);
  return data?.result;
}

export function resetSession() {
  sessionId = null;
  toolCache = { tools: [], fetchedAt: 0 };
}
