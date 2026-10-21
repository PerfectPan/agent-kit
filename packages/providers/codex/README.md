# Codex provider

Private implementation of Codex identity, discovery, hooks, installation, sessions, usage and ACP, bundled into `@rivus/agent-kit`. Each service has its own export; `facts.ts` owns configuration facts, `layout.ts` owns active and archived rollout paths, and `records/` shares parsing, usage and fork replay between the session and usage readers. Context imports use SPI entries. Tests run the hook, discovery, usage and session conformance suites; cross-agent detection and hook samples also run against the complete tables in testing.
