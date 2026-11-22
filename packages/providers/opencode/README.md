# OpenCode provider

Private implementation of OpenCode identity, discovery, hooks, installation, sessions, usage and ACP, bundled into
`@rivus/agent-kit`. Each service has its own export; there is no aggregate entry.

`facts.ts` owns agent facts and `layout.ts` shares data paths between discovery, sessions and usage. `usage.ts` reads
the SQLite database through the injected Platform port and falls back to legacy message files when no database exists;
`sessions.ts` reads `session`, `message` and `part` rows through the same port, with each event pointing at the row it
came from. Tests run the discovery, hook and usage conformance suites with synthetic fixtures, and the session
conformance suite against a temporary SQLite database.

Sessions expose request durations from valid `time.created`/`time.completed` pairs, including zero durations.
User `compaction` parts record automatic or manual triggers from `auto`; token counts are exposed only when the
stored part provides them. Transcripts declare only capabilities actually observed in their records.

When `session.parent_id` is present, live descendants become nested lanes with the session title as the lane's
`title`. Discovery hides a child only when its parent exists; orphaned sessions remain discoverable. A visited set
stops parent cycles. Transcripts with child lanes merge events chronologically, while a standalone session retains
its stored message order. Summaries include every lane's requests, tokens, durations, compactions and failed tools,
but count turns and collect prompt previews only on the main lane. The summary reader fetches one message at a time.
