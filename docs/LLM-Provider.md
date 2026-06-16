Chat

```bash
curl --request POST \
--url 'https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1/chat/completions' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer $AI_PLATFORM_API_KEY' \
--data '{
  "model": "google/gemma-4-31b-it",
  "messages": [
    {
      "role": "assistant",
      "content": "You are an AI assistant tasked with providing information to users."
    },
    {
      "role": "user",
      "content": "What is AI?"
    }
  ],
  "max_tokens": 2000,
  "temperature": 1,
  "top_p": 0.7,
  "presence_penalty": 0
}'
```

Messages

```bash
curl --request POST \
--url 'https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1/messages' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer $AI_PLATFORM_API_KEY' \
--data '{
  "model": "google/gemma-4-31b-it",
  "messages": [
    {
      "role": "assistant",
      "content": "You are an AI assistant tasked with providing information to users."
    },
    {
      "role": "user",
      "content": "What is AI?"
    }
  ],
  "max_tokens": 2000
}'
```

List models

```bash
curl --request GET \
--url 'https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1/models' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer $AI_PLATFORM_API_KEY'
```

list model sample response:

```json
{
  "object": "list",
  "data": [
    {
      "id": "minimax/minimax-m2.5",
      "object": "model",
      "created": 1776397849,
      "status": "enabled",
      "owned_by": "minimax",
      "model_type": "messages"
    },
    {
      "id": "qwen/qwen3-5-27b",
      "object": "model",
      "created": 1774856739,
      "status": "enabled",
      "owned_by": "qwen",
      "model_type": "messages"
    },
    {
      "id": "google/gemma-4-31b-it",
      "object": "model",
      "created": 1775469420,
      "status": "enabled",
      "owned_by": "google",
      "model_type": "messages"
    },
    {
      "id": "qwen/qwen3.7-plus",
      "object": "model",
      "created": 1781013032,
      "status": "enabled",
      "owned_by": "qwen",
      "model_type": "messages"
    },
    {
      "id": "deepseek/deepseek-v4-flash",
      "object": "model",
      "created": 1781013032,
      "status": "enabled",
      "owned_by": "deepseek",
      "model_type": "messages"
    },
    {
      "id": "deepseek/deepseek-v4-pro",
      "object": "model",
      "created": 1781013032,
      "status": "enabled",
      "owned_by": "deepseek",
      "model_type": "messages"
    },
    {
      "id": "qwen/qwen3.6-27b",
      "object": "model",
      "created": 1779778372,
      "status": "enabled",
      "owned_by": "qwen",
      "model_type": "messages"
    },
    {
      "id": "gemini/gemini-3.1-pro-preview",
      "object": "model",
      "created": 1774408438,
      "status": "enabled",
      "owned_by": "google",
      "model_type": "chat"
    },
    {
      "id": "openai/whisper-large-v3",
      "object": "model",
      "created": 1746615221,
      "status": "enabled",
      "owned_by": "openai",
      "model_type": "stt"
    },
    {
      "id": "qwen/qwen3-235b-a22b-instruct-2507",
      "object": "model",
      "created": 1746616140,
      "status": "enabled",
      "owned_by": "qwen",
      "model_type": "chat"
    },
    {
      "id": "baai/bge-m3",
      "object": "model",
      "created": 1746616140,
      "status": "enabled",
      "owned_by": "baai",
      "model_type": "embedding"
    },
    {
      "id": "google/gemma-3-27b-it",
      "object": "model",
      "created": 1746616140,
      "status": "enabled",
      "owned_by": "google",
      "model_type": null
    },
    {
      "id": "bytedance/seed-1-6-flash-250715",
      "object": "model",
      "created": 1762403342,
      "status": "enabled",
      "owned_by": "bytedance",
      "model_type": null
    },
    {
      "id": "bytedance/seed-1-6-250915",
      "object": "model",
      "created": 1762403342,
      "status": "enabled",
      "owned_by": "bytedance",
      "model_type": null
    },
    {
      "id": "greennode/idp",
      "object": "model",
      "created": 1759896869,
      "status": "enabled",
      "owned_by": "greennode",
      "model_type": "ocr"
    },
    {
      "id": "openai/gpt-5",
      "object": "model",
      "created": 1746615221,
      "status": "enabled",
      "owned_by": "openai",
      "model_type": "messages"
    },
    {
      "id": "deepseek/deepseek-r1-qwen3-8b",
      "object": "model",
      "created": 1746615757,
      "status": "enabled",
      "owned_by": "deepseek",
      "model_type": "chat"
    },
    {
      "id": "qwen/qwen3-reranker-8b",
      "object": "model",
      "created": 1746616140,
      "status": "enabled",
      "owned_by": "qwen",
      "model_type": "rerank"
    },
    {
      "id": "gemini/gemini-2.5-flash-preview-tts",
      "object": "model",
      "created": 1749440762,
      "status": "enabled",
      "owned_by": "google",
      "model_type": "tts"
    },
    {
      "id": "qwen/qwen3-embedding-8b",
      "object": "model",
      "created": 1746616140,
      "status": "enabled",
      "owned_by": "qwen",
      "model_type": "embedding"
    },
    {
      "id": "qwen/qwen3-235b-a22b-thinking-2507",
      "object": "model",
      "created": 1746616140,
      "status": "enabled",
      "owned_by": "qwen",
      "model_type": "chat"
    },
    {
      "id": "qwen/qwen3-30b-a3b-thinking-2507",
      "object": "model",
      "created": 1746616140,
      "status": "enabled",
      "owned_by": "qwen",
      "model_type": "chat"
    },
    {
      "id": "openai/text-embedding-3-large",
      "object": "model",
      "created": 1746615221,
      "status": "enabled",
      "owned_by": "openai",
      "model_type": "embedding"
    },
    {
      "id": "gemini/gemini-2.5-flash-lite",
      "object": "model",
      "created": 1746614433,
      "status": "enabled",
      "owned_by": "google",
      "model_type": "generateContent"
    },
    {
      "id": "openai/gpt-oss-20b",
      "object": "model",
      "created": 1746183221,
      "status": "enabled",
      "owned_by": "openai",
      "model_type": "chat"
    },
    {
      "id": "openai/gpt-oss-120b",
      "object": "model",
      "created": 1746615221,
      "status": "enabled",
      "owned_by": "openai",
      "model_type": "chat"
    },
    {
      "id": "gemini/gemini-2.5-pro",
      "object": "model",
      "created": 1746614433,
      "status": "enabled",
      "owned_by": "google",
      "model_type": "messages"
    },
    {
      "id": "gemini/gemini-2.5-flash",
      "object": "model",
      "created": 1746614433,
      "status": "enabled",
      "owned_by": "google",
      "model_type": "generateContent"
    },
    {
      "id": "openai/gpt-image-1",
      "object": "model",
      "created": 1746615221,
      "status": "enabled",
      "owned_by": "openai",
      "model_type": "image"
    },
    {
      "id": "qwen/qwen3-coder-plus-2025-07-22",
      "object": "model",
      "created": 1753929011,
      "status": "enabled",
      "owned_by": "qwen",
      "model_type": "messages"
    },
    {
      "id": "qwen/qwen3-coder-plus",
      "object": "model",
      "created": 1746616140,
      "status": "enabled",
      "owned_by": "qwen",
      "model_type": "messages"
    },
    {
      "id": "greennode/greenmind-medium-14b-r1",
      "object": "model",
      "created": 1746616140,
      "status": "enabled",
      "owned_by": "greennode",
      "model_type": null
    },
    {
      "id": "openai/gpt-4o-mini",
      "object": "model",
      "created": 1746615221,
      "status": "enabled",
      "owned_by": "openai",
      "model_type": "chat"
    },
    {
      "id": "openai/gpt-4o",
      "object": "model",
      "created": 1746615221,
      "status": "enabled",
      "owned_by": "openai",
      "model_type": "chat"
    },
    {
      "id": "meta-llama/llama-4-maverick",
      "object": "model",
      "created": 1746616140,
      "status": "enabled",
      "owned_by": "meta",
      "model_type": "chat"
    },
    {
      "id": "z-ai/glm-5.1",
      "object": "model",
      "created": 1781254131,
      "status": "enabled",
      "owned_by": "z-ai",
      "model_type": "messages"
    }
  ]
}
```
