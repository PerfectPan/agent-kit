---
"@rivus/agent-kit": patch
---

Prompts collected from Claude Code sessions judge each text block of a user record on its own: host-added blocks (task notifications, system reminders, interruptions, IDE context, fork boilerplate) no longer replace or hide the user's own text in a later block. A record's prompt text is its own blocks, trimmed and joined with a blank line, so whitespace-only records stay turns but collect no prompt, and leading whitespace no longer counts against `maxChars`. Consumers that cached collected prompts recompute them.
