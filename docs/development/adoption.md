# Adopting agent-kit

This guide is for maintainers replacing an application's copy of coding-agent knowledge with agent-kit. The kit side of P0–P6 is implemented. Each application owns its migration, behavior checks and rollout. Use one adoption pull request per application and retain its behavior except for corrections explicitly accepted during comparison.

Before adoption, select a verified npm release whose manifest exports the entries you need. Source implementation can precede publication. Install `@rivus/agent-kit` and `@rivus/agent-kit-collab` from the same lockstep release when using collab, and pin the chosen version in the application's lockfile. Placeholder versions are not usable releases. See the [release runbook](release.md) for publication checks.

## Public entry inventory

The source exports 16 agent-kit entries and three collab entries (19 in total). Imports use public subpaths; there is no root entry or supported deep import into internal context packages.

| Entry                                  | Main API                                                                                                                              | Calling style                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `@rivus/agent-kit/catalog`             | `builtinCodingAgents`, `parseCodingAgentId`, `resolveHome`, `Result`, `AgentKitError`                                                 | Plain, pure                                     |
| `@rivus/agent-kit/platform`            | `Platform` and port types, `splitLines`                                                                                               | Plain                                           |
| `@rivus/agent-kit/node`                | `createNodePlatform`                                                                                                                  | Plain, Node                                     |
| `@rivus/agent-kit/platform/effect`     | `PlatformService`                                                                                                                     | Effect service                                  |
| `@rivus/agent-kit/node/effect`         | `NodePlatformLive`                                                                                                                    | Effect Layer, Node                              |
| `@rivus/agent-kit/sessions`            | `listSessions`, `isSessionHead`, `builtinSessionAdapters`                                                                             | Plain, platform argument                        |
| `@rivus/agent-kit/transcript`          | `loadTranscript`, `summarizeSession`, `readOriginal`, `foldTranscript`, `foldStreamParts`, translators and event rules                | Plain; IO takes a platform                      |
| `@rivus/agent-kit/transcript/usage`    | `scanUsage`, `decodeUsage`, `listUsageSources`, `isUsageRecord`, `addUsage`, `noCacheInputTokens`, `toAiSdkUsage`, `toOtelAttributes` | Plain, no external imports; IO takes a platform |
| `@rivus/agent-kit/cost`                | `createPricing`, `costOf`, `calendarWindow`, `summarize`, `fromLiteLLM`                                                               | Plain, pure, no imports                         |
| `@rivus/agent-kit/discovery`           | `detectAgents`, `builtinProbeRecipes`, `classifyInstallation`, `resolveAuthState`                                                     | Plain, platform argument                        |
| `@rivus/agent-kit/harness/events`      | `readHookEvent`, `reduceLifecycle`, `lifecycleStatus`, `heartbeatSignal`, `builtinHookDialects`                                       | Plain, synchronous, no IO or imports            |
| `@rivus/agent-kit/harness`             | `planInstall`, `applyInstall`, `verify`, `uninstall`, `inventory`, `doctor`, `discardPlan`, `HarnessLive` and individual port Layers  | Effect                                          |
| `@rivus/agent-kit/acp`                 | `connectAgent`, `probeAgent`, `builtinAcpProfiles`, `agentEnv`, `optionOfKind`, binding store Layers, `foldStreamParts`               | Effect; connections and turns use caller Scopes |
| `@rivus/agent-kit/redact`              | `redact`, `redactText`                                                                                                                | Plain, pure                                     |
| `@rivus/agent-kit/testing`             | `createMemoryPlatform`, `sessionAdapterConformance`, `hookDialectConformance`, `probeRecipeConformance`                               | Test helpers, Node                              |
| `@rivus/agent-kit/testing/effect`      | `aggregateRepositoryConformance`                                                                                                      | Test helpers, Effect                            |
| `@rivus/agent-kit-collab/process-lock` | `acquireProcessLock`                                                                                                                  | Plain, platform argument                        |
| `@rivus/agent-kit-collab/lease`        | `createLeaseManager`, `LeaseRepository`, `sqliteLeaseRepository`, `fileLeaseRepository`, `memoryLeaseRepository`, fencing rules       | Effect                                          |
| `@rivus/agent-kit-collab/lanes`        | `createLanes`                                                                                                                         | Effect, process-local                           |

The packages are ESM only, have no import-time side effects, and require Node.js 22.13 or later for their Node adapters. Repository development uses Node 24. Browser-safe entries still need the caller's implementation of the relevant platform ports; browser bundling does not provide a filesystem or a process runner. `/node`, `/node/effect` and `/testing` are the Node-only exceptions.

## Choose the runtime boundary

Plain applications create one platform with `createNodePlatform()` and pass it to the APIs they use. Check `Result.ok` and handle failures by `error._tag`, and handle failure items from asynchronous listings and usage scans. `detectAgents` returns one `Installation` per agent with per-agent problems, rather than a call-level `Result`. An aborted plain IO call rejects with `signal.reason`.

Only consumers of Effect entries install the exact optional peer, currently `effect@4.0.1`. Align the host's lockfile and verify it resolves one Effect copy. Plain entries do not need Effect. Hooks import `/harness/events` directly and must not import setup or a barrel that reaches `/harness` or Effect. The no-import guarantees of `/harness/events`, `/transcript/usage` and `/cost` allow an editor or hook bundle to include only the required entry; they do not mean that installing the full npm package has no dependencies.

The application runs Effects at its assembly root. A one-shot setup command uses `Effect.runPromiseExit` and translates failure into its CLI exit code. A long-lived server owns a `ManagedRuntime`, runs callback Effects explicitly and observes their failures. An existing Effect application composes Layers and Scopes directly. The kit does not provide a Promise facade or run its own Effects.

For harness, provide `HarnessLive.pipe(Layer.provideMerge(NodePlatformLive))`, or substitute `Layer.succeed(PlatformService, createNodePlatform({ env, home }))` for an explicit test environment. The retained `PlatformService` is needed by the use cases as well as the harness port adapters. For a lease repository, use the same pattern, such as `sqliteLeaseRepository({ path }).pipe(Layer.provideMerge(NodePlatformLive))`. Do not supply a platform with `Layer.mergeAll` alone and expect it to feed another Layer in that group.

ACP programs use `connectAgent` with the platform service. Provide the platform to its program and keep the connection in a Scope that lasts as long as its sessions. With `sessionKey`, also provide `MemorySessionBindingStoreLive` or `FileSessionBindingStoreLive(path)`. `FileSessionBindingStoreLive` requires the platform; compose it with `provideMerge`. Without session keys, no binding store is needed. The caller chooses the explicit environment, permission callback and file access policy.

## Migration steps

### Trace viewer

1. Replace session discovery and reading with `/sessions` and `/transcript`. Use `isSessionHead` before treating a list item as a session, and inspect the Result of loading or summarizing it.
2. Keep turn reconstruction, timeline, context projection, text truncation and UI fields in the viewer. Update its model uses to `reasoning` and `finishReason` and use the kit's event references and interpretation rules.
3. Consume the session listing incrementally and use summaries when a view does not require a full transcript. Confirm memory no longer grows with full session size for that view; `loadTranscript` still loads a complete session and is not a live file-following API.
4. Adopt `/redact` with the same home and display/export policy as the host application. Delete the duplicate host packages and readers after its tests and old/new session-list comparison pass.

### Presence

1. Replace usage scanners with `/transcript/usage` and pricing calculations with `/cost`. Keep price snapshots and their update workflow in presence, inject the table, and persist `UsageScanState` with the same `since` window across scans.
2. Compare token and cost totals per agent over the same logs, window and price table. Input includes cache and output includes reasoning; breakdown fields are subsets. Missing counts and unpriced costs stay absent. Pricing preserves logged costs, one-hour cache writes and a per-record priority multiplier. Compare after accounting for scan finalization of still-running sources; do not hide decoding corrections in a broad tolerance.
3. Split hook and setup build outputs before migrating injection. Check the built hook's code and declaration graph for Effect and setup imports, and measure its cold start. A static setup import in the hook/CLI graph defeats the split even when tree-shaking would discard it elsewhere.
4. Use `/harness/events` in the hook. Continue to own presence's online-state policy. Respect the selected dialect's permission response semantics; an observer must not silently block a gate.
5. Use `/harness` in setup. Supply a `Bundle` with the application's owner, version, digest, hooks/skills and exact legacy command markers. Keep the hook shim command stable, using `{agent}` for the declaring agent. Call `planInstall`, display its `changes`, `commands`, `expectedTrustPrompts`, `notes` and `droppedHooks`, resolve only the allowed conflict choices, then pass the same plan handle to `applyInstall`. Plans cannot be serialized and reconstructed for later execution; re-plan after a restart or `PlanStale`/`TargetChanged`.
6. Run `verify(owner, { bundle, agents })` and `doctor({ owner, agents, markers })` after installation, and expose `inventory` and `uninstall` as appropriate in the setup UI/CLI. Planning may settle earlier pending operations under the ledger lock, and verify may acknowledge a ledger behind the disk; neither rewrites agent targets. Do not describe these operations as universally state-free.
7. Replace the mkdir lock with collab's plain `acquireProcessLock`, handling `ProcessLockHeld` and releasing the returned handle when the process ends.
8. Test upgrade, reapply, uninstall and downgrade under an isolated home. Then perform the separately authorized real Cursor and Codex checks before declaring application adoption complete.

### Editor plugin

Bundle `/transcript/usage` and `/cost` directly, supply the needed platform ports, and inject prices. Verify the output imports no runtime package or Node built-in the editor cannot provide. Keep the plugin's UI, reporting windows, persistence and price distribution policy. Test decoded totals and absent values with its existing fixtures.

### Agent task loop and agent-finder CLI

1. Replace init, discovery, session listing and preview with `/catalog`, `/discovery`, `/sessions` and `/transcript` as needed. The agent-finder CLI calls `detectAgents`; inspect recipe warnings and accept intended corrected probe facts explicitly. Use `versionProbe: false` with default file auth for an inspection that must execute no agent command.
2. Delete duplicate session root and resume knowledge from the TUI, the moved session reader package, and the MoonBit scanner after the application's tests, init smoke and preview comparison pass. Verify CI no longer needs the MoonBit toolchain.
3. Replace TaskOccupancyService's handwritten heartbeat, AbortController and release lifecycle with `createLeaseManager` and scoped `manager.acquire`. Keep task policy in the application. Fence writes using `handle.runFenced`, and make non-cancellable writes uninterruptible or wait until their AbortSignal has stopped them.
4. Keep room-specific orchestration and ToolServer in the application. After migration is accepted, confirm with the owner before deprecating `@rivus/agent-finder-core` and ending mooncakes module updates; those external actions are a separate completion state.

### Room web

1. Adopt collab leases using the SQLite lease repository where appropriate. Treat this as a code replacement; the kit does not promise compatibility with an existing database file or schema. Choose and verify the state transition before pointing it at existing data.
2. Replace ACP driving with `/acp` and scheduling with `/lanes`. Retain ToolServer and room policy. Keep a `ManagedRuntime` at the host assembly root, and run wake/cancel Effects in callbacks with failure handling.
3. Set `maxConcurrent`, choose `maxQueued` and `turnTimeoutMs`, and keep the connection/lease/prompt lifecycle inside the caller's `activate`. Test that concurrent ACP processes obey the global limit, wakes coalesce, a queued key is not duplicated, and cancel/close wait for cleanup. Observe `onExit` without making it wait on `cancel` or `close`.
4. Verify ACP permission denial, cancel deadlines, binding invalidation, explicit environment, client file confinement and shutdown with the application's old tests. Complete the real-agent smoke before claiming supported upstream behavior.

### Host application

Adopt `acquireProcessLock` for a single instance and `/redact` with the trace viewer's policy. Start two instances and verify the second is refused; verify recovery after the holder exits. Optionally replace the ACP loop with `connectAgent` and compose the real platform/binding Layers and Scopes. Keep the application's transport, background policy and MCP bridge.

## Verification and rollback

Each adoption PR records the chosen package version, the imported entries, exact application commands and their outcomes, old/new behavior comparisons, generated bundle checks and any skipped real-agent smoke. An installed package or delivered instruction is not evidence that adoption passed. Remove old code only after the replacement's behavior is covered.

Run installation tests with an explicit isolated `HOME` and environment. Confirm target files against the ledger after plan/apply/verify, confirm comments and unrelated settings survive, test failed steps and interruption recovery, and use `doctor` to look for old/new duplicate hooks. Do not run the migration's installer against an actual user home as part of ordinary kit verification.

Rollback one application's adoption PR first for changes that have no machine installation. Preserve a compatible prior dependency lockfile and state. New persistent stores need a reviewed state migration or separate path; do not assume their schemas match the application's old stores.

Harness downgrade order is mandatory: use the new version to `uninstall` its owner, inspect the report and any kept user-edited artifacts, run `verify` and `doctor` to establish that no new/legacy duplicate hook remains, then install the old application and run its old setup. Re-running old setup while the new plugin still exists can fire every event twice. Test `new install → new uninstall → old install/setup` under an isolated home and count one invocation per event. If uninstall reports kept artifacts, resolve them deliberately before enabling old setup. Never downgrade by deleting the ledger or blindly replaying a failed apply.

## Known limits and open acceptance

- Harness's built-in adapters support user scope, hooks and skills. MCP-server and instructions specs have no built-in strategy and fail with `StrategyUnavailable`; project scope is unsupported by built-in use cases.
- Ledger writes require `platform.sqlite` with the default `SqliteLedgerLockLive`, or a caller-supplied lock with equivalent ownership guarantees. Unknown ledger versions are refused. Local state directories only; shared configuration writers outside the ledger lock can still race the final write, with no atomic CAS guarantee.
- Cursor hooks and Claude Code's skills-dir plugin still need real-agent checks. The Cursor permission-gate issue remains application acceptance work. Codex plugin registration/cache upgrades and removal without its CLI have synthetic coverage but still need a real workflow check, including stable trust on upgrade.
- Multiple agents sharing a skill name are not deduplicated. Review the resulting plan rather than assuming one shared installation.
- Usage decoding supports Claude Code, Codex, Gemini CLI, Grok, opencode and Pi; full session/transcript adapters cover Claude Code, Codex and Grok. Cursor has hook support but no usage decoder. An installed agent is not evidence of every capability.
- A running source may keep unfinished usage until it is quiet for 30 minutes; unknown or missing usage stays absent. opencode usage needs SQLite. Login known only to a system credential store such as Keychain can remain `unknown` in file-based discovery.
- An unidentified subagent block can be kept alive by main-session activity (issue #6). Consumers must not treat this lifecycle edge case as fully resolved.
- ACP's Gemini flag and Grok system-prompt `_meta` location have unverified profile warnings. The live smoke suite is manual; record its results before accepting an upstream program. Tests against a fake agent establish protocol and cleanup behavior, not every upstream program's compatibility.
- File session bindings are atomically replaced but are not locked across processes. Lanes are process-local and persist no queue. Process locks and leases require local directories on darwin/linux and all contenders to see the same process table; NFS and containers with incompatible PID namespaces are outside their guarantee. The no-SQLite lock-file fallback has documented empty-stamp crash/stall limits.
- Releases remain 0.x; a minor version can change the API. A source-ready entry must not be adopted from an older published package that does not export it.
