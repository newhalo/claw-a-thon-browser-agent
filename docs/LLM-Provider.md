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