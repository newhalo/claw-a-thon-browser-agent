/**
 * POST /chat — streaming chat endpoint.
 *
 * Request body:
 * {
 *   messages: Message[],          // latest messages from UI (user turn)
 *   conversationId?: string,      // for short-term memory continuity
 *   enabledTools?: string[],      // tool names user has enabled in extension
 * }
 *
 * Response: text/event-stream (Vercel AI SDK data stream protocol)
 */

import { streamText, tool } from 'ai';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getModel, getProviderStatus } from '../providers/index.js';
import { listTools, callTool } from '../mcp/client.js';
import { getHistory, appendMessages } from '../memory/short-term.js';

const SYSTEM_PROMPT = `You are a browser automation agent with access to browser tools via MCP (Model Context Protocol).

You can help the user:
- Open, close, and navigate browser tabs
- Read and interact with webpage content
- Manage bookmarks, history, and downloads
- Execute JavaScript on pages
- Take screenshots and inspect page elements
- Automate repetitive browser tasks

Guidelines:
- Use available tools to accomplish tasks step by step
- Be concise — summarize what you did, not every intermediate step
- If a tool call fails, explain why and offer alternatives
- Always confirm before destructive actions (closing tabs, clearing data, form submission)
- When navigating to a URL the user mentioned, use it exactly as given

Current date: ${new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;

function buildToolsFromMcp(mcpTools, enabledTools) {
  const allowed = enabledTools && enabledTools.length > 0
    ? new Set(enabledTools)
    : null; // null = all tools enabled

  const result = {};

  for (const t of mcpTools) {
    if (allowed && !allowed.has(t.name)) continue;

    // Build a Zod schema from MCP input schema
    const inputSchema = t.inputSchema || { type: 'object', properties: {}, required: [] };
    const zodShape = {};

    for (const [key, prop] of Object.entries(inputSchema.properties || {})) {
      const required = (inputSchema.required || []).includes(key);
      let zodType;

      switch (prop.type) {
        case 'number':
        case 'integer':
          zodType = z.number();
          break;
        case 'boolean':
          zodType = z.boolean();
          break;
        case 'array':
          zodType = z.array(z.unknown());
          break;
        case 'object':
          zodType = z.record(z.unknown());
          break;
        default:
          zodType = z.string();
      }

      if (prop.description) zodType = zodType.describe(prop.description);
      zodShape[key] = required ? zodType : zodType.optional();
    }

    result[t.name] = tool({
      description: t.description || t.name,
      parameters: z.object(zodShape),
      execute: async (args) => {
        try {
          const res = await callTool(t.name, args);
          // MCP result is { content: [{ type, text } | { type, data, mimeType }] }
          const content = res?.content ?? [];
          const textParts = content.filter(c => c.type === 'text').map(c => c.text);
          if (textParts.length > 0) return textParts.join('\n');
          // Image content
          const imgPart = content.find(c => c.type === 'image');
          if (imgPart) return `[screenshot: data:${imgPart.mimeType};base64,${imgPart.data}]`;
          return JSON.stringify(res);
        } catch (err) {
          return `Error: ${err.message}`;
        }
      },
    });
  }

  return result;
}

export default async function chatRoute(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405).end('Method Not Allowed');
    return;
  }

  let body;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    res.writeHead(400).end('Invalid JSON');
    return;
  }

  const { messages = [], conversationId = uuidv4(), enabledTools } = body;

  if (!messages.length) {
    res.writeHead(400).end('messages array is required');
    return;
  }

  // Fetch MCP tools (cached 30s)
  let mcpTools = [];
  try {
    mcpTools = await listTools();
  } catch (err) {
    console.warn('[chat] Could not fetch MCP tools:', err.message);
  }

  const tools = buildToolsFromMcp(mcpTools, enabledTools);

  // Merge with short-term history
  const history = getHistory(conversationId);
  const allMessages = history.length > 0
    ? [...history, ...messages]
    : messages;

  // Set headers before streaming — pipeDataStreamToResponse will call writeHead itself
  res.setHeader('X-Conversation-Id', conversationId);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const hasTools = Object.keys(tools).length > 0;

  const streamOpts = {
    model: getModel(),
    system: SYSTEM_PROMPT,
    messages: allMessages,
    maxSteps: hasTools ? 10 : 1,
    onFinish: ({ response }) => {
      appendMessages(conversationId, [...messages, ...response.messages]);
    },
  };

  // Only pass tools if the provider supports function calling.
  // openai-compat providers (e.g. VNGCloud gemma) may not — omit tools to avoid
  // InvalidResponseDataError when the model returns malformed tool_call chunks.
  const { provider: providerName } = getProviderStatus();
  if (hasTools && providerName !== 'openai-compat') {
    streamOpts.tools = tools;
  }

  try {
    const result = streamText(streamOpts);
    // Must await — errors during streaming otherwise become unhandled rejections
    await result.pipeDataStreamToResponse(res);
  } catch (err) {
    console.error('[chat] Stream error:', err.message || err);
    if (!res.headersSent) {
      res.writeHead(500).end('Internal server error');
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}
