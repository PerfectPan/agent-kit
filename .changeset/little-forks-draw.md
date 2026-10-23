---
"@rivus/agent-kit": patch
---

Codex transcripts keep event ids unique when a response item's id equals a request's id: the request event renames to the first free request:<key>:<n> instead of repeating the item's id.
