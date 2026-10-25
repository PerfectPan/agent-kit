---
"@rivus/agent-kit": minor
---

Price only the models a table names in `createPricing` (`/cost`): a table key prices its own id, that id followed by a date (`-20250929`, `-2025-08-07`, `@20250929`), and either after a `<provider>/` prefix, regardless of case. An id the table lacks no longer takes the price of another model whose key it contains (`gpt-5.7` was priced as `gpt-5`, `o1-mini` as `o1`, `gpt-5.4-chat-latest` as `chat-latest`); it has no price. Family aliases such as `opus` go in `fallback`, which still prices an id that no table key matches by the longest alias it contains. `overrides` keep matching by substring, since the caller writes them: an id takes the longest override key it contains, over the table and the fallback. A partial override now takes the prices it lacks from the id's own price rather than from its key's entry, so `{ "gpt-4o": { input: 1 } }` keeps `gpt-4o-2024-05-13`'s output price and `{ opus: { input: 99 } }` keeps `claude-opus-4-8`'s.
