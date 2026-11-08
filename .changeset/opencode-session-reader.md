---
"@rivus/agent-kit": minor
---

Read OpenCode sessions from `opencode.db`. The new `opencode` session adapter lists `session` rows and loads one from its `message` and `part` rows: user text, assistant requests with per-message token usage, assistant text, reasoning, tool calls and their results, and the session's title, cwd, times and OpenCode version. Each event carries a source pointer at its SQLite row, so `readOriginal` reads the stored JSON back through `platform.sqlite`; the adapter fails with `ReadFailed` when SQLite is unavailable rather than returning a partial transcript. A part whose message row is missing is counted as skipped instead of silently dropped, and the summary streams the session one message at a time instead of loading the whole transcript. It passes the shared session conformance suite against a temporary database. Legacy `storage/message` files remain usage-only.
