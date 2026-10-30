---
"@rivus/agent-kit": minor
---

`connectAgent` takes an optional `onStderr` callback that receives the agent's stderr as decoded text arrives, in order, with a multi-byte character split across chunks reassembled, so a host can log a running agent. The callback may return a promise; neither it nor the reading awaits it, and one that throws or rejects does not affect the connection. The stderr tail already attached to errors stays.
