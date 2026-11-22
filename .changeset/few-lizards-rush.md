---
"@rivus/agent-kit": minor
---

Read recorded SQLite session durations, deduplicated compactions and token counts, and nested subagent lanes for OpenCode and ZCode, with matching session summaries.

Keep ZCode manual forks standalone, count only completed compactions, and recognize reactive overflow recovery as
automatic compaction. Lane merging preserves stored event order and tool pairing even when clocks move backwards.
Rootless parent cycles retain a discoverable entry, and summary prompt collection respects its bounds while reading.

`SESSION_SUMMARY_VERSION` is now 4, so consumers must recompute cached summaries. Conformance fixtures may declare
`compactionShadowing: false` for sources whose compaction boundaries do not identify replaced events; any emitted
shadow links are still checked.
