---
"@rivus/agent-kit": minor
---

Add `@rivus/agent-kit/cost/prices`: `litellmPrices`, a snapshot of LiteLLM's prices for the chat models the supported agents record (Anthropic, OpenAI, Google Gemini, xAI, DeepSeek, Z.ai, Moonshot and MiniMax, keyed by the bare model name), ready for `createPricing`, and `litellmPricesVersion`, the date and LiteLLM commit it was generated from, for a host to record which table priced its data. The entry imports nothing, and `/cost` does not load it. A weekly job refreshes the snapshot in patch releases.
