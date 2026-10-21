# OpenCode provider

Private implementation of OpenCode identity, discovery, hooks, installation, usage and ACP, bundled into
`@rivus/agent-kit`. Each service has its own export; there is no aggregate entry.

`facts.ts` owns agent facts and `layout.ts` shares data paths between discovery and usage. `usage.ts` reads the
SQLite database through the injected Platform port and falls back to legacy message files when no database exists.
It has no session adapter. Tests run the discovery, hook and usage conformance suites with synthetic fixtures.
