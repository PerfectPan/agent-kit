---
"@rivus/agent-kit": minor
---

Read DeepSeek Harness sessions. The new `dsh` adapter lists and loads `<home>/sessions/<encoded cwd>/<id>/session.v4.jsonl.zstd`, decoding the concatenated Zstandard frames the harness writes (and plain `session.v4.jsonl` when compression is off): the v4 header, system and developer messages, user prompts and injected context, assistant text, reasoning and tool calls, tool results, request headers with their tool schemas, and compaction summaries that shadow the seqs they replaced. Discovery reads only the frames in a file's first 64 KB, and a plain log's tail supplies its last activity. Unknown format generations fail as `UnknownFormatGeneration`, and the adapter passes the shared session conformance suite.

Reading compressed dsh logs requires Node with Zstandard support (22.15+ on the Node 22 line, or 23.8+). The Node platform remains importable on older supported runtimes, where `decompress` is absent and compressed reads return `ReadFailed`. Complete frames and their original record pointers remain readable with an incomplete final frame or, subject to the runtime limit below, a non-frame suffix; checksum failures still reject corrupted frames.

On Node 23.10.0, 24.14.1 and 24.18.0, a non-frame suffix can make original-record reads return `ReadFailed` when the last complete frame decodes to a positive multiple of 16384 bytes. In that case zlib tries to decode the suffix in the same call, before the adapter can ignore it.
