---
"@rivus/agent-kit": minor
---

Read recorded SQLite session durations, deduplicated compactions and token counts, and nested subagent lanes for OpenCode and ZCode, with matching session summaries.

`SESSION_SUMMARY_VERSION` is now 4, so consumers must recompute cached summaries. Conformance fixtures may declare
`compactionShadowing: false` for sources whose compaction boundaries do not identify replaced events; any emitted
shadow links are still checked.
