---
"@rivus/agent-kit": patch
---

Codex transcripts keep event ids unique when a response item's id equals another event's id: the request event renames to the first free request:<key>:<n>, and an event whose id or line key an item took renames to the first free L<line>:<n>.
