---
"@rivus/agent-kit": minor
---

Session sources beyond plain files. `SourcePointer` gains an optional `codec: "zstd"` (offsets index the decoded stream) and an optional `sqlite: { table, column, rowid }`; `readOriginal` resolves both, validating the SQL identifiers and reporting a missing platform capability as `ReadFailed`. `SessionPlatform` and `Platform` gain optional `sqlite` and `decompress` capabilities, and platform-node implements `zstd` with `node:zlib`, refusing any other compression format with an exhaustive check. The guarded platform used by IO failure handling now keeps both capabilities. The session conformance fixtures accept `recordKeys` for sources with no lines and an optional `oversized` fixture for sources with no file ends, and the shell's `/sessions` entry re-exports the `ReadOriginalError` type.
