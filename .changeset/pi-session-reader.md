---
"@rivus/agent-kit": minor
---

Read Pi sessions. The new `pi` session adapter lists and loads `<home>/sessions/<cwd>/<time>_<id>.jsonl` files: the v3 session header, message entries (user, assistant text, reasoning and tool calls, tool results), model and thinking-level changes, compaction entries whose `firstKeptEntryId` shadows the context they removed, branch summaries, and extension messages. Usage comes from each assistant message, and unknown format versions fail as `UnknownFormatGeneration` instead of being read as a guess. The adapter passes the shared session conformance suite.
