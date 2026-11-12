---
"@rivus/agent-kit": minor
---

The built-in zcode provider now reads the CLI's SQLite store as sessions: `sessions` discovers the non-deleted sessions of `<home>/cli/db/db.sqlite`, translates message and part rows into the transcript's user prompts, replies, thinking, tool calls and results, and summarizes a session in one bounded pass. Every event's source resolves through `readOriginal`, the shell's sessions table registers the adapter, and ZCode's "no supported reader" entries leave the support tables.
