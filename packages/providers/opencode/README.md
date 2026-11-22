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

OpenCode persists no system prompt, tool schemas or hook runs, so `systemPrompt`, `toolSchemas` and `hooks` stay out
of every transcript. Stored message rows carry only `user` and `assistant` roles, and the persisted part types
(upstream `packages/schema/src/session-message.ts`) have a `system` part that is a model-facing update text frozen at
emit time, not the conversation's opening prompt; instruction files live beside the sessions, not inside them. A tool
part stores its call's `input` and `output`, never the tool's schema. Hook runs are configuration-driven lifecycle
events that upstream fires while a session runs; neither the persisted schema nor the local databases record them —
their event table stays empty.

When `session.parent_id` is present, live descendants become nested lanes with the session title as the lane's
`title`. Discovery hides a child only when its parent exists; orphaned sessions remain discoverable. A rootless
parent cycle remains discoverable through its lexicographically smallest member, and traversal visits each session
once. Lane merging preserves each lane's stored order and compares running maximum timestamps, breaking ties by
lane order without rewriting event timestamps. Summaries include every lane's requests, tokens, durations,
compactions and failed tools, but count turns and collect prompt previews only on the main lane. The summary reader
fetches one message at a time and copies at most the requested number of prompt previews, each capped immediately.
