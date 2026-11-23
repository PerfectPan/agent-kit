---
"@rivus/agent-kit": minor
---

Add `subagents` to Antigravity CLI sessions: an `invoke_subagent` result names the conversation it created, whose own transcript under `brain/` loads as a lane after the root lane (`parentId`, `spawnEventId`, `title` from the call's `Role`; missing transcripts are `unavailable` lanes), `discover` lists no spawned conversation as a session, and `summarize` folds the lanes in the load order.
