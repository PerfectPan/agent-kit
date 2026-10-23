---
"@rivus/agent-kit": patch
---

On the live ACP path, a tool call updated after its turn ended no longer appears twice: a session keeps one stream folder across its turns, so a call yields one `tool_call` however many turns it outlives. Each turn's deltas stay self-contained — a turn carrying an update for an open call it has not yet mentioned repeats the call's start and input first, and a turn's `finish` re-sends the open calls no earlier finish has closed — so folding one turn's deltas alone repeats the `tool_call` of a call that outlived it, with the input it had when it was emitted. An update for a call whose result is out emits nothing, and a failed turn closes its open text and reasoning as its own events while a call left open stays open for the next finish. A call's input and output are dropped once its result is emitted.
