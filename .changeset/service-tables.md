---
"@rivus/agent-kit": minor
"@rivus/agent-kit-collab": minor
---

Add `Provider` and `builtinProviders` through `/providers`. Routed APIs now accept provider descriptors merged by agent id and service; this replaces the `adapters`, `dialects`, `recipes` and `profiles` override options. Context use cases require explicit service tables, and provider interfaces are available through scoped SPI entries.

Identity parsing takes an identity table and rejects conflicting names or mismatched ids. Remove `resolveHome` and `CodingAgentIdWithHome`; use `homeFromRule` with an explicit home rule. Hook host detection reads dialect marker declarations, and context conformance suites take their service tables while `/testing` binds the built-ins.
