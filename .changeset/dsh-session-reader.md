---
"@rivus/agent-kit": minor
---

Read DeepSeek Harness sessions. The new `dsh` adapter lists and loads `<home>/sessions/<encoded cwd>/<id>/session.v4.jsonl.zstd`, decoding the concatenated Zstandard frames the harness writes (and plain `session.v4.jsonl` when compression is off): the v4 header, system and developer messages, user prompts and injected context, assistant text, reasoning and tool calls, tool results, request headers with their tool schemas, and compaction summaries that shadow the seqs they replaced. Discovery reads only the frames in a file's first 64 KB, and a plain log's tail supplies its last activity. Unknown format generations fail as `UnknownFormatGeneration`, and the adapter passes the shared session conformance suite.
