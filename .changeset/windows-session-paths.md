---
"@rivus/agent-kit": minor
---

On Windows, session paths use `/`: `loadTranscript` and `summarizeSession` read a target path typed with `\` as the same session, so its Claude Code subagents, Codex rollout name and Grok session directory are found, and `listSessions` lists session refs with `/` only. `SessionPlatform` takes an optional `os`, which a Node platform already has. The home `sessionAdapterHome` returns and the paths of usage records keep their spelling, so usage ids do not change.
