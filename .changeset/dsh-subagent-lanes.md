---
"@rivus/agent-kit": patch
---

Attach local DeepSeek Harness `subagent/catalog` child sessions as transcript lanes (`subagents` capability), strip inherited turns from forked children using the `session/end-seed` boundary, ignore inherited catalog entries on standalone forks, mark missing or unreadable child logs as `unavailable` lanes (`Lane.unavailable`), and hide `origin: "subagent"` child sessions from top-level discovery (#322).
