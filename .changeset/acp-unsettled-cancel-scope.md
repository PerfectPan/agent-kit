---
"@rivus/agent-kit": minor
---

`connectAgent` takes an optional `unsettledCancel` that chooses what a cancel which does not settle within `cancelTimeoutMs` invalidates. The default `"connection"` is today's behavior: the session closes, its bindings go, and the connection with its process ends, failing its other sessions with `ConnectionClosed`. With `"session"`, the process and the other sessions keep running: the cancelled session closes — with `session/close` when the agent supports it — its bindings go, later updates for it are ignored, and its later calls fail as on a closed session.
