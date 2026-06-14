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

import { streamText, generateText, embed, tool } from 'ai';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getModel, getEmbeddingModel, getProviderStatus, isToolsSupported, isVisionSupported } from '../providers/index.js';
import { getCustomSystemPrompt } from '../config.js';
import { listTools, callTool } from '../mcp/client.js';
import { getHistory, appendMessages } from '../memory/short-term.js';
import { searchMemories, consolidateConversation } from '../memory/long-term.js';
import { getSkillById } from '../skills/registry.js';

// Screenshot store — keeps base64 images out of LLM context.
// execute() stores the dataUrl here and returns a short [screenshot:ID] reference.
// GET /screenshot/:id serves it back to the UI.
export const screenshotStore = new Map(); // id → { dataUrl, createdAt }

// Prune screenshots older than 10 minutes to avoid memory leaks
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, entry] of screenshotStore) {
    if (entry.createdAt < cutoff) screenshotStore.delete(id);
  }
}, 60_000);

const DATE_STR = new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

// Full system prompt used when the provider supports function/tool calling
const SYSTEM_PROMPT = `You are a browser automation agent with access to browser tools via MCP (Model Context Protocol).

## Strategy by task type

### Reading / summarizing page content
1. browser_get_page_content (format: "text") — fast, low token cost, use first
2. browser_find_elements with broad selector — when you need specific elements
3. browser_take_screenshot — only when visual layout matters (charts, images, UI that text can't describe)
- Website-specific tools (name starts with website_tool_) give richer structured data — always prefer them over generic browser tools when available

### Interacting with the page (click, type, fill, select)
**Do NOT read full page content first.** Go directly to interaction:
1. browser_find_elements with a targeted CSS selector to locate the element and confirm it exists
2. Use the selector from step 1 directly with browser_click / browser_type / browser_select_option / browser_check_element
3. If the element isn't found, try a broader selector or browser_wait_for_element (for dynamic content)
4. After acting, verify by calling browser_get_element_text or browser_find_elements again — NOT a full page read

### Filling a form
1. browser_get_forms — get all fields and their selectors in one call
2. browser_type / browser_select_option / browser_check_element on each field using the selectors from step 1
3. browser_click the submit button
4. Verify result with browser_get_page_content (text) or browser_wait_for_element for a success indicator

### Navigating + acting on the new page
1. browser_navigate — navigate to URL
2. browser_wait_for_element with a key selector to confirm page loaded (e.g. "main", "h1", "#content")
3. Proceed with interaction steps above — do NOT call browser_get_page_content before finding your target

## Efficient selector strategy
- Prefer specific selectors: #id, [data-testid="x"], button[type="submit"], input[name="email"]
- Use browser_find_elements first to confirm the selector matches before acting on it
- If an action fails, try: scroll element into view with browser_scroll (selector), then retry
- For dynamic SPAs: browser_wait_for_element before interacting

## Screenshot usage
Only take a screenshot when:
- User explicitly asks to see the page
- Text/HTML content is insufficient to understand layout or visual state
- Verifying a visual result (e.g. confirming a dialog appeared, chart rendered)
Do NOT take screenshots as a general-purpose "what's on the page" check — use browser_find_elements instead.

## General guidelines
- Always use tools to get real data — never guess page content or element selectors
- Be concise — report what you did and the result, not every intermediate step
- Confirm before destructive actions (closing tabs, clearing data, form submission)
- When navigating to a URL the user mentioned, use it exactly as given
- If a selector fails twice, take a screenshot to visually inspect the page, then adjust

Current date: ${DATE_STR}`;

// Stripped system prompt for openai-compat models that don't reliably support function calling.
// Avoids mentioning tools so the model doesn't spontaneously generate tool-call tokens.
const SYSTEM_PROMPT_NO_TOOLS = `You are a helpful browser assistant. Answer the user's questions and help with browser-related tasks by providing clear instructions and information. Respond entirely in plain text — do not call any functions or tools.

Current date: ${DATE_STR}`;

// ── Context compression ───────────────────────────────────────────────────────

const COMPRESS_TOKEN_THRESHOLD = 60_000; // ~240k chars; compress before hitting model limit
const KEEP_RECENT = 8; // keep last N messages verbatim after compression

function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    chars += content.length + 16; // ~16 chars overhead per message role/metadata
  }
  return Math.ceil(chars / 4); // 4 chars ≈ 1 token
}

async function compressHistory(messages) {
  if (messages.length <= KEEP_RECENT) return { messages, compressed: false };

  const toSummarize = messages.slice(0, messages.length - KEEP_RECENT);
  const recent = messages.slice(messages.length - KEEP_RECENT);

  const historyText = toSummarize.map(m => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return `${m.role.toUpperCase()}: ${content}`;
  }).join('\n\n');

  try {
    const { text } = await generateText({
      model: getModel(),
      maxRetries: 0,
      messages: [
        {
          role: 'user',
          content: `Summarize the following conversation history concisely, preserving all key facts, decisions, goals, and context needed to continue the task. Output a single paragraph starting with "Previous conversation summary:"\n\n${historyText}`,
        },
      ],
    });

    const summaryMsg = { role: 'user', content: text.trim() };
    return { messages: [summaryMsg, ...recent], compressed: true };
  } catch (err) {
    console.warn('[chat] Context compression failed, using original messages:', err.message);
    return { messages, compressed: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

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
          // Image content — store in screenshotStore to keep base64 out of LLM context.
          // Vision models: return proper image content part so the model can see the screenshot.
          // Non-vision models: return short text reference only.
          const imgPart = content.find(c => c.type === 'image');
          if (imgPart) {
            const id = uuidv4();
            screenshotStore.set(id, { dataUrl: `data:${imgPart.mimeType};base64,${imgPart.data}`, createdAt: Date.now() });
            if (isVisionSupported()) {
              return [
                { type: 'image', image: Buffer.from(imgPart.data, 'base64'), mimeType: imgPart.mimeType },
                { type: 'text', text: `[screenshot:${id}]` },
              ];
            }
            return `[screenshot:${id}]`;
          }
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

  const { messages = [], conversationId = uuidv4(), enabledTools, disabledTools, activeSkills = [], customSkills = [] } = body;

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

  // Apply disabledTools denylist (external MCP tools toggled off in UI)
  const effectiveMcpTools = disabledTools?.length
    ? mcpTools.filter(t => !disabledTools.includes(t.name))
    : mcpTools;

  const tools = buildToolsFromMcp(effectiveMcpTools, enabledTools);

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

    // Resolve active skills and merge their required tools into enabledTools
    const skillDefs = activeSkills.map(id => getSkillById(id)).filter(Boolean);
    // Merge custom skills sent from extension (only those that are also in activeSkills)
    const activeCustomSkills = customSkills.filter(s => activeSkills.includes(s.id));
    const allSkillPrompts = [
      ...skillDefs.map(s => s.systemPrompt),
      ...activeCustomSkills.map(s => s.systemPrompt),
    ];
    const skillSystemPrompts = allSkillPrompts.join('\n\n');

    // Retrieve relevant long-term memories for this query
    const firstUserMsg = messages.findLast(m => m.role === 'user');
    let memoryContext = '';
    if (firstUserMsg) {
      try {
        const queryText = typeof firstUserMsg.content === 'string'
          ? firstUserMsg.content
          : (Array.isArray(firstUserMsg.content)
              ? firstUserMsg.content.filter(p => p.type === 'text').map(p => p.text).join(' ')
              : '');

        let queryEmbedding = null;
        try {
          const embModel = getEmbeddingModel();
          if (embModel) {
            const { embedding } = await embed({ model: embModel, value: queryText });
            queryEmbedding = embedding;
          }
        } catch { /* embedding unavailable — fall through to FTS */ }

        const memories = searchMemories(queryText, queryEmbedding, 4);
        if (memories.length > 0) {
          memoryContext = memories.map(m => `- ${m.content}`).join('\n');
        }
      } catch (err) {
        console.warn('[memory] Search failed:', err.message);
      }
    }

    const basePrompt = toolsOk ? SYSTEM_PROMPT : SYSTEM_PROMPT_NO_TOOLS;
    const customPrompt = getCustomSystemPrompt();
    const systemPrompt = [
      basePrompt,
      skillSystemPrompts || null,
      memoryContext ? `## Relevant context from past conversations\n${memoryContext}` : null,
      customPrompt ? `## Custom instructions\n${customPrompt}` : null,
    ].filter(Boolean).join('\n\n');

    if (skillDefs.length > 0 || activeCustomSkills.length > 0) {
      console.log(`[chat] Active skills: ${[...skillDefs.map(s => s.id), ...activeCustomSkills.map(s => s.id)].join(', ')}`);
    }

    // Auto-compress context if estimated token count exceeds threshold
    let finalMessages = allMessages;
    let contextCompressed = false;
    const estimatedTokens = estimateTokens(allMessages);
    if (estimatedTokens > COMPRESS_TOKEN_THRESHOLD) {
      console.log(`[chat] Context too large (~${estimatedTokens} tokens), compressing...`);
      const result = await compressHistory(allMessages);
      finalMessages = result.messages;
      contextCompressed = result.compressed;
      if (contextCompressed) {
        console.log(`[chat] Compressed ${allMessages.length} → ${finalMessages.length} messages`);
      }
    }

    if (contextCompressed) {
      res.setHeader('X-Context-Compressed', 'true');
    }

    const streamOpts = {
      model: getModel(),
      system: systemPrompt,
      messages: finalMessages,
      maxSteps: (hasTools && toolsOk) ? 25 : 1,
      // Disable built-in retries — 429s retry immediately with no backoff, making things worse.
      // The client should handle retry/backoff at a higher level.
      maxRetries: 0,
      onFinish: ({ response, usage, finishReason }) => {
        console.log(`[chat] finish reason=${finishReason} usage=${JSON.stringify(usage)}`);
        if (finishReason === 'length') {
          console.warn('[chat] WARNING: stream cut off due to context length limit');
        }
        const fullHistory = response?.messages?.length
          ? [...messages, ...response.messages]
          : messages;
        if (response?.messages?.length) {
          appendMessages(conversationId, fullHistory);
        }
        // Async long-term memory consolidation — fire and forget, never blocks stream
        consolidateConversation(conversationId, fullHistory, getModel, getEmbeddingModel)
          .catch(err => console.warn('[memory] consolidation error:', err?.message || err));
      },
    };

    if (hasTools && toolsOk) {
      streamOpts.tools = tools;
    }

    const result = streamText({
      ...streamOpts,
      onError: ({ error }) => {
        // Suppress unhandled rejection from background promises (text, usage, finishReason)
        // that Vercel AI SDK creates internally — they reject if the stream errors.
        result.text.catch(() => {});
        result.usage.catch(() => {});
        result.finishReason.catch(() => {});
        // Log only — error message is sent via getErrorMessage in pipeDataStreamToResponse
        const status = error?.statusCode ?? error?.status;
        if (status === 429) {
          console.warn('[chat] Rate limit hit (429)');
        } else {
          console.error('[chat] streamText error:', error?.message || error);
        }
      },
    });
    await result.pipeDataStreamToResponse(res, {
      getErrorMessage: (error) => {
        const status = error?.statusCode ?? error?.status;
        if (status === 429) {
          const retryAfter = error?.responseHeaders?.['ai-ratelimit-reset'];
          const wait = retryAfter ? ` Thử lại sau ${Math.ceil(retryAfter / 60)} phút.` : '';
          return `Rate limit: API quota đã hết.${wait}`;
        }
        return error?.message || 'An error occurred';
      },
    });
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
