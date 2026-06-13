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
};

export function setProviderConfig({ provider, apiKey, model, baseUrl }) {
  runtimeConfig = { provider, apiKey, model: model || null, baseUrl: baseUrl || null };
  _instance = null; // reset cached provider
  console.log(`[provider] Runtime config updated — provider: ${provider}`);
}

export function getProviderStatus() {
  const cfg = runtimeConfig || envConfig;
  if (!cfg.provider || !cfg.apiKey) return { configured: false, provider: cfg.provider || null };
  return { configured: true, provider: cfg.provider, model: cfg.model };
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
