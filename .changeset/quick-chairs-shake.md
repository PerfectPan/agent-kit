---
"@rivus/agent-kit": patch
---

On the live ACP path, a tool call updated after its turn ended no longer appears twice: a session keeps one stream folder across its turns, so a call yields one `tool_call` however many turns it outlives. Each turn's deltas stay self-contained — a turn carrying an update for a call it has not yet mentioned repeats the call's start and input first — so folding one turn's deltas alone repeats the `tool_call` of a call that outlived it, with its full input, while the session's `event` parts hold one call and one result. A call's input and output are dropped once its result is emitted.
