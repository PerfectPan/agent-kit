---
"@rivus/agent-kit": patch
---

Event ids stay unique in translated Grok and Claude Code transcripts. A Grok `turn_completed` whose `request:<prompt_id>` another request already holds moves to the first free serial of `request:<line>`, where the fallback id went unchecked before; a Claude Code request whose `request:<requestId>` a record uuid holds takes the first free serial of the key, and a record uuid a request event holds moves to the first free serial of its line id. Sessions without a collision keep the ids they had.
