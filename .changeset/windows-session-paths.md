---
"@rivus/agent-kit": minor
---

On Windows, session paths use `/` throughout: `loadTranscript` and `summarizeSession` read a target path typed with `\` as the same session, so its Claude Code subagents, Codex rollout name and Grok session directory are found, and `listSessions` and `sessionAdapterHome` hand out homes, roots and session refs with `/`. `SessionPlatform` takes an optional `os`, which a Node platform already has; `sessionAdapterHome` reads it from its context. Usage records keep their path spelling, so usage ids do not change.
