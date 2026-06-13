/**
 * Predefined model catalog.
 * Extension UI fetches this via GET /models and shows a dropdown in the chat.
 */

export const PREDEFINED_MODELS = [
  // ── VNGCloud ────────────────────────────────────────────────────────────────
  {
    id: 'qwen/qwen3-5-27b',
    name: 'Qwen3 27B',
    category: 'VNGCloud',
    provider: 'openai-compat',
    baseUrl: 'https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1',
    toolsSupported: true,
    visionSupported: false,
    contextWindow: 262144,
    default: true,
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    category: 'VNGCloud',
    provider: 'openai-compat',
    baseUrl: 'https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1',
    toolsSupported: true,
    visionSupported: true,
    contextWindow: 1048576,
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    category: 'VNGCloud',
    provider: 'openai-compat',
    baseUrl: 'https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1',
    toolsSupported: true,
    visionSupported: true,
    contextWindow: 1048576,
  },

  // ── OpenAI ──────────────────────────────────────────────────────────────────
  {
    id: 'gpt-5',
    name: 'GPT-5',
    category: 'OpenAI',
    provider: 'openai',
    toolsSupported: true,
    visionSupported: true,
    contextWindow: 1048576,
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    category: 'OpenAI',
    provider: 'openai',
    toolsSupported: true,
    visionSupported: true,
    contextWindow: 131072,
  },
  {
    id: 'gpt-5-nano',
    name: 'GPT-5 Nano',
    category: 'OpenAI',
    provider: 'openai',
    toolsSupported: true,
    visionSupported: true,
    contextWindow: 131072,
  },

  // ── DeepSeek ─────────────────────────────────────────────────────────────────
  {
    id: 'deepseek-v4',
    name: 'DeepSeek V4 Pro',
    category: 'DeepSeek',
    provider: 'openai-compat',
    baseUrl: 'https://api.deepseek.com/v1',
    toolsSupported: true,
    visionSupported: false,
    contextWindow: 131072,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    category: 'DeepSeek',
    provider: 'openai-compat',
    baseUrl: 'https://api.deepseek.com/v1',
    toolsSupported: true,
    visionSupported: false,
    contextWindow: 131072,
  },
];

export const DEFAULT_MODEL_ID = 'qwen/qwen3-5-27b';

export function getModelById(id) {
  return PREDEFINED_MODELS.find(m => m.id === id) ?? null;
}
