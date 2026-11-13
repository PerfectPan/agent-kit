# Change Log - @rivus/agent-kit

## 0.25.0

### Minor Changes

- [#292](https://github.com/PerfectPan/agent-kit/pull/292) [`0c7614f`](https://github.com/PerfectPan/agent-kit/commit/0c7614f4c9a7b2cd6768644d40bc8a9fc8560583) Thanks [@nyx-cell](https://github.com/nyx-cell)! - Show one Grok request per model call. The adapter joins the `loop_started`/`first_token` boundaries and the completed tool call ids in `events.jsonl` with the `assistant` entries in `chat_history.jsonl`, so a turn that made several model calls places one request per call, before the call's first output and with the model the assistant entry named. Grok records usage per turn, so no call is split by estimate: the turn's last call carries the turn's aggregate usage (`granularity: "turn"`, with the turn's model, `modelCalls` and per-model split), and the aggregate is not counted as a request of its own. The summary pass reads the same join, so its `requests` match the loaded transcript. A session without the join files, or one past the 32 MB join budget, keeps its turn-level request. Grok summaries now count `requests` per model call instead of per turn, so `SESSION_SUMMARY_VERSION` is 3 and cached summaries must be recomputed.

- [#293](https://github.com/PerfectPan/agent-kit/pull/293) [`1cd79c0`](https://github.com/PerfectPan/agent-kit/commit/1cd79c06dbe3615fd41f9945cbf10823a94335be) Thanks [@nyx-cell](https://github.com/nyx-cell)! - The built-in zcode provider now reads the CLI's SQLite store as sessions: `sessions` discovers the non-deleted sessions of `<home>/cli/db/db.sqlite`, translates message and part rows into the transcript's user prompts, replies, thinking, tool calls and results, and summarizes a session in one bounded pass. Every event's source resolves through `readOriginal`, the shell's sessions table registers the adapter, and ZCode's "no supported reader" entries leave the support tables.

### Patch Changes

- [#281](https://github.com/PerfectPan/agent-kit/pull/281) [`e1af559`](https://github.com/PerfectPan/agent-kit/commit/e1af559485781ac25ba1d9abcdc6d19d3fe48f76) Thanks [@github-actions](https://github.com/apps/github-actions)! - Update the LiteLLM price snapshot of `/cost/prices` to `2026-11-12+db8ad3b13e7320bf835205cae58be5a58e0ff366+bcbf284275fd`.

## 0.24.1

### Patch Changes

- Detect Claude sessions from one complete Claude record so Gemini JSONL and legacy JSON chats load through their own reader, including when session readers are extended.

## 0.24.0

### Minor Changes

- `connectAgent` takes an optional `onStderr` callback that receives the agent's stderr as decoded text arrives, in order, with a multi-byte character split across chunks reassembled, so a host can log a running agent. The callback may return a promise; neither it nor the reading awaits it, and one that throws or rejects does not affect the connection. The stderr tail already attached to errors stays.

- `connectAgent` takes an optional `unsettledCancel` that chooses what a cancel which does not settle within `cancelTimeoutMs` invalidates. The default `"connection"` is today's behavior: the session closes, its bindings go, and the connection with its process ends, failing its other sessions with `ConnectionClosed`. With `"session"`, the process and the other sessions keep running: the cancelled session closes — with `session/close` when the agent supports it — its bindings go, later updates for it are ignored, and its later calls fail as on a closed session.

- The connectAgent permission callback may answer { outcome: "cancelled" }, which the agent receives as the cancelled outcome instead of a denial.

- `doctor` now counts bridge files: the opencode and Pi adapters declare the directories of plugins and extensions their agents load without a configuration entry, and every loaded file carrying one of the caller's markers is one registration of its owner for each event the bridge forwards. A second bridge of one owner — an older release's, or a copy under another name — is reported as a `duplicate-hook`, alongside the settings-file duplicates `doctor` already found. Install adapters can declare the same for their own agents with the new `bridgeSources`.

- Detect DeepSeek Harness and launch it over ACP. `detectAgents` finds the `dsh` command and its version, follows `DSH_HOME` (default `~/.dsh`), and counts a stored `.credentials.yaml` or `DEEPSEEK_API_KEY` as a login without reading the file's values; `/acp` launches `dsh --profile acp`, which needs no authentication and takes the system prompt in the first prompt block.

  The launch profile preserves `DSH_PERMISSION_MODE` and `DSH_BUNDLED_SKILL_DIR`, and excludes internal subprocess markers and generated speech-worker tokens. Custom pi-ai `apiKeyEnv` keys need explicit forwarding only when they are available solely in the caller’s environment.

- Read DeepSeek Harness sessions. The new `dsh` adapter lists and loads `<home>/sessions/<encoded cwd>/<id>/session.v4.jsonl.zstd`, decoding the concatenated Zstandard frames the harness writes (and plain `session.v4.jsonl` when compression is off): the v4 header, system and developer messages, user prompts and injected context, assistant text, reasoning and tool calls, tool results, request headers with their tool schemas, and compaction summaries that shadow the seqs they replaced. Discovery reads only the frames in a file's first 64 KB, and a plain log's tail supplies its last activity. Unknown format generations fail as `UnknownFormatGeneration`, and the adapter passes the shared session conformance suite.

  Discovery caps the decoded bytes of a compressed head at the plain-file preview budget, and a compressed session whose first frame spans past the 64 KB head cap — or whose head decodes past the cap — still lists with its file mtime as the last activity instead of failing, and detection recognizes it. A host without a decoder is told apart from undecodable bytes. Event types outside the bookkeeping set become `unknown` events instead of being skipped, and after a format migration discovery lists only the newest generation per session directory, the same selection the usage decoder makes.

  Reading compressed dsh logs requires Node with Zstandard support (22.15+ on the Node 22 line, or 23.8+). The Node platform remains importable on older supported runtimes, where `decompress` is absent and compressed reads return `ReadFailed`. Complete frames and their original record pointers remain readable with an incomplete final frame or, subject to the runtime limit below, a non-frame suffix; checksum failures still reject corrupted frames.

  On Node 23.10.0, 24.14.1 and 24.18.0, a non-frame suffix can make original-record reads return `ReadFailed` when the last complete frame decodes to a positive multiple of 16384 bytes. In that case zlib tries to decode the suffix in the same call, before the adapter can ignore it.

- Read DeepSeek Harness token usage. The new `dsh` usage decoder turns each `assistant/message` with usage and each `compaction/summary` carrying its summarization call's usage of `<home>/sessions/<encoded cwd>/<id>/session.v4.jsonl[.zstd]` into a `request` usage record, adding the cache-read and cache-write tokens the harness keeps out of `inputTokens` back into the input; sessions reading `dsh` get the same corrected count, and a compaction summary's call counts in the sessions totals too. A seeded session's inherited events are the parent's copies, already counted in its file, so the leading run of events whose time precedes the fork's `createdAt` is skipped — which also covers a fork of a fork, whose inherited prefix carries the parent's own inherited marker in the middle and ends with its own; the model falls back to the most recent `request/header`. Sources are keyed by the `<id>` directory name plus the file name, unique because dsh refuses the same id in several project directories, and only the newest format generation counts when a migration leaves the old file. Compressed logs resume after the last complete frame without replaying records, with the same source pointers as the sessions reader, report `SourceChanged` when the file was rewritten, `UnknownFormatGeneration` for a header of another generation, `ReadFailed` without a host decoder, and pass the shared usage conformance suite on plain and compressed fixtures.

- An install adapter's legacySources may scope legacy markers to one source, so a marker an old configuration reference needs does not match another source's finds, and a legacy removal of an untracked file captures its pre-image, which the apply report carries for recovery.

- Require the exact optional Effect peer 4.0.6. Hosts pinning effect 4.0.5 fail to install under npm; update the host to 4.0.6 alongside these packages.

- Require the exact optional Effect peer 4.1.1. Hosts pinning effect 4.0.6 fail to install under npm; update the host to 4.1.1 alongside these packages.

- acquireProcessLock takes removeOnRelease, which removes the lock file when the lock is released; the acquisition verifies the file it locked against a pre-open reading of device, inode and birth time, so the removal cannot break mutual exclusion. FileStat carries the file identity.

- A running tool call's output so far streams as tool-output-partial parts between tool-input-available and the final tool-output-available, so a host can show the progress of a running tool.

- The ledger records the directories an install positively created within the installation roots (schema 2, migrated from schema 1 with provenance unknown), and an uninstall removes a claimed directory once it is empty and its last owner leaves, never a pre-existing, unknown, nonempty, symlinked or externally managed one. The ledger schema moves from 1 to 2: once this version saves a ledger, older kit versions reject it as an unsupported version, and uninstalling with this version does not restore that compatibility.

- Detect ZCode, read its usage from its sessions database, and read its command hooks: `readHookEvent` maps ZCode's `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure` and `Stop` payloads to lifecycle events, and attributes a payload carrying ZCode's `traceId` to ZCode even when the hook was registered for another agent.

  Install ZCode hooks as owner-specific plugins, register their absolute paths in the fixed user config, and install skills in the shared directory. Preserve existing plugin enablement and unrelated registrations; write hook timeouts as positive integer milliseconds with `timeoutMs`. Enabled plugins can also activate existing user hook events that are not explicitly disabled.

  Keep JSON valid when uninstalling the last element of a single-line configuration array, preserving unrelated entries and trailing comments. Multiline arrays keep the parser's existing deletion and formatting behavior.

- Read OpenCode sessions from `opencode.db`. The new `opencode` session adapter lists `session` rows and loads one from its `message` and `part` rows: user text, assistant requests with per-message token usage, assistant text, reasoning, tool calls and their results, and the session's title, cwd, times and OpenCode version. Each event carries a source pointer at its SQLite row, so `readOriginal` reads the stored JSON back through `platform.sqlite`; the adapter fails with `ReadFailed` when SQLite is unavailable rather than returning a partial transcript. A part whose message row is missing is counted as skipped instead of silently dropped, and the summary streams the session one message at a time instead of loading the whole transcript. It passes the shared session conformance suite against a temporary database. Legacy `storage/message` files remain usage-only.

- Read Pi sessions. The new `pi` session adapter lists and loads `<home>/sessions/<cwd>/<time>_<id>.jsonl` files: the v3 session header, message entries (user, assistant text, reasoning and tool calls, tool results), model and thinking-level changes, compaction entries whose `firstKeptEntryId` shadows the context they removed, branch summaries, and extension messages. Usage comes from each assistant message, and unknown format versions fail as `UnknownFormatGeneration` instead of being read as a guess. The adapter passes the shared session conformance suite.

- AcpSessionHandle takes detach, which forgets an open session on the connection without sending session/close, so the next loadSession re-sends session/load with the MCP servers of that call.

- Session sources beyond plain files. `SourcePointer` gains an optional `codec: "zstd"` (offsets index the decoded stream) and an optional `sqlite: { table, column, rowid }`; `readOriginal` resolves both, validating the SQL identifiers and reporting a missing platform capability as `ReadFailed`. `SessionPlatform` and `Platform` gain optional `sqlite` and `decompress` capabilities, and platform-node implements `zstd` with `node:zlib`, refusing any other compression format with an exhaustive check. The guarded platform used by IO failure handling now keeps both capabilities. The session conformance fixtures accept `recordKeys` for sources with no lines and an optional `oversized` fixture for sources with no file ends, and the shell's `/sessions` entry re-exports the `ReadOriginalError` type.

- connectAgent takes killGraceMs, the time an aborted agent process may take to exit after SIGTERM before SIGKILL (2 s by default), and platform.spawn takes it for its own children.

- The incremental SQLite message reading moves into the sessions SPI as shared helpers — the settlement of a decode (the first pass by row id, then the pages by newest change, the final look at running messages), the `message`-table queries, the paging batches and the WAL-aware change detection — which the opencode and ZCode usage decoders both use, keeping each agent's row decoding in its provider. New exports: `createSqliteSettlement`, `decodeSqliteMessages`, `sqliteMessageSource`, `sqliteQueryFloor`, `SqliteMessageRow`, `SqliteTableRow`, `SqliteSettlement`, `SqliteSettlementState`, `SqliteMessagesRequest`, `SqliteMessageDecode`, `SQLITE_LONGEST_MESSAGE_MS`, `SQLITE_RUNNING_IDS`. The records and cursor state are unchanged.

### Patch Changes

- A `first-block` system prompt now ends in a blank line, so agents that join adjacent text blocks — dsh-acp's prompt handler appends each block's text to one string — keep the boundary between the instructions and the first user text. Agents that keep blocks apart are unaffected.

- On the live ACP path, an update that arrives while no turn runs is no longer dropped: it is held with the session and the next turn opens with it, so a background call's result that lands after its turn ended reaches a turn's parts and the transcript's `tool_result` instead of being lost. A load's replay, which arrives while the load is in flight, is dropped as today, and folding the session's parts in order still gives its `event` parts.

- Update the LiteLLM price snapshot of `/cost/prices` to `2026-11-02+ff3983c1f627ad09a5e36e45cc92a0cec91afb72+12280faa8b67`.

- Unknown data is parsed only at the boundary, and the shape checks that remain carry their reason. The hand-written reads move into the schemas of their boundary: Claude Code's record version, codex's spawn result and tool-output exit code, the lease repository's SQLite row, the ledger repository's stored revision, and the transcript services' prompt and duration reads. A `Record`'s fields reach the domain services through one shared schema instead of `typeof` chains.

- A Codex usage record without a readable time no longer takes the file's mtime, so decoding a file again after it is rewritten or grows keeps every call's stamp and dedupe key. The leading run without a time holds its calls until the file's first known time stamps them, the way the transcript stamps that run, or until the file is final, which stamps them 1; the fork-replay rule reads a not-yet-known stamp exactly as the transcript's batch rule does, so an incremental decode of a time-less rollout equals one decode of the whole file and counts what the transcript counts.

- The conditional spreads with an empty-object branch — `...(x === undefined ? {} : { key: x })` and `...(x ? { key: x } : {})` — are replaced across the packages by one literal through catalog's `definedFields`, which drops the `undefined`-valued keys. Two behavior refinements come with it, both intended: a truthiness test no longer silently drops an empty string or zero (an empty session id or prompt text is now kept), and an object field the record carried explicitly as `undefined` reads back as absent. Sites whose condition was load-bearing — the ledger's absent `kept` and `directories` maps, a formatting-options flag, a TOML-removal guard — keep their condition.

- The catalog kernel gains `definedFields`, which drops an object's `undefined`-valued keys and types them optional without `undefined` while the keys that cannot be undefined stay required. Conditional spreads — `...(x === undefined ? {} : { key: x })` and `...(x ? { key: x } : {})` — can become one literal through it, so a key is never silently dropped and a `""` or `0` is not lost to a truthiness test. The authoring guide names it and the checks that enforce its shape-guard rules.

- Updated the shared lint toolchain dependency `@perfectpan/lint-config` to `v0.7.0`.

- The built-in gemini-cli provider now reads the CLI's chat recordings as sessions: `sessions` lists the chats under the home's `tmp/` project directories, translates a chat's records into the transcript's user prompts, replies, thinking, tool calls and results, compactions and notices, and prices each `gemini` message that carries `tokens` as one request. A legacy single-object `.json` chat loads when its `.jsonl` replacement does not exist, and the shell's sessions table registers the adapter, removing gemini-cli's "no supported reader" entry.

- Event ids stay unique in translated Grok and Claude Code transcripts. A Grok `turn_completed` whose `request:<prompt_id>` another request already holds moves to the first free serial of `request:<line>`, where the fallback id went unchecked before; a Claude Code request whose `request:<requestId>` a record uuid holds takes the first free serial of the key, and a record uuid a request event holds moves to the first free serial of its line id. Sessions without a collision keep the ids they had.

- Updated dependency `es-toolkit` to `^1.53.0`.

- Updated dependency `@agentclientprotocol/sdk` to `1.9.0`.
  Updated dependency `@decimalturn/toml-patch` to `^3.3.1`.

- Updated dependency `@decimalturn/toml-patch` to `^3.3.2`.
  Updated dependency `es-toolkit` to `^1.53.1`.

## 0.23.0

### Minor Changes

- Price long-context requests at LiteLLM's tier rates, and stop counting Claude Code's `<synthetic>` entries as usage records.

### Patch Changes

- Add a digest of the price table's content to `litellmPricesVersion` (`<date>+<commit>+<digest>`), so the version changes whenever the snapshot's prices change and hosts can tell when stored costs need recomputing.

## 0.22.0

### Minor Changes

- Price only the models a table names in `createPricing` (`/cost`): a table key prices its own id, that id followed by a date (`-20250929`, `-2025-08-07`, `@20250929`), and either after a `<provider>/` prefix, regardless of case. An id the table lacks no longer takes the price of another model whose key it contains (`gpt-5.7` was priced as `gpt-5`, `o1-mini` as `o1`, `gpt-5.4-chat-latest` as `chat-latest`); it has no price. Family aliases such as `opus` go in `fallback`, which still prices an id that no table key matches by the longest alias it contains. `overrides` keep matching by substring, since the caller writes them: an id takes the longest override key it contains, over the table and the fallback. A partial override now takes the prices it lacks from the id's own price rather than from its key's entry, so `{ "gpt-4o": { input: 1 } }` keeps `gpt-4o-2024-05-13`'s output price and `{ opus: { input: 99 } }` keeps `claude-opus-4-8`'s.

- Add `priceRecord(record, pricing)` to `/cost`: it prices one usage record by the rules of `summarize` and returns its parts, one per model when the record is split by model, else one for the whole record, each with its `model`, `usage`, `modelCalls` when the record counts them, and `cost` (`{ costUsd, costSource }`), absent rather than 0 when nothing prices the part. The parts' costs, added up per agent and model, equal `summarize`'s groups. `/cost` also exports the `PricedRecord`, `PricedPart` and `Cost` types.

- Add `@rivus/agent-kit/cost/prices`: `litellmPrices`, a snapshot of LiteLLM's prices for the chat models the supported agents record (Anthropic, OpenAI, Google Gemini, xAI, DeepSeek, Z.ai, Moonshot and MiniMax, keyed by the bare model name), ready for `createPricing`, and `litellmPricesVersion`, the date and LiteLLM commit it was generated from, for a host to record which table priced its data. The entry imports nothing, and `/cost` does not load it. A weekly job refreshes the snapshot in patch releases.

## 0.21.1

### Patch Changes

- Summaries of Claude Code sessions change and `SESSION_SUMMARY_VERSION` is now 2, so caches of `summarizeSession` results recompute; a session's `turns` can go up or down. Claude Code's IDE context blocks (`<ide_opened_file>`, `<ide_selection>`) now count as host-added text. A record that opens with a host block and holds the user's text — a system reminder or IDE context, then the user's words — now counts a turn in `summarizeSession`'s `turns`, collects its prompt and titles the session with the user's text: a system reminder first counted nothing before, and IDE context first counted a turn that prompted and titled with the opened file. A record holding only IDE blocks no longer counts a turn (before, it counted one, with the opened file as prompt and title), a system reminder beside an image now counts a turn (before, none), and a host block beside only a tool result, or followed by a slash command, counts no turn (before, both counted a turn). In `loadTranscript` events of a prompt record, a host-added text block carries `injected: true` in its payload, and session titles and `firstPrompt` of multi-block records are the joined, trimmed text. Collected prompts are trimmed for every agent, and a prompt that is only whitespace is no longer collected; one record's prompt joins its text events with a blank line instead of taking the first non-empty one. Consumers that cache prompts, titles or summaries recompute them.

- Hide the URL-encoded home (`%2Fu%2Fme`), the project slug and the slash-less home right after a JSON escape (`\n`), URL encoding (`%2F`) or an ANSI colour sequence (`\u001b[32m`) in raw text, where the escape's last letter or digit kept the spelling visible.

- Codex transcripts keep event ids unique when a response item's id equals another event's id: the request event renames to the first free request:<key>:<n>, and an event whose id or line key an item took renames to the first free L<line>:<n>.

- The Codex summarize pass no longer buffers a rollout whose records carry no timestamps: a time-less file streams through at the memory of its running numbers.

- On the live ACP path, a tool call updated after its turn ended no longer appears twice: a session keeps one stream folder across its turns, so a call yields one `tool_call` however many turns it outlives. Each turn's deltas stay self-contained — a turn carrying an update for an open call it has not yet mentioned repeats the call's start and input first, and a turn's `finish` re-sends the open calls no earlier finish has closed — so folding one turn's deltas alone repeats the `tool_call` of a call that outlived it, with the input it had when it was emitted. An update for a call whose result is out emits nothing, and a failed turn closes its open text and reasoning as its own events while a call left open stays open for the next finish. A call's input and output are dropped once its result is emitted.

- A hook event registered for Claude Code is no longer attributed to Cursor when only the environment carries CURSOR_VERSION, which a parent shell can leave behind: Cursor evidence now comes from the payload's cursor_version field, per Cursor's documented base hook input.

## 0.21.0

### Minor Changes

- Require the exact optional Effect peer 4.0.5. Hosts pinning effect 4.0.4 fail to install under npm; update the host to 4.0.5 alongside these packages.

### Patch Changes

- Rebuild with Vite+ 1.3.0; no API change

## 0.20.0

### Minor Changes

- Update the exact optional Effect peer to effect 4.0.4. Hosts pinning effect 4.0.3 fail to install under npm; upgrade the host to effect 4.0.4 when updating either package.

- Add `Provider` and `builtinProviders` through `/providers`. Routed APIs now accept provider descriptors merged by agent id and service; this replaces the `adapters`, `dialects`, `recipes` and `profiles` override options. Provider interfaces are available through scoped SPI entries.

  Provider identities with conflicting names or mismatched ids are rejected. Remove `resolveHome` and `CodingAgentIdWithHome`; resolve a session or usage service's home with `sessionAdapterHome`. Hook host detection reads dialect marker declarations, and the `/testing` conformance suites that read service tables bind the built-in ones.

- Narrow the public API to recorded application, provider SPI and testing consumers. Replace individual built-in tables with provider descriptors, while retaining `builtinHookDialects` on `/harness/events` and `AgentKitError` / `isAgentKitError` on `/catalog`. `/providers` shares the ordinary pack; `/cost`, `/harness/events` and `/transcript/usage` remain isolated.

  Select optional services from `builtinProviders`; hook commands keep their hooks-only table. Remove the following named exports; declarations needed by retained signatures remain available through inferred types, `Parameters`, `ReturnType` and indexed access.

  - `@rivus/agent-kit/acp`: `AcpErrorCode`, `AcpProfiles`, `AcpRequestFailed`, `AcpSessionSnapshot`, `AcpSessionState`, `AcpTimeout`, `AgentFeatures`, `AgentInfo`, `AgentProbe`, `AgentUnavailable`, `AuthMethodInfo`, `AuthRequired`, `BindingNotFound`, `CancelUnsettled`, `ConnectAgentOptions`, `ConnectionClosed`, `HandshakeFailed`, `LiveTranscriptEvent`, `LoadSessionError`, `LoadSessionTarget`, `LoadUnsupported`, `NameValue`, `NewSessionOptions`, `PermissionOption`, `PermissionOptionKind`, `SessionBinding`, `SessionBindingStoreFailure`, `SessionBindingStoreShape`, `SessionCloseReason`, `SessionClosed`, `SessionOptions`, `SessionSetup`, `SystemPromptPlacement`, `TurnInProgress`, `builtinAcpProfiles`, `foldStreamParts`, `optionOfKind`.
  - `@rivus/agent-kit/catalog`: `AgentHomeSource`, `AgentKitErrorOptions`, `InvalidCodingAgentId`, `builtinCodingAgents`, `homeFromRule`, `parseCodingAgentId`.
  - `@rivus/agent-kit/cost`: `CalendarWindow`, `CalendarWindowOptions`, `Cost`, `CostErrorCode`, `Price`, `PriceOverrides`, `PricingOptions`, `PricingTable`, `SummarizeOptions`, `UsageGroup`, `UsageGroupKey`, `UsageSummary`, `UsageTotals`, `calendarWindow`, `costOf`, `fromLiteLLM`.
  - `@rivus/agent-kit/discovery`: `AuthCommandProbe`, `AuthObservation`, `AuthProbe`, `AuthSource`, `AuthState`, `AuthVariable`, `CommandFailed`, `CredentialFileFailed`, `CredentialFileProbe`, `DETECTION_STATUSES`, `DetectionStatus`, `DiscoveryErrorCode`, `DiscoveryPlatform`, `Evidence`, `EvidenceKind`, `InstallationKind`, `StatFailed`, `Version`, `VersionProbe`, `builtinProbeRecipes`, `classifyInstallation`, `resolveAuthState`.
  - `@rivus/agent-kit/harness`: `AgentCliFailure`, `AgentCliShape`, `AppliedStep`, `ApplyFailed`, `ApplyInstallError`, `ApplyInstallOptions`, `ApplyReport`, `ArtifactFailure`, `ArtifactFilesShape`, `ArtifactInstalled`, `ArtifactIoFailure`, `ArtifactKind`, `ArtifactRead`, `ArtifactRemoved`, `ArtifactSource`, `ArtifactSpec`, `Check`, `ChezmoiExternalOwnerLive`, `CommandLine`, `Conflict`, `ContentHash`, `DoctorOptions`, `DocumentInvalid`, `Drift`, `DroppedHook`, `EntryChange`, `ExternalOwnerShape`, `FindLegacyError`, `FindLegacyOptions`, `FindLegacyServices`, `HookCompat`, `HookOverlap`, `HookSpecRejected`, `InstallAdapters`, `InstallScope`, `InstructionSpec`, `InvalidBundle`, `InvalidHookPlacement`, `InvalidLedger`, `InvalidPlan`, `Inventory`, `LedgerBusy`, `LedgerEntry`, `LedgerEvent`, `LedgerLock`, `LedgerLockError`, `LedgerLockFailure`, `LedgerLockOptions`, `LedgerLockShape`, `LedgerLockUnavailable`, `LedgerReadError`, `LedgerRepositoryFailure`, `LedgerRepositoryShape`, `LedgerVersionUnsupported`, `LegacyEntry`, `LegacyTreatment`, `LocatorKey`, `McpServerSpec`, `Owner`, `PendingOperation`, `PendingOperations`, `PlacedRegistration`, `PlanAction`, `PlanBasis`, `PlanInstallError`, `PlanInstallOptions`, `PlanStale`, `PlanStatus`, `PlanStep`, `PlannedCommand`, `PlannedFileChange`, `PreImage`, `Precondition`, `ProcessAgentCliLive`, `Removal`, `RenderedArtifact`, `RevisionConflict`, `ScopeOptions`, `SkillSpec`, `StepNote`, `Strategy`, `StrategyUnavailable`, `TargetChanged`, `TrustPromptKind`, `UnexpectedShape`, `UninstallError`, `UninstallOptions`, `UninstallReport`, `VerifiedArtifact`, `VerifyError`, `VerifyOptions`, `VerifyReport`, `VerifyStatus`, `builtinInstallAdapters`, `findLegacy`, `ownerSlug`.
  - `@rivus/agent-kit/harness/events`: `BlockSource`, `FieldSource`, `ForeignHooks`, `HeartbeatSignal`, `HookDialects`, `HookTimeout`, `HostMarkers`, `INITIAL_LIFECYCLE_STATE`, `LifecycleBlocker`, `LifecycleClock`, `LifecycleMapping`, `LifecycleOutcome`, `LifecyclePhase`, `LifecycleScope`, `LifecycleState`, `LifecycleStatus`, `LifecycleSwitch`, `ReadHookEventOptions`, `TerminalHost`, `TerminalIdentity`, `heartbeatSignal`, `lifecycleStatus`, `reduceLifecycle`.
  - `@rivus/agent-kit/node`: `NodePlatformOptions`.
  - `@rivus/agent-kit/platform`: `ByteRange`, `ChildHandle`, `DirEntry`, `Env`, `ExitStatus`, `FileKind`, `FileStat`, `Line`, `OperatingSystem`, `PlatformClock`, `PlatformFs`, `PlatformProcess`, `PlatformSqlite`, `ProcessIdentity`, `RunOptions`, `RunResult`, `SpawnOptions`, `SplitLinesOptions`, `SqliteDatabase`, `SqliteRunResult`, `SqliteStatement`, `SqliteValue`, `splitLines`.
  - `@rivus/agent-kit/redact`: `RedactOptions`.
  - `@rivus/agent-kit/sessions`: `DiscoverOptions`, `ListSessionsOptions`, `LoadOptions`, `ReadFailed`, `SessionErrorCode`, `SessionListFailure`, `SessionNotFound`, `SessionReadError`, `builtinSessionAdapters`.
  - `@rivus/agent-kit/testing`: `ConformanceCheck`, `MemoryCommand`, `MemoryFile`, `MemoryPlatform`, `MemoryPlatformOptions`, `MemoryRunResult`.
  - `@rivus/agent-kit/transcript`: `CAPABILITIES`, `CLAUDE_CODE_CAPABILITIES`, `CODEX_CAPABILITIES`, `CapabilityUnsupported`, `ClaudeCodeTranslateOptions`, `CodexTranslateOptions`, `CompactionPayload`, `GROK_CAPABILITIES`, `GrokTranslateOptions`, `HookPayload`, `LiveTranscriptEvent`, `LoadTranscriptOptions`, `MAIN_LANE_ID`, `MessagePayload`, `NoAdapterAccepted`, `ParsedTranscript`, `ReadFailed`, `ReadOriginalError`, `ReasoningPayload`, `RequestPayload`, `SessionNotFound`, `SessionPrompt`, `SessionPromptsOptions`, `SessionReadError`, `SessionSummaryWithPrompts`, `SkippedRecord`, `SourceChanged`, `SourcedRecord`, `StampedRecord`, `SystemPayload`, `TRANSCRIPT_EVENT_KINDS`, `ToolCallPayload`, `ToolResultPayload`, `TranscriptStreamPart`, `UnknownFormatGeneration`, `UnknownPayload`, `Usage`, `claudeCodeUsage`, `codexUsage`, `foldStreamParts`, `foldTranscript`, `grokUsage`, `isPrompt`, `laneOf`, `latestSnapshot`, `mainAgentId`, `promptSnapshot`, `promptStarts`, `readOriginal`, `recordKey`, `requestUsage`, `sessionPrompts`, `shadowedIn`, `snapshotHasSystemPrompt`, `snapshotHasTools`, `translateClaudeCodeRecords`, `translateCodexRecords`, `translateGrokRecords`.
  - `@rivus/agent-kit/transcript/usage`: `AiSdkUsage`, `CapabilityUnsupported`, `CostSource`, `DecodeUsageOptions`, `ListUsageSourcesOptions`, `ModelUsage`, `OtelAttributeOptions`, `ReadFailed`, `ScanUsageOptions`, `SessionErrorCode`, `SessionListError`, `SessionNotFound`, `SourceChanged`, `SourcePointer`, `SqliteUnavailable`, `UnknownFormatGeneration`, `Usage`, `UsageCursor`, `UsageDecodeError`, `UsageDecodeFailure`, `UsageGranularity`, `UsageScan`, `UsageScanSource`, `UsageScanState`, `UsageSource`, `UsageSourceFailure`, `UsageSourceOptions`, `UsageStream`, `UsageTarget`, `addUsage`, `decodeUsage`, `isUsageSource`, `listUsageSources`, `toAiSdkUsage`, `toOtelAttributes`.
  - `@rivus/agent-kit-collab/lease`: `AcquireOptions`, `AcquisitionView`, `FenceRejected`, `FencingToken`, `FileLeaseRepositoryOptions`, `HolderLiveness`, `LeaseConfig`, `LeaseObservation`, `LeaseRepositoryShape`, `RevisionConflict`, `SqliteLeaseRepositoryOptions`, `canAcquire`, `checkFence`, `holderLiveness`, `isFresh`, `nextFencingToken`.
  - `@rivus/agent-kit-collab/lanes`: `ActivationInterruptReason`, `LaneQueueFull`, `LaneSnapshot`, `LaneState`, `LanesClosed`, `LanesConfig`, `LanesConfigInvalid`, `LanesStatus`, `WakeResult`.
  - `@rivus/agent-kit-collab/process-lock`: `ProcessLockHeld`, `ProcessLockHolder`, `ProcessLockOptions`.

### Patch Changes

- Move Cursor services into its provider package without changing behavior.

- Move Codex services into their provider package without changing public behavior.

- Move Grok services into a dedicated provider package without changing behavior.

- Close out provider ownership of built-in services and identities, preserving the seven built-in ids, with no further API change. Context-derived public signatures now use string ids; the catalog entry retains CodingAgentId completion for built-ins. Keep support documentation checked against shipped capabilities and share the Codex plugin registration pointer between installation and removal.

- Move Gemini CLI services into a dedicated provider package without changing behavior.

- Update dependencies.

- Move the pi adapter into its own internal package; no API change.

- Remove internal barrel files; no API change.

- Clarify the own-property helper documentation in bundled code.

- Internal domain model; no API change.

  Reject array-valued ledger entries returned by an external repository as `InvalidLedger`; the file repository already rejects them.

- Internal domain model; no API change.

- Internal domain model; no API change.

- Internal domain model; no API change.

- Move OpenCode services into their provider package without changing behavior.

- Move Claude Code services into an isolated provider package without changing behavior.

- Internal domain model; no API change.

## 0.19.1

### Patch Changes

- The packages are now built and published from a pnpm workspace instead of Rush; the published code is unchanged.

## 0.19.0
Sat, 17 Oct 2026 06:13:04 GMT

### Patches

- Correct discovery evidence to require agent-owned sessions, application state or credentials, preserving Cursor desktop storage. Consumers of detectAgents with built-in recipes, including agent-presence and application setup/detection screens, now report missing when no command, recognized application or agent-owned file exists, including Claude Code with only ~/.claude.json (macOS keychain login and no session yet) and machines populated only by harness hooks, plugins, skills or shared MCP/settings. Command and application evidence is unchanged.
- Remove empty configuration files on uninstall only with current creation proof; retain pre-existing files and user content, renew proof for files recreated by harness, and isolate malformed entries owned by other applications.
- Scope harness verification and acknowledgement to selected agents and their desired locators, preserving three-way comparisons for shared paths.

## 0.18.0
Fri, 16 Oct 2026 06:29:41 GMT

### Patches

- A shell-quoted hook program path with spaces is no longer cut at the space and reported missing. Only a plain absolute path is checked; a program that needs shell expansion is not.

### Updates

- Revert PR 142

## 0.17.0
Thu, 15 Oct 2026 06:07:53 GMT

### Minor changes

- The exact optional effect peer moves to 4.0.3, so hosts that install effect must move to 4.0.3: an install pinned to 4.0.1 fails with ERESOLVE under npm and warns under pnpm. The /acp entry's @agentclientprotocol/sdk dependency moves to 1.8.0 (schema v1.25.0), which validates fs/read_text_file's line and limit strictly, so a non-integer value now returns an invalid-params error to the agent instead of reading the whole file.
- Add optional extensions to ArtifactSource files sources and pass owner to InstallAdapter.legacySources(context, owner). List a previous release's own Grok hook file with findLegacy and replace it during installation. Built-in directory legacy sources skip files the agent does not load; custom files sources without extensions continue to read every file.

### Patches

- Populate Grok hook event, name and exitCode fields while preserving per-run details. Grok hook payloads no longer carry event_name and tool_name; readers should use event and name instead.

## 0.16.0
Thu, 15 Oct 2026 04:05:26 GMT

### Minor changes

- /harness gains findLegacy(owner, { agents, legacyMarkers, compat?, adapters?, dialects? }), a read-only query that lists what a release before the ledger left behind: it scans the selected agents' declared legacy sources (and the other agents' hook files those agents execute) and reads the owner's tracked locators, judging each find by the plan's own rule with the markers the caller supplies — an install bundle may carry none. Each LegacyEntry names the agent it is effective in, the locator and its kind, a hook entry's event and command, and whether planning would replace it or protect it — kept as the user's, or indistinguishable from the user's own because an owned hook is missing from its event. Nothing is written and the LedgerLock is never taken: the entry needs only ArtifactFiles, LedgerRepository and PlatformService, and an entry the ledger records is never listed. The listing does not render a bundle, so it is not the plan's whole legacy set: an Artifact at a path the next install itself writes is listed only when a legacy source covers that path (Grok's own hook file is one no source covers today), and an entry in a symlinked or externally managed file is listed as replace although the plan refuses the path as an unresolvable conflict; the /harness spec states the boundary. Planning's behavior is unchanged; buildInstallPlan now judges locators through the shared legacyTreatment instead of an inline copy of the same rule. A target an interrupted apply left pending is not listed either, since the read-only call cannot settle it, and the owner and the markers are validated the way uninstall's are.
- Finish events from the opencode and Pi bridges are delivered before the next event: each bridge derives when an event is finish from the dialect's lifecycle mappings — a fixed finish mapping always, a switch only for the field values whose case mapping is finish (or any value outside the cases when its otherwise is finish) — with every alias spelling, and hands those payloads to the hook command with spawnSync, whose exit or 5 s timeout releases the bridge (the timeout kills the shell, so a longer finish hook is cut off). A failed or timed-out synchronous send stays fail-open, other events keep the asynchronous spawn, and the opencode bridge still updates its currentSessionId memory for every event before the send. Pi's synchronous set gains agent_end and agent_settled next to session_shutdown.

## 0.15.0
Wed, 14 Oct 2026 00:33:31 GMT

_Version update only_

## 0.14.0
Tue, 13 Oct 2026 11:09:20 GMT

### Updates

- Document that PlatformSqlite.open with readonly throws on a missing database file instead of creating it.

## 0.13.0
Tue, 13 Oct 2026 08:20:24 GMT

### Minor changes

- The opencode bridge adds the current session id to events that name none and forgets a session once it is deleted. A HookEventSpec can replace a payload field source for its own event; the opencode dialect reads info.id as the session id only on session.created, session.updated and session.deleted (#99).

## 0.12.0
Tue, 13 Oct 2026 07:15:51 GMT

### Minor changes

- TranscriptEvent, LiveTranscriptEvent and the update stream part are now unions discriminated by kind, so narrowing on event.kind types event.payload as that kind's payload type, fields an agent adds read as unknown, TranscriptEventOf<K> names the events of some kinds, and TranscriptEventPayloads maps each kind to its payload type, so a third-party adapter can type a builder generic over the kind. SystemPayload declares the prompt snapshot fields, ToolCallPayload the ACP title, and requestUsage takes a request event. Code that builds an event from a kind typed TranscriptEventKind and a Record payload no longer compiles; build that kind's payload type instead, or TranscriptEventPayloads[K] in a builder generic over the kind. Runtime output is unchanged.

### Updates

- Call the coding agent the agent, not the host, in sessions adapter comments.
- Replace hand-written shape guards with schema or library checks, preserve ACP merges, configuration records, hook payload reads and probe variants, validate package manifests, and document permitted exceptions.

## 0.11.0
Sun, 11 Oct 2026 03:31:41 GMT

### Patches

- Keep collected summary prompts from retaining their full source text.
- Bundle zod/mini into /node and /node/effect, and read the current process identity once per process.

### Updates

- Tidy the shared summary assembly: file-local summary gates, the Grok retain step requires the record time again.

## 0.10.0
Sat, 10 Oct 2026 20:10:42 GMT

### Minor changes

- The Codex adapter summarizes sessions in one bounded fast pass, with the same numbers as folding the loaded transcript and the same prompts option as the claude-code adapter.
- Summarize Grok sessions in one bounded pass: the record dispatch the translation runs also folds the summary, holding per-turn usage, subagent lanes, tool-call statuses and capped prompts, never the session's bytes.

## 0.9.0
Sat, 10 Oct 2026 17:35:50 GMT

### Minor changes

- summarizeSession gains a prompts option ({ limit, maxChars }) returning the main lane's user prompts, and the claude-code adapter summarizes sessions in one bounded fast pass with the same numbers as folding the loaded transcript.

### Patches

- An ACP tool call keeps the name from its first non-empty `title || toolName`; a later display title is a separate `title` field (cleared when it matches the name again) in Grok session logs and live ACP turns alike, and a plain-object `rawInput` update merges into the call's args instead of replacing them.

## 0.8.0
Sat, 10 Oct 2026 15:55:22 GMT

### Minor changes

- Export `sessionAdapterHome` from `/sessions`: the home whose roots a session adapter lists, for callers that walk roots themselves.

## 0.7.0
Sat, 10 Oct 2026 13:27:57 GMT

### Patches

- Redaction hides a multi-segment home's project slug after any character that is not a letter, digit, `_` or `%` (e.g. `*-Users-me-proj*`).

## 0.6.0
Sat, 10 Oct 2026 05:42:15 GMT

### Minor changes

- An id-less subagent block now carries its raisedAt, is re-timed on every id-less raise, and expires one TTL after it instead of staying blocked while the main agent keeps working; BlockSource (published through /harness/events) gains the optional field, and entries persisted without it keep the old behavior.

### Updates

- Bump @effect/tsgo to 0.50.0.
- Adopt lint-config v0.5.0 and fix its no-unnecessary-condition findings.
- Move the toolchain to Vite+: build with `vp pack`, lint/format/test through `vp`. The built output is unchanged.
- Carry optional collection defaults once inside the domain. No published type or behavior change.
- Type log record timestamps at the adapter boundary with one shared zod field; parse caught file system errors with a zod object.
- Read record times through one strip-schema parse; classify file system errors without touching non-fs errors' properties.
- Internal refactor: declare functions before their use; no behavior change.
- Adopt lint-config v0.6.0: no-use-before-define checks function declarations.
- Declare functions before their use in the sessions package for the no-use-before-define functions rule.
- Declare functions before their use in @rivus/agent-kit-testing for the no-use-before-define rule

## 0.5.0
Fri, 09 Oct 2026 09:29:24 GMT

### Minor changes

- Catalog and discovery keep only the agents some context supports (claude-code, codex, cursor, gemini-cli, grok, opencode, pi); removed the identities and probe recipes of aider, amp, antigravity, cline, codebuddy, codex-desktop, command-code, github-copilot, hermes, kimi-code-cli, kiro-cli, neovate, openclaw, openhands, qoder, roo-code, trae, vscode-copilot, windsurf and zencoder.

### Patches

- The claude-code session, transcript and usage adapters read the logs through zod/mini schemas, like the other agents; behavior is unchanged.
- Read the Codex session, transcript and usage logs through zod schemas, which grows /sessions, /transcript and /transcript/usage to about 18.8-22.3 kB.
- Grok's log readers and the shared ACP session/update reader parse unknown fields through zod/mini schemas instead of the record-fields accessors, which the grok files no longer import; the grok record is parsed once per reader pass through a full and a slim update schema, and published entry sizes rose with the schemas and their budgets follow.
- Read agent logs through zod schemas; the zero-dependency entries bundle zod/mini into their built files instead of importing it, which grows /transcript/usage to about 16 kB.
- Parse unknown input with zod/mini schemas outside sessions: hook payloads (`/harness/events` reads dialect paths through schemas and stays synchronous, with zod/mini bundled into the built entry), stored ledgers and leases, configuration documents, and caught platform errors. Observed behavior is unchanged, and `/harness/events` grows by about 5 kB of bundled zod.
- Editing a TOML configuration document that holds a big integer no longer throws. `/cost` bundles zod/mini for its LiteLLM price parser and `/node` grows with the platform's error-code schema. redact now recognizes plain objects from another realm and returns objects branded with `Symbol.toStringTag` unchanged.

### Updates

- Move the agent adapters of acp, harness, sessions and discovery into their domain concepts: each file now lives under the `adapters/` of the concept whose model it produces (`domain/<concept>/adapters/`), tables of pure adapters live in the concept's `adapters/`, and sessions' `domain/protocols/` was dissolved into `domain/transcript/adapters/`. The published surface is unchanged.

## 0.4.0
Thu, 08 Oct 2026 22:27:28 GMT

### Minor changes

- Rename the harness ledger store to a repository: `LedgerStore`/`LedgerStoreShape`/`LedgerStoreFailure` are now `LedgerRepository`/`LedgerRepositoryShape`/`LedgerRepositoryFailure`, `FileLedgerStoreLive` is `FileLedgerRepositoryLive`, and the service key is `@rivus/agent-kit/harness/LedgerRepository/v1`; a save over a stale revision now fails with the tagged error `{ _tag: "RevisionConflict", scope, expectedRevision, storedRevision }` — named like the lease repository's, instead of a failure of reason `revision-mismatch`. The file ledger repository passes the aggregate-repository conformance suite from `/testing/effect`.
- Add the `/testing/effect` entry with `aggregateRepositoryConformance`, the generic conformance suite that every aggregate repository implementation runs (missing-id load, first save, stale revisions refused with `RevisionConflict`, strictly increasing revisions, unknown `schemaVersion` refused and kept, reopen for persistent stores); it runs for the lease repositories of `@rivus/agent-kit-collab`.

### Patches

- Move harness business rules (strategy choice, plan evidence scope, registration commands, stale and precondition checks, foreign hook and registration state rules) from application use cases into their owning domain contexts; a restored cli-registration no longer lists an unregister command apply never runs, and doctor's hook audit now also reads other agents' settings files a runner executes that the owner's adapter no longer lists (Claude Code's settings.local.json for Grok).
- Move the verify, uninstall and doctor rules into the harness domain: `verifyOwner` classifies an owner's entries, `Ledger.entriesOf`/`agentsOf` and `InstallPlan.kept` are aggregate queries, and `hookHealth`/`duplicateHooks` carry the doctor findings. Two behavior changes: verify's default agents are now the owner's entry agents in sorted order (they followed ledger order before), which can reorder `VerifyReport` rows and change the agent an error names first; and doctor matches `markers` the way `isLegacyArtifact` does, so a marker that is only whitespace no longer makes every hook command with a space fire twice. No API change.
- The Claude Code and Codex transcript translators take an optional `path` option, and `AuthObservation` allows a credential-file observation to omit its `reading`; both are additive, optional fields.

### Updates

- Adopt lint-config v0.4.0 and fix the no-use-before-define hits it surfaces in bundled internal packages. No API or behavior change.
- Move the acp session-binding ownership check and the client-path verdict into the acp domain. No API or behavior change.
- Align the internal package layout with the types-ddd folder names (domain aggregates/entities, domain/adapters, application use-cases/services, infra). No API or behavior change.

## 0.3.0
Thu, 08 Oct 2026 04:46:15 GMT

### Minor changes

- Add @rivus/agent-kit/cost: createPricing looks prices up in a table the caller passes in (own id, then the longest matching key, with partial overrides and a fallback), costOf prices a UsageRecord (the agent's own cost first, else per bucket with one-hour cache writes, times pricingMultiplier, per model for split records), calendarWindow gives the last N calendar days in a time zone, summarize totals tokens, entries and known cost by agent and model, and fromLiteLLM converts LiteLLM's price list; the entry imports nothing.
- Add the /harness entry (Effect): planInstall, applyInstall, verify, uninstall, inventory and doctor install hooks and skills into Claude Code, Codex, Gemini CLI, Grok, Cursor, opencode and Pi with a ledger, an SQLite ledger lock and format-preserving JSONC and TOML edits; add Platform.fs.mkdir
- Add /redact: redact and redactText hide home directory spellings (POSIX, Windows, file URLs, agent folder names, ~user) and secret-shaped strings.
- Add /acp: drive coding agents over the Agent Client Protocol (connectAgent, probeAgent, ACP profiles for Claude Code, Codex, Gemini CLI, Grok and opencode, session bindings), and foldStreamParts with the live stream part types in /transcript.

### Updates

- Document public entry selection, runtime composition and application adoption.
- Add the harness injection domain (Bundle, InstallPlan, Ledger, three-way verify) without public API

## 0.2.0
Wed, 07 Oct 2026 19:57:58 GMT

### Minor changes

- Add @rivus/agent-kit/transcript/usage: scanUsage, decodeUsage and listUsageSources stream resumable UsageRecords for Claude Code, Codex, Gemini CLI, Grok, opencode and Pi, with noCacheInputTokens, toAiSdkUsage, toOtelAttributes and addUsage; the entry imports nothing. Claude Code requests behind a gateway without request ids now count, keyed by message id, and keep their largest usage.
- Add the /harness/events entry: readHookEvent, reduceLifecycle and the hook dialects of Claude Code, Codex, Cursor, Gemini CLI, Grok, opencode and Pi; add the Cursor identity to /catalog and hookDialectConformance to /testing
- Add the Effect entries /platform/effect (PlatformService) and /node/effect (NodePlatformLive). effect 4.0.1 is an optional peer that only these entries need.
- Add /discovery: detectAgents reports for each of 27 coding agents (agent-finder's 26, with facts corrected against upstream sources, plus Grok) whether it is runnable, found, missing or unknown, with evidence, version, login state and the checks that failed. Login state is read from credential files and variables by default; authProbe: "commands" also runs the agents' status commands, and versionProbe: false skips the version probes. Catalog gains identities for the 21 new agents, with home rules only for the nine whose home upstream documents, so resolveHome now takes CodingAgentIdWithHome. /testing gains probeRecipeConformance and scripted commands for createMemoryPlatform.

## 0.1.0
Wed, 07 Oct 2026 13:02:04 GMT

### Minor changes

- First release: the agent catalog (ids, aliases and home rules for six coding agents, Result, AgentKitError), the Platform port and its Node implementation, session listing and transcripts for Claude Code, Codex and Grok, and testing utilities (in-memory platform, session adapter conformance suite).

