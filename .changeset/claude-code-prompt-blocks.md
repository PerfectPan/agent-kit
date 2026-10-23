---
"@rivus/agent-kit": patch
---

Prompts collected from agent sessions are trimmed, and a prompt that is only whitespace is no longer collected; this applies to every agent, both in `sessionPrompts` and in the summarize fast passes' `emptyPrompts`. `sessionPrompts` joins the text events of one user record with a blank line instead of taking the first non-empty one. In Claude Code transcripts, a host-added text block of a prompt record now carries `injected: true`, so `isPrompt` is false for that block, and session titles and `firstPrompt` of multi-block records are the joined, trimmed text. Consumers that cache prompts or titles recompute them.
