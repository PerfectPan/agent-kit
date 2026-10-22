# Change Log - @rivus/agent-kit

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

