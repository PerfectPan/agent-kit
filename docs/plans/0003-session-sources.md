# Session sources: Pi, DeepSeek Harness and OpenCode

- Status: draft
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-01
- Paired Spec: [0003-session-sources](../specs/0003-session-sources.md)

## 1. Background and constraints

`SessionAdapter` was shaped for a JSONL file per session: `SourcePointer` is `{file, offset, length, line}`, discovery
reads both ends of a file, and `sessionAdapterConformance` counts non-blank lines. Pi fits that shape. DeepSeek
Harness compresses the JSONL stream into concatenated Zstandard frames, and OpenCode stores one row per message and
part in SQLite, so neither has a byte range that reads back as one record.

## 2. Decisions

### 2.1 Platform capabilities

`SessionPlatform` gains two optional capabilities, both already present on `Platform` or implemented by platform-node:

- `sqlite?: PlatformSqlite` — a read-only database open.
- `decompress?: (format: "zstd", bytes: Uint8Array) => Uint8Array` — implemented with `node:zlib`.

They stay optional so browser-like and in-memory platforms keep satisfying `SessionPlatform`. `guardIo` copies both to
its guarded view; without that copy a guarded read loses the capability and reports a decode failure.

### 2.2 Source pointers

`SourcePointer` keeps `{file, offset, length, line}` and gains:

- `codec?: "zstd"` — `offset` and `length` index the decoded stream.
- `sqlite?: {table, column, rowid}` — the original is one row; `offset`/`length` are unused.

`readOriginal` dispatches on those fields. SQL identifiers are validated against `[A-Za-z_][A-Za-z0-9_]*` before they
enter the query, and a missing capability is `ReadFailed`. The shell (`agent-trace`) injects the same resolver into its
`TraceStore`; its raw-range fallback stays for plain pointers.

### 2.3 Conformance fixtures

`ConformanceSession.recordKeys` names each input record as `${file}\0${line}`; when present the suite checks coverage
against those keys instead of reading lines. `SessionAdapterFixtures.oversized` is optional, because a database has no
two file ends to budget. `ConformanceSession.sessionId` lets several sessions share one database path.

### 2.4 Adapters

- **Pi** (`packages/providers/pi/src/sessions.ts`): JSONL v3 tree; `firstKeptEntryId` shadowing; message content
  blocks text/thinking/toolCall; usage mapped so cache counts are part of `inputTokens`.
- **DeepSeek Harness** (`packages/providers/dsh`): a structural Zstandard frame scanner reads complete frames from a
  head slice for discovery and all frames for a load; a plain `.jsonl` fallback; `compaction/summary` shadows
  `shadowedSeqs`; the `tool/call` events are bookkeeping because the assistant message already carries the call blocks.
- **OpenCode** (`packages/providers/opencode/src/sessions.ts`): `session`, `message` and `part` queries; source
  pointers name rows; `line` is a transcript-wide ordinal (session, then each message and its parts) so record keys
  stay unique across tables. Usage adds cache to input and reasoning to output, matching the existing usage decoder.

## 3. Execution plan

1. Extend `Platform`/`SessionPlatform`, `SourcePointer`, `readOriginal`, `guardIo`, and the testing fixtures.
2. Add Pi: records, translation, preview, summarize, adapter registration, conformance fixtures.
3. Add DeepSeek Harness: provider package, facts/identity, Zstandard scanner, translation, preview, fixtures, smoke
   seed.
4. Add OpenCode: records, SQL queries, translation, summarize, fixtures built in a temporary database, smoke seed.
5. Register providers in `identity.ts`/`sessions.ts`, update boundaries, `unsupported`, support matrices, adoption
   doc, size budgets and changesets.
6. Wire the shell: schema source fields, a `readOriginal` dependency in `TraceStore`, agent-trace fixtures and UI
   names/marks/colors.

## 4. Validation

| Gate | Evidence |
| --- | --- |
| Pi conformance | `packages/providers/pi`: 59 tests, memory and temp-directory platforms |
| DeepSeek Harness conformance | `packages/providers/dsh`: 33 tests, plain and real Zstandard frames |
| OpenCode conformance | `packages/providers/opencode`: 68 tests, temporary SQLite database with `recordKeys` |
| Source resolver | `packages/sessions/src/application/use-cases/read-original.test.ts` |
| Provider tables | `packages/agent-kit`: 88 tests; architecture suite: 385 cases |
| Package gates | `pnpm check:package` incl. size-limit, provider packing, smoke consumer |
| Real logs | one local DeepSeek Harness log (188 events) and one OpenCode session (1427 events) load |

## 5. Risks and rollback

- A compressed file is decoded whole for a single original; acceptable for the log sizes seen, revisit with a frame
  index if a session reaches hundreds of MB.
- A SQLite database is opened read-only per `load`/`readOriginal`; WAL readers see committed rows. A future cursor
  cache can reduce opens.
- Removing the capabilities or the new pointer fields is additive: revert the adapters and the optional fields without
  touching existing providers. Unknown generations stay loud, so a partial rollback cannot silently read a wrong file.
