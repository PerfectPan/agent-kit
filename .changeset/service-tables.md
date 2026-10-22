---
"@rivus/agent-kit": minor
"@rivus/agent-kit-collab": minor
---

Add `Provider` and `builtinProviders` through `/providers`. Routed APIs now accept provider descriptors merged by agent id and service; this replaces the `adapters`, `dialects`, `recipes` and `profiles` override options. Provider interfaces are available through scoped SPI entries.

Provider identities with conflicting names or mismatched ids are rejected. Remove `resolveHome` and `CodingAgentIdWithHome`; resolve a session or usage service's home with `sessionAdapterHome`. Hook host detection reads dialect marker declarations, and the `/testing` conformance suites that read service tables bind the built-in ones.
