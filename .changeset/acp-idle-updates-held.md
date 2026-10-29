---
"@rivus/agent-kit": patch
---

On the live ACP path, an update that arrives while no turn runs is no longer dropped: it is held with the session and the next turn opens with it, so a background call's result that lands after its turn ended reaches a turn's parts and the transcript's `tool_result` instead of being lost. A load's replay, which arrives while the load is in flight, is dropped as today, and folding the session's parts in order still gives its `event` parts.
