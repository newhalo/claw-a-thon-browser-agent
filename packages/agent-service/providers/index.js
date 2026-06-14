import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

/**
 * Some openai-compat APIs (e.g. VNGCloud Gemini) omit the required `index`
 * field from streaming tool_call delta chunks. @ai-sdk/openai validates this
 * strictly and throws AI_TypeValidationError.
 *
 * This fetch wrapper intercepts SSE chunks and injects `index: 0` on any
 * tool_call entry that is missing it, making the stream valid.
 */
function patchToolCallIndexFetch(url, init) {
  return fetch(url, init).then(res => {
    if (!res.body) return res;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) { controller.close(); return; }

        const text = decoder.decode(value, { stream: true });
        const patched = text.replace(/("tool_calls"\s*:\s*\[)([\s\S]*?)(\])/g, (match) => {
          // Add index to each tool_call entry that lacks it
          return match.replace(/"type"\s*:\s*"function"/g, (m, offset, str) => {
            // Check if there's already an index before this entry
            const before = str.slice(Math.max(0, offset - 100), offset);
            if (/"index"\s*:/.test(before)) return m;
            return '"index":0,"type":"function"';
          });
        });

        controller.enqueue(encoder.encode(patched));
      },
    });

    return new Response(stream, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  });
}

// Runtime config — can be overridden via setProviderConfig()
let runtimeConfig = null;

// Defaults from .env
const envConfig = {
  provider: process.env.PROVIDER || null,
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.CUSTOM_API_KEY || null,
  model: process.env.ANTHROPIC_MODEL || process.env.OPENAI_MODEL || process.env.CUSTOM_MODEL || null,
  baseUrl: process.env.CUSTOM_BASE_URL || null,
  toolsSupported: process.env.CUSTOM_TOOLS_SUPPORTED === 'true' ? true : null,
  visionSupported: process.env.CUSTOM_VISION_SUPPORTED === 'true' ? true : null,
};

export function setProviderConfig({ provider, apiKey, model, baseUrl, toolsSupported, visionSupported }) {
  runtimeConfig = {
    provider,
    apiKey,
    model: model || null,
    baseUrl: baseUrl || null,
    toolsSupported: toolsSupported ?? null,
    visionSupported: visionSupported ?? null,
  };
  _instance = null;
  console.log(`[provider] Runtime config updated — provider: ${provider}${toolsSupported != null ? `, tools: ${toolsSupported}` : ''}${visionSupported != null ? `, vision: ${visionSupported}` : ''}`);
}

export function getProviderStatus() {
  const cfg = runtimeConfig || envConfig;
  if (!cfg.provider || !cfg.apiKey) return { configured: false, provider: cfg.provider || null };
  return { configured: true, provider: cfg.provider, model: cfg.model, toolsSupported: cfg.toolsSupported, visionSupported: cfg.visionSupported };
}

export function isToolsSupported() {
  const cfg = runtimeConfig || envConfig;
  if (cfg.provider === 'anthropic' || cfg.provider === 'openai') return true;
  if (cfg.provider === 'openai-compat') return cfg.toolsSupported === true;
  return false;
}

export function isVisionSupported() {
  const cfg = runtimeConfig || envConfig;
  if (cfg.provider === 'anthropic' || cfg.provider === 'openai') return true;
  if (cfg.provider === 'openai-compat') return cfg.visionSupported === true;
  return false;
}

function buildInstance(cfg) {
  switch (cfg.provider) {
    case 'anthropic': {
      if (!cfg.apiKey) throw new Error('API key required for Anthropic');
      return {
        provider: createAnthropic({ apiKey: cfg.apiKey }),
        modelId: cfg.model || 'claude-sonnet-4-6',
        name: 'Anthropic',
      };
    }
    case 'openai': {
      if (!cfg.apiKey) throw new Error('API key required for OpenAI');
      return {
        provider: createOpenAI({ apiKey: cfg.apiKey }),
        modelId: cfg.model || 'gpt-4o',
        name: 'OpenAI',
      };
    }
    case 'openai-compat': {
      if (!cfg.apiKey) throw new Error('API key required for custom provider');
      if (!cfg.baseUrl) throw new Error('Base URL required for custom provider');
      return {
        provider: createOpenAI({
          baseURL: cfg.baseUrl,
          apiKey: cfg.apiKey,
          fetch: cfg.toolsSupported ? patchToolCallIndexFetch : undefined,
        }),
        modelId: cfg.model || 'gpt-4o',
        name: `Custom (${cfg.baseUrl})`,
      };
    }
    default:
      throw new Error(`Unknown provider: "${cfg.provider}". Use: anthropic | openai | openai-compat`);
  }
}

let _instance = null;

export function getProvider() {
  if (_instance) return _instance;
  const cfg = runtimeConfig || envConfig;
  if (!cfg.provider) throw new Error('No LLM provider configured. POST /provider-config to set one.');
  _instance = buildInstance(cfg);
  console.log(`[provider] Using ${_instance.name} — model: ${_instance.modelId}`);
  return _instance;
}

export function getModel() {
  const { provider, modelId } = getProvider();
  return provider(modelId);
}

/**
 * Returns an embedding model for the current provider config, or null if unavailable.
 * OpenAI / openai-compat → text-embedding-3-small at the configured base URL.
 * Anthropic → null (no native embedding API).
 */
export function getEmbeddingModel() {
  const cfg = runtimeConfig || envConfig;
  if (!cfg.apiKey) return null;
  try {
    switch (cfg.provider) {
      case 'openai':
        return createOpenAI({ apiKey: cfg.apiKey }).embedding('text-embedding-3-small');
      case 'openai-compat':
        if (!cfg.baseUrl) return null;
        return createOpenAI({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey }).embedding('text-embedding-3-small');
      default:
        return null;
    }
  } catch {
    return null;
  }
}
