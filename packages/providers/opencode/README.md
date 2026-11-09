# OpenCode provider

Private implementation of OpenCode identity, discovery, hooks, installation, sessions, usage and ACP, bundled into
`@rivus/agent-kit`. Each service has its own export; there is no aggregate entry.

`facts.ts` owns agent facts and `layout.ts` shares data paths between discovery, sessions and usage. `usage.ts` reads
the SQLite database through the injected Platform port and falls back to legacy message files when no database exists;
`sessions.ts` reads `session`, `message` and `part` rows through the same port, with each event pointing at the row it
came from. Tests run the discovery, hook and usage conformance suites with synthetic fixtures, and the session
conformance suite against a temporary SQLite database.
