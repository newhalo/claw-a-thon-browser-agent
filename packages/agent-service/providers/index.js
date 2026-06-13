import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

// Runtime config — can be overridden via setProviderConfig()
let runtimeConfig = null;

// Defaults from .env
const envConfig = {
  provider: process.env.PROVIDER || null,
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.CUSTOM_API_KEY || null,
  model: process.env.ANTHROPIC_MODEL || process.env.OPENAI_MODEL || process.env.CUSTOM_MODEL || null,
  baseUrl: process.env.CUSTOM_BASE_URL || null,
  // openai-compat only: set CUSTOM_TOOLS_SUPPORTED=true if model supports function calling
  toolsSupported: process.env.CUSTOM_TOOLS_SUPPORTED === 'true' ? true : null,
};

export function setProviderConfig({ provider, apiKey, model, baseUrl, toolsSupported }) {
  runtimeConfig = {
    provider,
    apiKey,
    model: model || null,
    baseUrl: baseUrl || null,
    toolsSupported: toolsSupported ?? null,
  };
  _instance = null;
  console.log(`[provider] Runtime config updated — provider: ${provider}${toolsSupported != null ? `, tools: ${toolsSupported}` : ''}`);
}

export function getProviderStatus() {
  const cfg = runtimeConfig || envConfig;
  if (!cfg.provider || !cfg.apiKey) return { configured: false, provider: cfg.provider || null };
  return { configured: true, provider: cfg.provider, model: cfg.model, toolsSupported: cfg.toolsSupported };
}

/**
 * Returns true when the active provider can handle function/tool calling.
 * anthropic and openai always support it; openai-compat only if explicitly opted-in.
 */
export function isToolsSupported() {
  const cfg = runtimeConfig || envConfig;
  if (cfg.provider === 'anthropic' || cfg.provider === 'openai') return true;
  if (cfg.provider === 'openai-compat') return cfg.toolsSupported === true;
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
        provider: createOpenAI({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey }),
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
