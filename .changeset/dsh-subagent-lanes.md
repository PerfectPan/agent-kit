---
"@rivus/agent-kit": patch
---

Attach local DeepSeek Harness `subagent/catalog` child sessions as transcript lanes (`subagents` capability), strip inherited turns from forked children, mark missing child logs as `unavailable` lanes (`Lane.unavailable`), and hide child sessions from top-level discovery (#322).
