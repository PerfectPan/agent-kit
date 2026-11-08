# Session sources beyond plain JSONL

- Status: draft
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-01
- Paired Plan: [0003-session-sources](../plans/0003-session-sources.md)

## Background

`@rivus/agent-kit` reads sessions through a `SessionAdapter`: discovery lists a head per session, `load` returns a
`Transcript`, and every event names its original record with a `SourcePointer`. Three built-in agents now need that
interface past the file-and-line model it was written for:

- **Pi** writes one JSONL file per session, like Claude Code and Codex.
- **DeepSeek Harness** writes concatenated Zstandard frames whose decoded stream is JSONL.
- **OpenCode** keeps sessions as SQLite rows in `opencode.db`.

Pi is an ordinary file adapter. The other two have no file bytes at a fixed offset that read back as one record, so the
source contract and the conformance fixtures have to grow.

## Goals

- List and load Pi, DeepSeek Harness and OpenCode sessions through the existing `SessionAdapter` services.
- Return each event's original record: the decoded JSON line for a compressed log, the stored JSON for a database row.
- Keep discovery within its file-read budget for file-backed sources.
- Fail unknown format generations instead of guessing.
- Pass `sessionAdapterConformance` for every adapter, including the new source shapes.

## Non-goals

- Live following of a running session.
- Subagent lanes for DeepSeek Harness or OpenCode sessions (each session is listed on its own).
- Reading OpenCode's legacy `storage/message` layout for transcripts; the usage decoder keeps that fallback.
- Writing, migrating or repairing an agent's storage.

## Behavior

### S1: listing

- Given a Pi home, listing walks `<home>/sessions/<cwd>/<file>.jsonl`, depth two.
- Given a DeepSeek Harness home, listing walks `<home>/sessions/<cwd>/<session-id>/session.vN.jsonl[.zstd]`, depth
  three, and reads only the frames in each file's first 64 KB.
- Given an OpenCode home, listing reads the `session` rows of `opencode.db`.
- A root that does not exist is reported as `RootMissing`; listing continues with the other agents.

### S2: Pi transcript

`load` reads the v3 JSONL tree in file order. Message entries become `user`, `assistant`, `reasoning`, `tool_call` and
`tool_result` events; `compaction` entries emit a `compaction` event and shadow the events before `firstKeptEntryId`;
`model_change` and `thinking_level_change` become `system` events; `session_info` supplies the title; `label` and
`custom` are skipped with a reason. A version other than 3 is `UnknownFormatGeneration`.

### S3: DeepSeek Harness transcript

`load` decodes every complete Zstandard frame (and reads a plain `.jsonl` directly). `system/message`,
`user/message`, `assistant/message`, `tool/result`, `request/header`, `session/title`, `compaction/summary` and the
replacement `user/message` map to transcript events; harness bookkeeping (turn/step boundaries, plugin events) is
skipped with its type as the reason. `compaction/summary` shadows the seqs named by `shadowedSeqs`. A version other
than 4 is `UnknownFormatGeneration`.

### S4: OpenCode transcript

`load` reads one session's `session`, `message` and `part` rows. User text parts become `user` events; an assistant
message becomes a `request` with its token usage followed by `assistant`, `reasoning`, `tool_call` and `tool_result`
events from its parts; `step-*`, `patch` and unknown parts are skipped with a reason. A session without its id, or a
database without SQLite on the platform, fails with `ReadFailed`; a missing session row is `SessionNotFound`.

### S5: originals

`readOriginal(platform, source)` returns the record at the pointer:

- a plain file range;
- for `codec: "zstd"`, the whole file is decoded and the range is taken from the decoded bytes;
- for `sqlite`, the named table/column row is read by `rowid` after validating both identifiers.

When the platform lacks the needed capability the result is a `ReadFailed`, never a guess.

### S6: capabilities

An adapter lists only the capabilities its format can record, and a transcript lists the subset its own records show.
The conformance suite checks both directions.

### S7: conformance

Every adapter passes `sessionAdapterConformance`. A fixture may name its records as `${file}\0${line}` keys when the
source has no lines (`recordKeys`), and may omit the file-ended `oversized` fixture when the source has no file ends.

## Acceptance

- The conformance suite passes for `pi`, `dsh` and `opencode` on a memory platform and/or a temporary directory.
- `readOriginal` returns the stored JSON for a Zstandard pointer and a SQLite pointer, and refuses an unavailable
  platform capability.
- A real DeepSeek Harness log and a real OpenCode database load into a transcript with paired tool calls and results.
