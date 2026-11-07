---
"@rivus/agent-kit": minor
---

connectAgent takes killGraceMs, the time an aborted agent process may take to exit after SIGTERM before SIGKILL (2 s by default), and platform.spawn takes it for its own children.
