---
"@rivus/agent-kit": patch
---

Unknown data is parsed only at the boundary, and the shape checks that remain carry their reason. The hand-written reads move into the schemas of their boundary: Claude Code's record version, codex's spawn result and tool-output exit code, the lease repository's SQLite row, the ledger repository's stored revision, and the transcript services' prompt and duration reads. A `Record`'s fields reach the domain services through one shared schema instead of `typeof` chains.
