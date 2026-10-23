# Adopting agent-kit

This guide is for maintainers replacing an application's copy of coding-agent knowledge with agent-kit. Each application owns its migration, behavior checks and rollout. Split each application's adoption into pull requests by kit area (for example pricing, hook events, setup, locks), each replacing the old code it covers and carrying its own comparison evidence, and retain behavior except for corrections explicitly accepted during comparison.

Before adoption, select a verified npm release whose manifest exports the entries you need. Source implementation can precede publication. Install `@rivus/agent-kit` and `@rivus/agent-kit-collab` from the same lockstep release when using collab, and pin the chosen version in the application's lockfile. Placeholder versions are not usable releases. See the [release runbook](release.md) for publication checks.

## Public entry inventory

The source exports 17 agent-kit entries and three collab entries (20 in total). Imports use public subpaths; there is no root entry or supported deep import into internal context packages.

| Entry | Main API | Calling style |
| --- | --- | --- |
| `@rivus/agent-kit/providers` | `Provider`, `builtinProviders` | Plain service descriptors |
| `@rivus/agent-kit/catalog` | `isBuiltinCodingAgentId`, `Result`, `ok`, `err`, `AgentKitError`, `isAgentKitError` | Plain, pure |
| `@rivus/agent-kit/platform` | `Platform` (type only) | Plain |
| `@rivus/agent-kit/node` | `createNodePlatform` | Plain, Node |
| `@rivus/agent-kit/platform/effect` | `PlatformService` | Effect service |
| `@rivus/agent-kit/node/effect` | `NodePlatformLive` | Effect Layer, Node |
| `@rivus/agent-kit/sessions` | `listSessions`, `isSessionHead`, `sessionAdapterHome`, `SessionAdapter` | Plain, platform argument |
| `@rivus/agent-kit/transcript` | `loadTranscript`, `summarizeSession`, `Transcript`, `TranscriptEvent` | Plain; IO takes a platform |
| `@rivus/agent-kit/transcript/usage` | `scanUsage`, `isUsageRecord`, `noCacheInputTokens`, `UsageRecord` | Plain, no imports; IO takes a platform |
| `@rivus/agent-kit/cost` | `createPricing`, `summarize`, `Pricing` | Plain, pure, no imports |
| `@rivus/agent-kit/discovery` | `detectAgents`, `versionFromOutput`, `ProbeRecipe` | Plain, platform argument |
| `@rivus/agent-kit/harness/events` | `readHookEvent`, `builtinHookDialects`, `LifecycleEvent` | Plain, synchronous, no IO or imports |
| `@rivus/agent-kit/harness` | `planInstall`, `applyInstall`, `verify`, `uninstall`, `inventory`, `doctor`, `discardPlan`, `HarnessLive` and port Layers | Effect |
| `@rivus/agent-kit/acp` | `connectAgent`, `probeAgent`, `agentEnv`, binding store Layers | Effect; connections and turns use caller Scopes |
| `@rivus/agent-kit/redact` | `redact`, `redactText` | Plain, pure |
| `@rivus/agent-kit/testing` | `createMemoryPlatform`, `sessionAdapterConformance`, `hookDialectConformance`, `probeRecipeConformance` | Test helpers, Node |
| `@rivus/agent-kit/testing/effect` | `aggregateRepositoryConformance` | Test helpers, Effect |
| `@rivus/agent-kit-collab/process-lock` | `acquireProcessLock`, `isProcessLockHeld` | Plain, platform argument |
| `@rivus/agent-kit-collab/lease` | `createLeaseManager`, `LeaseRepository`, `sqliteLeaseRepository`, `fileLeaseRepository`, `memoryLeaseRepository` | Effect |
| `@rivus/agent-kit-collab/lanes` | `createLanes` | Effect, process-local |

The packages are ESM only, have no import-time side effects, and require Node.js 22.13 or later for their Node adapters. Repository development uses Node 24. Browser-safe entries still need the caller's implementation of the relevant platform ports; browser bundling does not provide a filesystem or a process runner. `/node`, `/node/effect` and `/testing` are the Node-only exceptions.

Provider overrides use `providers?: readonly Provider[]`, imported from `@rivus/agent-kit/providers` alongside
`builtinProviders`. Replace `adapters`, `dialects`, `recipes` and `profiles` with descriptors such as
`{ id: "my-agent", sessions: adapter }` or `{ id: "codex", hooks: dialect }`. Each service merges independently;
other services for the same id and all other agents keep their defaults. A supplied identity carries aliases and
fallback homes. Harness `agents` filters still match exact ids, without alias or case resolution. Conflicting names
and mismatched identity ids are rejected. Resolve a session or usage service's home with
`sessionAdapterHome(service, { home, env }, { providers })`; it uses the service's own home rule or the merged
identity fallback. Omit the third argument for built-in identities.
The three service conformance suites come from `/testing`.
`sessionAdapterConformance(adapter, fixtures)` takes only a session adapter and its fixtures.
`hookDialectConformance(dialect, fixtures, { providers }?)` binds built-in hooks and accepts provider overrides
for host-marker checks. `probeRecipeConformance(recipe, samples?, { providers }?)` binds built-in identities
and accepts provider overrides for identity checks. `aggregateRepositoryConformance(fixtures)` comes from
`/testing/effect`, takes repository fixtures and has no provider option.

## Application Comparison Before Release

For a release with breaking changes, compare each consuming application's typecheck and tests against the
previous published release and local tarballs of the candidate before merging the release PR. Use the same application revision,
inputs and commands for both runs. Applications on older kit versions may already fail against the baseline:
record those failures separately. Every candidate-only error must be explained by the API changes of the release, which its
CHANGELOG records; investigate any other difference
before releasing. Capture exact revisions, package inputs, commands and outcomes in the release evidence.

After publication is verified, open the applications' upgrade PRs and wait for their own CI. Passing kit checks,
retiring a design document and publishing a release do not establish application adoption. The
[release runbook](release.md#cutting-a-release) keeps the order of these gates.

## Choose the runtime boundary

Plain applications create one platform with `createNodePlatform()` and pass it to the APIs they use. Check `Result.ok` and handle failures by `error._tag`, and handle failure items from asynchronous listings and usage scans. `detectAgents` returns one `Installation` per agent with per-agent problems, rather than a call-level `Result`. An aborted plain IO call rejects with `signal.reason`.

Effect entries need the host to install `effect` at exactly the version in `peerDependencies.effect`. Read it with `npm view @rivus/agent-kit peerDependencies.effect` (or `npm view @rivus/agent-kit-collab peerDependencies.effect` for collab); when adopting an older release, append `@<version>` to the package name in the query. Align the host's lockfile and verify it resolves one Effect copy. Plain entries do not need Effect. Hooks import `/harness/events` directly and must not import setup or a barrel that reaches `/harness` or Effect. The no-import guarantees of `/harness/events`, `/transcript/usage` and `/cost` allow an editor or hook bundle to include only the required entry; they do not mean that installing the full npm package has no dependencies. `/node` and `@rivus/agent-kit-collab/process-lock` bundle `zod/mini`, so loading them does not load the zod package. zod stays a dependency of both packages because their other entries import it.

The application runs Effects at its assembly root. A one-shot setup command uses `Effect.runPromiseExit` and translates failure into its CLI exit code. A long-lived server owns a `ManagedRuntime`, runs callback Effects explicitly and observes their failures. An existing Effect application composes Layers and Scopes directly. The kit does not provide a Promise facade or run its own Effects.

For harness, provide `HarnessLive.pipe(Layer.provideMerge(NodePlatformLive))`, or substitute `Layer.succeed(PlatformService, createNodePlatform({ env, home }))` for an explicit test environment. The retained `PlatformService` is needed by the use cases as well as the harness port adapters. For a lease repository, use the same pattern, such as `sqliteLeaseRepository({ path }).pipe(Layer.provideMerge(NodePlatformLive))`. Do not supply a platform with `Layer.mergeAll` alone and expect it to feed another Layer in that group.

ACP programs use `connectAgent` with the platform service. Provide the platform to its program and keep the connection in a Scope that lasts as long as its sessions. With `sessionKey`, also provide `MemorySessionBindingStoreLive` or `FileSessionBindingStoreLive(path)`. `FileSessionBindingStoreLive` requires the platform; compose it with `provideMerge`. Without session keys, no binding store is needed. The caller chooses the explicit environment, permission callback and file access policy.

## Migration steps

### Editor plugin

Bundle `/transcript/usage` and `/cost` directly, supply the needed platform ports, and inject prices. Verify the output imports no runtime package or Node built-in the editor cannot provide. Keep the plugin's UI, reporting windows, persistence and price distribution policy. Test decoded totals and absent values with its existing fixtures.

### Host application

Adopt `acquireProcessLock` for a single instance and `/redact` with the trace viewer's policy. Start two instances and verify the second is refused; verify recovery after the holder exits. Optionally replace the ACP loop with `connectAgent` and compose the real platform/binding Layers and Scopes. Keep the application's transport, background policy and MCP bridge.

## Verification and rollback

Each adoption PR records the chosen package version, the imported entries, exact application commands and their outcomes, old/new behavior comparisons, generated bundle checks and any skipped real-agent smoke. An installed package or delivered instruction is not evidence that adoption passed. Remove old code only after the replacement's behavior is covered.

Run installation tests with an explicit isolated `HOME` and environment. Confirm target files against the ledger after plan/apply/verify, confirm comments and unrelated settings survive, test failed steps and interruption recovery, and use `doctor` to look for old/new duplicate hooks. Do not run the migration's installer against an actual user home as part of ordinary kit verification.

Roll back by reverting an application's adoption PRs, latest first. Reverting a PR that installs nothing on users' machines needs no further step; a PR that installs through harness follows the downgrade order below. Preserve a compatible prior dependency lockfile and state. New persistent stores need a reviewed state migration or separate path; do not assume their schemas match the application's old stores.

When migrating an install made by a release older than the kit's ledger, run that release's own uninstall first. Use `uninstall(owner, { agents, legacyMarkers })` for legacy cleanup only before installing the new release, because it also removes the owner's ledger-recorded entries, and run `doctor({ owner, agents, markers })` with the old command markers and the current hook command afterwards to report what remains.

Harness downgrade order is mandatory: use the new version to `uninstall` its owner, inspect the report and any kept user-edited artifacts, run `verify` and `doctor` to establish that no new/legacy duplicate hook remains, then install the old application and run its old setup. Re-running old setup while the new plugin still exists can fire every event twice. Test `new install → new uninstall → old install/setup` under an isolated home and count one invocation per event. If uninstall reports kept artifacts, resolve them deliberately before enabling old setup. Never downgrade by deleting the ledger or blindly replaying a failed apply.

## Known limits and open acceptance

- Harness's built-in adapters support user scope, hooks and skills. MCP-server and instructions specs have no built-in strategy and fail with `StrategyUnavailable`; project scope is unsupported by built-in use cases.
- Ledger writes require `platform.sqlite` with the default `SqliteLedgerLockLive`, or a caller-supplied lock with equivalent ownership guarantees. Unknown ledger versions are refused. Local state directories only; shared configuration writers outside the ledger lock can still race the final write, with no atomic CAS guarantee.
- Cursor hooks and Claude Code's skills-dir plugin still need real-agent checks. The Cursor permission-gate issue remains application acceptance work. Codex plugin registration/cache upgrades and removal without its CLI have synthetic coverage but still need a real workflow check, including stable trust on upgrade.
- Multiple agents sharing a skill name are not deduplicated. Review the resulting plan rather than assuming one shared installation.
- Usage decoding supports Claude Code, Codex, Gemini CLI, Grok, opencode and Pi; full session/transcript adapters cover Claude Code, Codex and Grok. Cursor has hook support but no usage decoder. An installed agent is not evidence of every capability.
- A running source may keep unfinished usage until it is quiet for 30 minutes; unknown or missing usage stays absent. opencode usage needs SQLite. Login known only to a system credential store such as Keychain can remain `unknown` in file-based discovery.
- ACP's Gemini flag and Grok system-prompt `_meta` location have unverified profile warnings. The live smoke suite is manual; record its results before accepting an upstream program. Tests against a fake agent establish protocol and cleanup behavior, not every upstream program's compatibility.
- File session bindings are atomically replaced but are not locked across processes. Lanes are process-local and persist no queue. Process locks and leases require local directories on darwin/linux and all contenders to see the same process table; NFS and containers with incompatible PID namespaces are outside their guarantee. The no-SQLite lock-file fallback has documented empty-stamp crash/stall limits.
- Releases remain 0.x; a minor version can change the API. A source-ready entry must not be adopted from an older published package that does not export it.
