# Change Log - @rivus/agent-kit-collab

## 0.23.0

### Patch Changes

- Updated dependencies:
  - @rivus/agent-kit@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies:
  - @rivus/agent-kit@0.22.0

## 0.21.1

## 0.21.0

### Minor Changes

- Require the exact optional Effect peer 4.0.5. Hosts pinning effect 4.0.4 fail to install under npm; update the host to 4.0.5 alongside these packages.

### Patch Changes

- Rebuild with Vite+ 1.3.0; no API change

- Updated dependencies:
  - @rivus/agent-kit@0.21.0

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

- Internal domain model; no API change.

  Reject array-valued ledger entries returned by an external repository as `InvalidLedger`; the file repository already rejects them.

- Internal domain model; no API change.

- Internal domain model; no API change.

- Internal domain model; no API change.

- Move OpenCode services into their provider package without changing behavior.

- Move Claude Code services into an isolated provider package without changing behavior.

- Internal domain model; no API change.

- Updated dependencies:
  - @rivus/agent-kit@0.20.0

## 0.19.1

### Patch Changes

- The packages are now built and published from a pnpm workspace instead of Rush; the published code is unchanged.

## 0.19.0
Sat, 17 Oct 2026 06:13:04 GMT

_Version update only_

## 0.18.0
Fri, 16 Oct 2026 06:29:41 GMT

_Version update only_

## 0.17.0
Thu, 15 Oct 2026 06:07:53 GMT

### Minor changes

- The exact optional effect peer moves to 4.0.3, so hosts that install effect must move to 4.0.3: an install pinned to 4.0.1 fails with ERESOLVE under npm and warns under pnpm.

## 0.16.0
Thu, 15 Oct 2026 04:05:26 GMT

_Version update only_

## 0.15.0
Wed, 14 Oct 2026 00:33:31 GMT

### Minor changes

- acquireProcessLock serializes the acquisitions of one lock inside a process in memory: while one holds the lock or is attempting it, a later one with wait waits for it to release the lock or give up, then makes its own attempt, so no acquisition blocks the thread in a SQLite busy wait on a holder in its own process; without wait it resolves to ProcessLockHeld at once, without an attempt, with the holder the lock recorded. Aborting signal during that wait rejects with signal.reason and leaves the other turns as they were. Acquisitions share turns when they name the same file (its directory resolved through symlinks) through platforms with the same sqlite object (without SQLite, the same fs), as every createNodePlatform result has; other processes are still kept out by SQLite or the lock file, and isProcessLockHeld is unchanged.
- With SQLite, acquireProcessLock no longer needs the process identity, which only feeds the <path>.holder diagnostics: a process whose platform.process.self throws (on macOS, one in a sandbox that denies running ps or sysctl) takes the lock with holder undefined, writes no <path>.holder, and removes one that a holder which died left. ProcessLock.holder is now typed ProcessLockHolder | undefined; it is undefined only in that case. Without SQLite the lock file still needs the identity to judge its holder, and the acquisition rejects with the error reading it, as before. The fences of sqliteLeaseRepository follow the same rule; isProcessLockHeld is unchanged. On win32, which stays unsupported, process.self always throws, so a SQLite lock there is now taken the same way instead of rejecting; lock files and leases still need the identity.

## 0.14.0
Tue, 13 Oct 2026 11:09:20 GMT

### Minor changes

- Add isProcessLockHeld(platform, path, { signal }) to /process-lock: it tells whether another process, or an acquisition in this one, holds a process lock, without taking it. It writes nothing (no <path>.holder; a missing lock file reads as free and is not created), and never waits, so an aborted signal rejects with its reason before the check starts. With SQLite it makes one attempt at a shared lock, with no busy timeout, no retries and no process identity read, and answers in well under a millisecond; checks that run at once see a free lock as free. The first attempt of an acquireProcessLock running at the same moment (a 10 ms busy timeout, then a few short retries) still gets a free lock; the later retries of wait: true have no busy timeout and can find a free lock busy while a check reads it, and the call gets it after another backoff. Without SQLite it judges the lock file's holder as an acquisition does and reclaims nothing.

## 0.13.0
Tue, 13 Oct 2026 08:20:24 GMT

_Version update only_

## 0.12.0
Tue, 13 Oct 2026 07:15:51 GMT

### Updates

- Validate package manifests with zod/mini in distribution checks.

## 0.11.0
Sun, 11 Oct 2026 03:31:41 GMT

### Patches

- Bundle zod/mini into /process-lock so loading it does not load the zod package.

## 0.10.0
Sat, 10 Oct 2026 20:10:42 GMT

_Version update only_

## 0.9.0
Sat, 10 Oct 2026 17:35:50 GMT

_Version update only_

## 0.8.0
Sat, 10 Oct 2026 15:55:22 GMT

_Version update only_

## 0.7.0
Sat, 10 Oct 2026 13:27:57 GMT

_Version update only_

## 0.6.0
Sat, 10 Oct 2026 05:42:15 GMT

### Updates

- Adopt lint-config v0.5.0.
- Move the toolchain to Vite+: build with `vp pack`, lint/format/test through `vp`. The built output is unchanged.
- Internal refactor: declare functions before their use; no behavior change.
- Adopt lint-config v0.6.0: no-use-before-define checks function declarations.

## 0.5.0
Fri, 09 Oct 2026 09:29:24 GMT

### Patches

- The file lease envelope, the holder file's ENOENT read and the SQLite busy check parse with zod/mini schemas; a stored record missing its `record` field fails as an invalid record again. The `/lease` and `/process-lock` entries grow by their schema code.

### Updates

- Parse the file lease envelope, the holder file's ENOENT code and the SQLite busy check with zod/mini schemas instead of hand-written shape checks. Observed behavior is unchanged.

## 0.4.0
Thu, 08 Oct 2026 22:27:28 GMT

### Minor changes

- Unify the lease store into an aggregate repository: `LeaseStore`, `LeaseStoreShape` and `LeaseStoreFailure` are now `LeaseRepository`, `LeaseRepositoryShape` and `LeaseRepositoryFailure` (service key `@rivus/agent-kit-collab/lease/LeaseRepository/v1`), and `fileLeaseStore`, `memoryLeaseStore`, `sqliteLeaseStore` (with `FileLeaseStoreOptions`, `SqliteLeaseStoreOptions`) are now `fileLeaseRepository`, `memoryLeaseRepository`, `sqliteLeaseRepository` (with the matching options types).
- The lease repository port now follows the kit's repository shape: the port's `read` is `load`, and `compareAndSet(key, expected, next)` (returning a boolean) is `save(key, next, expectedRevision)`, which fails with a typed `RevisionConflict` (`_tag`, `key`, `expectedRevision`, `storedRevision`) instead of returning `false`; the lease manager treats the conflict as it treated the boolean.

### Patches

- Move the lease timing invariant, the loss-reason classification, the holder expiry rule and the lane admission rules into the lease and lane domains; `runFenced` now refuses fenced work over a stored record that breaks the Lease invariants (`LeaseStoreFailure` `invalid-record`) instead of trusting its raw fields. No API change.

### Updates

- Adopt lint-config v0.4.0 and fix the no-use-before-define hits it surfaces. No API or behavior change.
- Align the package layout with the types-ddd folder names (domain aggregates, application use-cases/services, infra). No API or behavior change.

## 0.3.0
Thu, 08 Oct 2026 04:46:15 GMT

### Minor changes

- First release: /lease (Effect: createLeaseManager, SQLite, file and memory stores, fenced work interrupted on lease loss) and /process-lock (acquireProcessLock), released in lockstep with @rivus/agent-kit.
- Add /lanes (Effect): createLanes({ maxConcurrent, maxQueued?, turnTimeoutMs?, activate, onExit? }) runs at most one activation per key, coalesces wakes into one pending activation, caps concurrency across keys, bounds the queue (LaneQueueFull), interrupts an activation after its turn timeout, and offers wake, cancel, status and close in the caller's Scope.

### Updates

- Document lockstep package installation and application adoption.

