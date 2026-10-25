---
"@rivus/agent-kit": minor
---

Price only the models a table names in `createPricing` (`/cost`): a table or override key prices its own id, that id followed by a date (`-20250929`, `-2025-08-07`, `@20250929`), and either after a `<provider>/` prefix, regardless of case. An id the table lacks no longer takes the price of another model whose key it contains (`gpt-5.7` was priced as `gpt-5`, `o1-mini` as `o1`, `gpt-5.4-chat-latest` as `chat-latest`); it has no price. Family aliases such as `opus` go in `fallback`, which still prices an id that no override or table key matches by the longest alias it contains.
