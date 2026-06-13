import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? "8080");
const ALLOW_NO_AUTH = normalizeBoolean(process.env.ALLOW_NO_AUTH ?? "false");
const ENABLE_DEBUG_LOGS = normalizeBoolean(process.env.ENABLE_DEBUG_LOGS ?? "true");
const TOKENS_FILE = process.env.TOKENS_FILE ?? path.join(process.cwd(), "tokens.json");
const PROVIDER_TIMEOUT_MS = 28000;

function normalizeBoolean(raw) {
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

// ─── Logging ──────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}
function logInfo(msg, meta = {}) {
  const s = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[gateway] ${nowIso()} INFO ${msg}${s}`);
}
function logWarn(msg, meta = {}) {
  const s = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  console.warn(`[gateway] ${nowIso()} WARN ${msg}${s}`);
}
function logError(msg, meta = {}) {
  const s = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  console.error(`[gateway] ${nowIso()} ERROR ${msg}${s}`);
}
function logDebug(msg, meta = {}) {
  if (!ENABLE_DEBUG_LOGS) return;
  const s = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[gateway] ${nowIso()} DEBUG ${msg}${s}`);
}

// ─── Static admin tokens ──────────────────────────────────────────────────────

function buildStaticTokens() {
  const single = (process.env.AUTH_TOKEN ?? "").trim();
  const many = (process.env.AUTH_TOKENS ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (single) many.push(single);
  return Array.from(new Set(many));
}

const STATIC_TOKENS = buildStaticTokens();

if (!ALLOW_NO_AUTH && STATIC_TOKENS.length === 0) {
  console.error("[gateway] AUTH_TOKEN or AUTH_TOKENS must be set when ALLOW_NO_AUTH=false.");
  process.exit(1);
}

// ─── Dynamic token store ──────────────────────────────────────────────────────

let dynamicTokens = [];

function loadDynamicTokens() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"));
      if (Array.isArray(parsed)) {
        dynamicTokens = parsed;
        logInfo("loaded dynamic tokens", { count: dynamicTokens.length });
      }
    }
  } catch (err) {
    logWarn("could not load tokens file", { error: err.message });
  }
}

function saveDynamicTokens() {
  try {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(dynamicTokens, null, 2), "utf-8");
  } catch (err) {
    logError("failed to save tokens file", { error: err.message });
  }
}

function generateTokenValue() {
  return crypto.randomBytes(32).toString("base64url");
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function extractToken(req) {
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return m[1].trim();
  }
  const key = req.headers["x-api-key"];
  if (typeof key === "string" && key.trim()) return key.trim();
  return "";
}

function isAuthorized(req) {
  if (ALLOW_NO_AUTH) return true;
  const token = extractToken(req);
  if (STATIC_TOKENS.includes(token)) return true;
  return dynamicTokens.some((t) => t.token === token);
}

function isAdminToken(token) {
  if (ALLOW_NO_AUTH) return true;
  return STATIC_TOKENS.includes(token);
}

function resolveClientId(req) {
  const token = extractToken(req);
  const dyn = dynamicTokens.find((t) => t.token === token);
  if (dyn?.clientId) return dyn.clientId;
  const header = getHeaderValue(req.headers, "x-mcp-client-id");
  return header || "default";
}

function touchDynamicToken(token) {
  const entry = dynamicTokens.find((t) => t.token === token);
  if (entry) {
    entry.lastUsedAt = nowIso();
    setImmediate(() => saveDynamicTokens());
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload === null ? "" : JSON.stringify(payload));
}

function getHeaderValue(headers, key) {
  const v = headers[key];
  if (Array.isArray(v)) return v[0] || "";
  return typeof v === "string" ? v : "";
}

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

function redactAuth(headers) {
  const safe = { ...headers };
  if (safe.authorization) safe.authorization = "[redacted]";
  if (safe["x-api-key"]) safe["x-api-key"] = "[redacted]";
  return safe;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", () => resolve(""));
  });
}

// ─── Provider relay ───────────────────────────────────────────────────────────
// Extension registers via HTTP and polls for tool requests.

let providerTools = null;
const pendingRequests = new Map(); // requestId → { resolve, timeoutId }
const requestQueue = [];           // queued requests waiting for an extension poller
const extensionPollers = [];       // waiting poll requests from extension

function dispatchToExtension(request) {
  if (extensionPollers.length > 0) {
    const poller = extensionPollers.shift();
    clearTimeout(poller.timeoutId);
    poller.resolve(request);
  } else {
    requestQueue.push(request);
  }
}

// Ask extension for tool list (returns tools array).
function askExtensionListTools() {
  return new Promise((resolve, reject) => {
    if (providerTools !== null) {
      resolve(providerTools);
      return;
    }
    const requestId = crypto.randomUUID();
    const timeoutId = setTimeout(() => {
      if (pendingRequests.delete(requestId)) {
        logWarn("list_tools timeout — no provider connected");
        resolve([]);
      }
    }, PROVIDER_TIMEOUT_MS);
    pendingRequests.set(requestId, {
      resolve: (payload) => {
        clearTimeout(timeoutId);
        pendingRequests.delete(requestId);
        resolve(Array.isArray(payload?.data) ? payload.data : []);
      },
      timeoutId,
    });
    dispatchToExtension({ type: "list_tools", requestId });
  });
}

// Ask extension to call a tool. Returns { status, data?, message }.
function askExtensionCallTool(name, args) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeoutId = setTimeout(() => {
      if (pendingRequests.delete(requestId)) {
        logWarn("call_tool timeout", { name });
        resolve({ status: "error", message: "Extension provider timeout — is the browser extension running?" });
      }
    }, PROVIDER_TIMEOUT_MS);
    pendingRequests.set(requestId, {
      resolve: (payload) => {
        clearTimeout(timeoutId);
        pendingRequests.delete(requestId);
        resolve(payload);
      },
      timeoutId,
    });
    dispatchToExtension({ type: "call_tool", requestId, payload: { name, args } });
  });
}

// ─── Provider endpoints ───────────────────────────────────────────────────────

async function handleProviderEndpoint(req, res, url) {
  if (req.method === "POST" && url.pathname === "/provider/register") {
    const body = await readBody(req);
    try {
      const { tools } = JSON.parse(body);
      const newTools = Array.isArray(tools) ? tools : [];
      // Only broadcast if tool list actually changed
      const prevJson = providerTools === null ? null : JSON.stringify(providerTools.map(t => t.name).sort());
      const newJson = JSON.stringify(newTools.map(t => t.name).sort());
      const changed = prevJson !== newJson;
      providerTools = newTools;
      logInfo("provider registered", { toolCount: providerTools.length, changed });
      // Notify all active MCP sessions that the tool list changed
      if (changed && mcpSessions.size > 0) {
        const notification = { jsonrpc: "2.0", method: "notifications/tools/list_changed", params: {} };
        for (const [sessionId] of mcpSessions) {
          broadcastSseEvent(sessionId, "message", notification);
        }
        logDebug("broadcasted tools/list_changed", { sessions: mcpSessions.size });
      }
      sendJson(res, 200, { ok: true, toolCount: providerTools.length });
    } catch {
      sendJson(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/provider/queue") {
    if (requestQueue.length > 0) {
      sendJson(res, 200, requestQueue.shift());
      return;
    }
    const request = await new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        const idx = extensionPollers.findIndex((p) => p.timeoutId === timeoutId);
        if (idx !== -1) extensionPollers.splice(idx, 1);
        resolve(null);
      }, 25000);
      extensionPollers.push({ resolve, timeoutId });
    });
    sendJson(res, 200, request ?? { type: "heartbeat" });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/provider/respond/")) {
    const requestId = url.pathname.slice("/provider/respond/".length);
    const body = await readBody(req);
    try {
      const payload = JSON.parse(body);
      const pending = pendingRequests.get(requestId);
      if (!pending) {
        sendJson(res, 404, { error: "Unknown or expired requestId" });
        return;
      }
      pending.resolve(payload);
      sendJson(res, 200, { ok: true });
    } catch {
      sendJson(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

// ─── Token management endpoints ───────────────────────────────────────────────

async function handleTokenManagement(req, res, url) {
  const body = await readBody(req);

  if (req.method === "GET" && url.pathname === "/tokens") {
    sendJson(res, 200, {
      tokens: dynamicTokens.map((t) => ({
        id: t.id,
        name: t.name,
        clientId: t.clientId,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt ?? null,
        tokenPrefix: `${t.token.slice(0, 8)}...`,
      })),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/tokens") {
    let parsed;
    try { parsed = JSON.parse(body); } catch { sendJson(res, 400, { error: "Invalid JSON" }); return; }
    const name = String(parsed.name ?? "").trim();
    if (!name) { sendJson(res, 400, { error: "name is required" }); return; }
    const clientId = String(parsed.clientId ?? name).trim();
    const entry = {
      id: crypto.randomUUID(),
      name,
      clientId,
      token: generateTokenValue(),
      createdAt: nowIso(),
      lastUsedAt: null,
    };
    dynamicTokens.push(entry);
    saveDynamicTokens();
    logInfo("token created", { id: entry.id, name, clientId });
    sendJson(res, 201, { token: entry });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/tokens/")) {
    const id = url.pathname.slice("/tokens/".length);
    const idx = dynamicTokens.findIndex((t) => t.id === id);
    if (idx === -1) { sendJson(res, 404, { error: "Token not found" }); return; }
    const [removed] = dynamicTokens.splice(idx, 1);
    saveDynamicTokens();
    logInfo("token revoked", { id, name: removed.name });
    sendJson(res, 200, { message: "Token revoked" });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

// ─── MCP server (inline implementation) ──────────────────────────────────────
// Per-session MCP over Streamable HTTP (protocol version 2024-11-05).
// Each session gets its own entry in mcpSessions; no shared transport state.

const mcpSessions = new Map(); // sessionId → { clientId, sseRes?, lastSeen }
let reqSeq = 0;

function isInitializeRequest(body) {
  return body?.jsonrpc === "2.0" && body?.method === "initialize";
}

// Convert extension tool result to MCP content array.
function toolResultToContent(toolName, payload) {
  if (!payload || payload.status === "error") {
    return {
      content: [{ type: "text", text: payload?.message || "Tool execution failed" }],
      isError: true,
    };
  }
  const data = payload.data;
  // Screenshot: return as image content
  if (toolName === "browser_take_screenshot" && data?.dataUrl) {
    const dataUrl = String(data.dataUrl);
    const mimeType = dataUrl.match(/^data:([^;]+);base64,/)?.[1] || "image/png";
    const base64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
    return {
      content: [{ type: "image", data: base64, mimeType }],
      isError: false,
    };
  }
  // Everything else: JSON string
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
    isError: false,
  };
}

// Send an SSE event to all active SSE streams for a session (or all sessions).
function broadcastSseEvent(sessionId, event, data) {
  const session = mcpSessions.get(sessionId);
  if (!session?.sseRes || session.sseRes.writableEnded) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  try { session.sseRes.write(payload); } catch { /* ignore */ }
}

async function handleMcpPost(req, res, body, clientId, reqId) {
  const sessionId = getHeaderValue(req.headers, "mcp-session-id");

  // ── New session: initialize ──────────────────────────────────────────────
  if (!sessionId && isInitializeRequest(body)) {
    const newSessionId = crypto.randomUUID();
    mcpSessions.set(newSessionId, { clientId, lastSeen: Date.now() });
    logInfo("MCP session created", { sessionId: newSessionId, clientId, reqId });
    const response = {
      jsonrpc: "2.0",
      id: body.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "claw-a-thon-browser-agent", version: "1.0.0" },
      },
    };
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "mcp-session-id": newSessionId,
    });
    res.end(JSON.stringify(response));
    return;
  }

  // ── Validate existing session ────────────────────────────────────────────
  if (sessionId && !mcpSessions.has(sessionId)) {
    // Session expired or unknown — let client re-initialize
    logWarn("MCP unknown session, sending 400 to force re-init", { sessionId, reqId });
    sendJson(res, 400, { error: "Session not found. Please re-initialize." });
    return;
  }

  if (sessionId) {
    mcpSessions.get(sessionId).lastSeen = Date.now();
  }

  // ── Notifications (fire-and-forget, no response body) ────────────────────
  if (typeof body?.method === "string" && body.method.startsWith("notifications/")) {
    res.writeHead(202);
    res.end();
    return;
  }

  // ── Batch requests ───────────────────────────────────────────────────────
  if (Array.isArray(body)) {
    const responses = await Promise.all(body.map((item) => handleMcpMethod(item, clientId)));
    sendJson(res, 200, responses.filter(Boolean));
    return;
  }

  // ── Single request ───────────────────────────────────────────────────────
  const result = await handleMcpMethod(body, clientId);
  if (result === null) {
    // Notification, no response
    res.writeHead(202); res.end();
  } else {
    sendJson(res, 200, result);
  }
}

async function handleMcpMethod(msg, clientId) {
  if (!msg?.method) return null;
  const { method, id, params } = msg;

  logDebug("MCP method", { method, id, clientId });

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    const tools = await askExtensionListTools();
    return { jsonrpc: "2.0", id, result: { tools } };
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (!name) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: "Missing tool name" } };
    }
    const payload = await askExtensionCallTool(name, args);
    return { jsonrpc: "2.0", id, result: toolResultToContent(name, payload) };
  }

  // Unknown method
  if (id !== undefined) {
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
  return null; // notification with no id, no response
}

async function handleMcpGet(req, res, sessionId, reqId) {
  if (!sessionId || !mcpSessions.has(sessionId)) {
    sendJson(res, 400, { error: "Session not found" });
    return;
  }
  const session = mcpSessions.get(sessionId);
  session.lastSeen = Date.now();

  // Open SSE stream
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  res.flushHeaders();
  res.write(": connected\n\n");

  session.sseRes = res;

  const heartbeat = setInterval(() => {
    if (res.writableEnded) { clearInterval(heartbeat); return; }
    res.write(": heartbeat\n\n");
  }, 20000);

  req.on("close", () => {
    clearInterval(heartbeat);
    if (session.sseRes === res) session.sseRes = null;
    logDebug("SSE closed", { sessionId, reqId });
  });
}

async function handleMcpDelete(req, res, sessionId, reqId) {
  if (!sessionId || !mcpSessions.has(sessionId)) {
    sendJson(res, 400, { error: "Session not found" });
    return;
  }
  const session = mcpSessions.get(sessionId);
  if (session.sseRes && !session.sseRes.writableEnded) {
    session.sseRes.end();
  }
  mcpSessions.delete(sessionId);
  logInfo("MCP session closed", { sessionId, clientId: session.clientId, reqId });
  res.writeHead(204); res.end();
}

// Clean up stale sessions every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, session] of mcpSessions) {
    if (session.lastSeen < cutoff) {
      logDebug("evicting stale MCP session", { sessionId: id });
      mcpSessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ─── Gateway HTTP server ──────────────────────────────────────────────────────

function startGatewayServer() {
  const server = http.createServer(async (req, res) => {
    const origin = `http://${req.headers.host ?? `127.0.0.1:${PORT}`}`;
    const url = new URL(req.url ?? "/", origin);
    const reqId = ++reqSeq;

    // ── Health / ready ───────────────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/ready") {
      sendJson(res, 200, {
        status: "ready",
        provider: providerTools !== null ? `registered (${providerTools.length} tools)` : "not connected",
        sessions: mcpSessions.size,
      });
      return;
    }

    // ── Auth ─────────────────────────────────────────────────────────────────
    if (!isAuthorized(req)) {
      logWarn("unauthorized", { method: req.method, path: url.pathname, ip: getClientIp(req) });
      sendJson(res, 401, { error: "Unauthorized", message: "Provide Authorization: Bearer <token> or x-api-key header." });
      return;
    }

    const token = extractToken(req);
    touchDynamicToken(token);
    const clientId = resolveClientId(req);

    // ── Token management ─────────────────────────────────────────────────────
    if (url.pathname === "/tokens" || url.pathname.startsWith("/tokens/")) {
      if (!isAdminToken(token)) {
        sendJson(res, 403, { error: "Forbidden", message: "Token management requires admin access." });
        return;
      }
      await handleTokenManagement(req, res, url);
      return;
    }

    // ── Provider relay ───────────────────────────────────────────────────────
    if (
      url.pathname === "/provider/register" ||
      url.pathname === "/provider/queue" ||
      url.pathname.startsWith("/provider/respond/")
    ) {
      await handleProviderEndpoint(req, res, url);
      return;
    }

    // ── Debug ────────────────────────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/debug") {
      if (!isAdminToken(token)) { sendJson(res, 403, { error: "Forbidden" }); return; }
      sendJson(res, 200, {
        timestamp: nowIso(),
        provider: {
          registered: providerTools !== null,
          toolCount: providerTools?.length ?? 0,
          pendingRequests: pendingRequests.size,
          queuedRequests: requestQueue.length,
          waitingPollers: extensionPollers.length,
        },
        staticTokenCount: STATIC_TOKENS.length,
        dynamicTokens: dynamicTokens.map((t) => ({
          id: t.id, name: t.name, clientId: t.clientId, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt ?? null,
        })),
        sessions: Array.from(mcpSessions.entries()).map(([sid, s]) => ({
          sessionId: sid, clientId: s.clientId, lastSeen: new Date(s.lastSeen).toISOString(), hasSse: Boolean(s.sseRes),
        })),
      });
      return;
    }

    // ── MCP ──────────────────────────────────────────────────────────────────
    if (url.pathname === "/mcp") {
      const sessionId = getHeaderValue(req.headers, "mcp-session-id");
      logDebug("MCP request", { reqId, method: req.method, clientId, hasSessionId: Boolean(sessionId) });

      if (req.method === "POST") {
        const bodyStr = await readBody(req);
        let body;
        try { body = JSON.parse(bodyStr); } catch {
          sendJson(res, 400, { error: "Invalid JSON" }); return;
        }
        try {
          await handleMcpPost(req, res, body, clientId, reqId);
        } catch (err) {
          logError("MCP POST error", { reqId, error: err.message });
          sendJson(res, 500, { error: "Internal Server Error", message: err.message });
        }
        return;
      }

      if (req.method === "GET") {
        try {
          await handleMcpGet(req, res, sessionId, reqId);
        } catch (err) {
          logError("MCP GET error", { reqId, error: err.message });
          if (!res.headersSent) sendJson(res, 500, { error: err.message });
        }
        return;
      }

      if (req.method === "DELETE") {
        try {
          await handleMcpDelete(req, res, sessionId, reqId);
        } catch (err) {
          logError("MCP DELETE error", { reqId, error: err.message });
          if (!res.headersSent) sendJson(res, 500, { error: err.message });
        }
        return;
      }

      sendJson(res, 405, { error: "Method Not Allowed" });
      return;
    }

    sendJson(res, 404, { error: "Not Found" });
  });

  // Track open connections so we can destroy them on shutdown
  const openConnections = new Set();
  server.on("connection", (socket) => {
    openConnections.add(socket);
    socket.on("close", () => openConnections.delete(socket));
  });
  // Raise limit — each keep-alive connection adds a close listener internally
  server.setMaxListeners(50);

  server.listen(PORT, () => {
    logInfo("gateway listening", {
      url: `http://0.0.0.0:${PORT}`,
      authMode: ALLOW_NO_AUTH ? "disabled" : "enabled",
      staticTokens: STATIC_TOKENS.length,
      dynamicTokens: dynamicTokens.length,
      debugLogs: ENABLE_DEBUG_LOGS,
    });
  });

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logInfo(`${signal} received — shutting down`);
    // Destroy open connections so server.close() can complete immediately
    for (const socket of openConnections) socket.destroy();
    server.close(() => {
      logInfo("server closed");
      process.exit(0);
    });
    // Force exit after 3 s if something still hangs
    setTimeout(() => process.exit(1), 3000).unref();
  }

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

loadDynamicTokens();
startGatewayServer();
