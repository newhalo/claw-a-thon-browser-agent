import type { PredefinedModel } from './agentServiceClient';

export const BUNDLED_MODELS: PredefinedModel[] = [
  // ── VNGCloud ──────────────────────────────────────────────────────────────
  {
    id: 'qwen/qwen3-5-27b',
    name: 'Qwen3 27B',
    category: 'VNGCloud',
    provider: 'openai-compat',
    baseUrl: 'https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1',
    toolsSupported: true,
    visionSupported: false,
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
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    category: 'VNGCloud',
    provider: 'openai-compat',
    baseUrl: 'https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1',
    toolsSupported: true,
    visionSupported: true,
  },

  // ── OpenAI ────────────────────────────────────────────────────────────────
  {
    id: 'gpt-5',
    name: 'GPT-5',
    category: 'OpenAI',
    provider: 'openai',
    toolsSupported: true,
    visionSupported: true,
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    category: 'OpenAI',
    provider: 'openai',
    toolsSupported: true,
    visionSupported: true,
  },
  {
    id: 'gpt-5-nano',
    name: 'GPT-5 Nano',
    category: 'OpenAI',
    provider: 'openai',
    toolsSupported: true,
    visionSupported: true,
  },

  // ── DeepSeek ──────────────────────────────────────────────────────────────
  {
    id: 'deepseek-v4',
    name: 'DeepSeek V4 Pro',
    category: 'DeepSeek',
    provider: 'openai-compat',
    baseUrl: 'https://api.deepseek.com/v1',
    toolsSupported: true,
    visionSupported: false,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    category: 'DeepSeek',
    provider: 'openai-compat',
    baseUrl: 'https://api.deepseek.com/v1',
    toolsSupported: true,
    visionSupported: false,
  },
];
