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
import { getModel, getProviderStatus, isToolsSupported } from '../providers/index.js';
import { getCustomSystemPrompt } from '../config.js';
import { listTools, callTool } from '../mcp/client.js';
import { getHistory, appendMessages } from '../memory/short-term.js';

const DATE_STR = new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

// Full system prompt used when the provider supports function/tool calling
const SYSTEM_PROMPT = `You are a browser automation agent with access to browser tools via MCP (Model Context Protocol).

## Tool selection guide
- User asks about current page content/areas/elements → call browser_get_page_content (format: "text") FIRST, then summarize
- Text doesn't reveal the UI element (e.g. a menu item only visible on screen) → take a screenshot with browser_take_screenshot, then describe what you see
- User asks about current tab URL/title only → browser_get_active_tab or browser_get_page_info
- Need to discover all interactive elements (buttons, links, nav items) → browser_find_elements with selector "a,button,[role='menuitem'],[role='tab'],nav *"
- Website-specific tools (name starts with website_tool_) give richer structured data — prefer them over generic browser tools when available for the current site
- For multi-step tasks: get context first, then act, then confirm result

## When text is not enough
If page text content doesn't contain the information the user asked about (e.g. a menu or UI element not reflected in text), escalate in this order:
1. Try browser_get_page_content with format "html" to see hidden/dynamic elements
2. Try browser_find_elements with a broad CSS selector to discover visible UI
3. Take a screenshot with browser_take_screenshot to visually inspect the page

## Capabilities
- Open, close, and navigate browser tabs
- Read and interact with webpage content
- Manage bookmarks, history, and downloads
- Automate repetitive browser tasks

## Guidelines
- Always use tools to get real data — never guess page content
- Be concise — summarize results, not every intermediate step
- Confirm before destructive actions (closing tabs, clearing data, form submission)
- When navigating to a URL the user mentioned, use it exactly as given
- If a tool fails, explain why and try the next escalation step

Current date: ${DATE_STR}`;

// Stripped system prompt for openai-compat models that don't reliably support function calling.
// Avoids mentioning tools so the model doesn't spontaneously generate tool-call tokens.
const SYSTEM_PROMPT_NO_TOOLS = `You are a helpful browser assistant. Answer the user's questions and help with browser-related tasks by providing clear instructions and information. Respond entirely in plain text — do not call any functions or tools.

Current date: ${DATE_STR}`;

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

  // Client (Zustand) already sends the full conversation history.
  // Do NOT prepend server-side history — that would duplicate messages and confuse the model.
  const allMessages = messages;

  // Set headers before streaming — pipeDataStreamToResponse will call writeHead itself
  res.setHeader('X-Conversation-Id', conversationId);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const { configured } = getProviderStatus();
    if (!configured) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'provider_not_configured' }));
      return;
    }

    const toolsOk = isToolsSupported();
    const hasTools = Object.keys(tools).length > 0;

    const basePrompt = toolsOk ? SYSTEM_PROMPT : SYSTEM_PROMPT_NO_TOOLS;
    const customPrompt = getCustomSystemPrompt();
    const systemPrompt = customPrompt
      ? `${basePrompt}\n\n## Custom instructions\n${customPrompt}`
      : basePrompt;

    const streamOpts = {
      model: getModel(),
      system: systemPrompt,
      messages: allMessages,
      maxSteps: (hasTools && toolsOk) ? 10 : 1,
      // Disable built-in retries — 429s retry immediately with no backoff, making things worse.
      // The client should handle retry/backoff at a higher level.
      maxRetries: 0,
      onFinish: ({ response }) => {
        if (response?.messages?.length) {
          appendMessages(conversationId, [...messages, ...response.messages]);
        }
      },
    };

    if (hasTools && toolsOk) {
      streamOpts.tools = tools;
    }

    const result = streamText({
      ...streamOpts,
      onError: ({ error }) => {
        const status = error?.statusCode ?? error?.status;
        const retryAfter = error?.responseHeaders?.['ai-ratelimit-reset'];
        let userMsg;
        if (status === 429) {
          const wait = retryAfter ? ` Thử lại sau ${Math.ceil(retryAfter / 60)} phút.` : '';
          userMsg = `Rate limit: API quota đã hết.${wait}`;
          console.warn(`[chat] ${userMsg}`);
        } else {
          userMsg = error?.message || 'Unknown error';
          console.error('[chat] streamText error:', userMsg);
        }
        // Write error chunk manually so client displays the message
        if (!res.writableEnded) {
          res.write(`3:${JSON.stringify(userMsg)}\n`);
        }
      },
    });
    await result.pipeDataStreamToResponse(res);
  } catch (err) {
    const isRateLimit = err.message?.includes('Too Many Requests') || err.statusCode === 429 || err.status === 429;
    console.error(`[chat] Stream error${isRateLimit ? ' (rate limit)' : ''}:`, err.message || err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    } else if (!res.writableEnded) {
      // Stream already started — send error chunk so client shows the message
      const isRateLimit2 = err.message?.includes('Too Many Requests') || err.statusCode === 429;
      const msg = isRateLimit2
        ? 'Rate limit exceeded. Please wait a moment and try again.'
        : (err.message || 'An error occurred');
      res.write(`3:${JSON.stringify(msg)}\n`);
      res.end();
    }
  }
}
