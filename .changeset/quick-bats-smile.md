---
"@rivus/agent-kit": minor
---

AcpSessionHandle takes detach, which forgets an open session on the connection without sending session/close, so the next loadSession re-sends session/load with the MCP servers of that call.
