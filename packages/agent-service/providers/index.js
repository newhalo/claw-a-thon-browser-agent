/**
 * LLM provider factory.
 * Returns an AI SDK provider instance based on PROVIDER env var.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

const PROVIDER = process.env.PROVIDER || 'anthropic';

function buildAnthropicProvider() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');
  return {
    provider: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    modelId: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    name: 'Anthropic',
  };
}

function buildOpenAIProvider() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
  return {
    provider: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    modelId: process.env.OPENAI_MODEL || 'gpt-4o',
    name: 'OpenAI',
  };
}

function buildOpenAICompatProvider() {
  if (!process.env.CUSTOM_BASE_URL) throw new Error('CUSTOM_BASE_URL is required for openai-compat provider');
  if (!process.env.CUSTOM_API_KEY) throw new Error('CUSTOM_API_KEY is required for openai-compat provider');
  return {
    provider: createOpenAI({
      baseURL: process.env.CUSTOM_BASE_URL,
      apiKey: process.env.CUSTOM_API_KEY,
    }),
    modelId: process.env.CUSTOM_MODEL || 'gpt-4o',
    name: `Custom (${process.env.CUSTOM_BASE_URL})`,
  };
}

let _instance = null;

export function getProvider() {
  if (_instance) return _instance;

  switch (PROVIDER) {
    case 'anthropic':
      _instance = buildAnthropicProvider();
      break;
    case 'openai':
      _instance = buildOpenAIProvider();
      break;
    case 'openai-compat':
      _instance = buildOpenAICompatProvider();
      break;
    default:
      throw new Error(`Unknown PROVIDER: "${PROVIDER}". Use: anthropic | openai | openai-compat`);
  }

  console.log(`[provider] Using ${_instance.name} — model: ${_instance.modelId}`);
  return _instance;
}

export function getModel() {
  const { provider, modelId } = getProvider();
  return provider(modelId);
}
