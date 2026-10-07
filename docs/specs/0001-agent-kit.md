# Spec 0001: agent-kit public entries

## Status

Accepted (the 0.1.0 entries, `/harness/events`, `/platform/effect`, `/node/effect` and `/discovery` are implemented; entries marked as planned are not yet)

Paired Plan: [docs/plans/0001-agent-kit.md](../plans/0001-agent-kit.md)

## Problem And Scope

Applications that work with third-party coding agents (agent-presence, agent-task-loop, a trace viewer, an editor plugin, an Effect-based host application) each keep their own copy of agent facts: agent ids, home directories, log layouts, usage rules, hook dialects. The copies cover different agents and have started to disagree (plan 1.2). `@rivus/agent-kit` gives them one place for each kind of agent knowledge (plan 1.3):

| Knowledge | Owner entry |
| --- | --- |
| Identity and home directories | `/catalog` |
| What an agent stores and how to read it | `/sessions`, `/transcript`, `/transcript/usage` |
| What can be extended and how to install it | `/harness`, `/harness/events` |
| What is installed on this machine | `/discovery` |
| How to drive an agent | `/acp` |

Included in 0.1.0: the observable behavior of `/catalog`, `/platform`, `/node`, `/sessions`, `/transcript` and `/testing`, with built-in session support for Claude Code, Codex and Grok.

Included after 0.1.0: `/harness/events` (P3a), with hook dialects for Claude Code, Codex, Cursor, Gemini CLI, Grok, opencode and Pi; `/discovery` (P4), which detects 27 agents, with an identity for each in `/catalog`.

Included as planned behavior: `/transcript/usage` and `/cost` (P2), `/harness` (P3), `/redact` and `@rivus/agent-kit-collab`'s `/lease` and `/process-lock` (P5), `/acp` and collab's `/lanes` (P6). These entries do not exist in 0.1.0. Their sections record the behavior the plan has already decided; each phase revises this Spec before it starts if the behavior changes.

Excluded: application state and policy (presence's online state, agent-task-loop's Task/Run, a viewer's turn tree, timeline, context reconstruction and UI fields); price data; an in-session MCP tool server; daemons and durable queues; Promise facades over Effect entries; a global adapter registry.

## Behavioral Requirements

### All entries

- Plain TS entries must expose functions and plain data. Stateful parts are created by factory functions. The only public class is `AgentKitError` (`code` + `cause`); it is recognized through a `Symbol.for` brand, so a check succeeds even when several copies of the kit are installed.
- A plain TS entry must return a `Promise` for a single result and an `AsyncIterable` for sessions, events and usage. Leaving a `for await` loop (`break`) cancels the iteration. Every function that does IO accepts `{ signal?: AbortSignal }`.
- Expected outcomes must be returned as values, `{ ok: true, value } | { ok: false, error }`, where `error` carries a `_tag`; a Promise-returning entry resolves to such a value. An abort rejects with `signal.reason`, and only defects throw.
- A plain TS entry takes the platform, or the part of it that it uses, as its first parameter. There is no kit object bound to a platform.
- Each context that has per-agent behavior defines its own adapter interface with a version literal (`specificationVersion`), exports a `builtinXxx: Record<CodingAgentId, XxxAdapter>` table, and accepts an `adapters` option that overrides or extends it for one call. An agent supports a capability exactly when the context's table has an adapter for it. A caller that asks for an unsupported capability by name (such as `listSessions({ agents })`) gets an `AgentKitError` with code `capability-unsupported` thrown; a stored ref that names such an agent yields a `CapabilityUnsupported` value.
- Only Effect entries (`/platform/effect`, `/node/effect`, and the planned `/harness` and `/acp`) may depend on `effect`. No other entry may reach it, in either its module graph or its published `.d.ts` graph, so a consumer that never installs `effect` can import and type-check every other entry.
- `/catalog`, `/platform`, `/platform/effect`, `/sessions`, `/transcript`, `/discovery` and `/harness/events` must be browser-safe: bundling them for a browser target pulls in no `node:*` module or Node builtin. `/node`, `/node/effect` and `/testing` are exempt.

### `/catalog`

- Exports `CodingAgentId`, `BuiltinCodingAgentId`, `CodingAgentIdWithHome`, `parseCodingAgentId`, `isBuiltinCodingAgentId`, the identities of the built-in agents (`builtinCodingAgents`, `CodingAgent`, `CodingAgentWithHome`), `AgentHome`, `HomeRule`, `resolveHome(id, { env, home })`, `homeFromRule`, `Result`, `ok`, `err`, and `AgentKitError` with `isAgentKitError`.
- Every agent that a context supports has an identity: an id, a display name and its aliases. A home rule is part of the identity only when upstream sources or the agent's documentation confirm it; `resolveHome` takes the ids that have one (`CodingAgentIdWithHome`), and for any other agent `builtinCodingAgents[id].home` is absent.
- A `CodingAgentId` has documented aliases (for example `claude` for `claude-code`); an alias identifies the same agent as its canonical id.
- `resolveHome` is pure: it reads only the `env` and `home` it receives. It honors the agents' home overrides (`CLAUDE_CONFIG_DIR`, `CODEX_HOME` for Codex and the Codex app, `GEMINI_CLI_HOME`, `XDG_DATA_HOME` for opencode, `GROK_HOME`, `PI_CODING_AGENT_DIR`, `CLINE_DIR`, `CODEBUDDY_CONFIG_DIR`, `COPILOT_HOME`, `KIMI_SHARE_DIR`, `KIRO_HOME`, `OPENHANDS_PERSISTENCE_DIR`, `QODER_CONFIG_DIR`; Neovate has none), otherwise returns the agent's default directory under `home`, and reports which of the two set the path.
- `catalog` holds identity, home directory rules and `Result` only. Log layouts, hook dialects, ACP launch details and probe methods belong to the context that uses them.
- Built-in identities: the 27 agents that `/discovery` detects. `cursor` (alias `cursor-agent`) has no home rule: Cursor uses `CURSOR_CONFIG_DIR`, then `$XDG_CONFIG_HOME/cursor`, then `~/.cursor`, which one HomeRule cannot express.

### `/platform`

- Exports the `Platform` port type, `ProcessIdentity` and the other port types, and the byte-stream line splitter. `@rivus/agent-kit-collab` takes these types from here.
- `Platform` provides `env`, `home`, `os`, `fs` (`stat`, `realpath`, `list`, `read`, `writeAtomic`, `createExclusive`, `rename`, `remove`), `process` (`run`, `spawn`, `self`, `identify`), `clock` (`now`, `monotonic`) and an optional `sqlite`, with the shapes in plan 3.2.
- `fs.stat` does not follow symlinks unless `followSymlinks: true` is passed, and returns `undefined` for a missing path. `fs.realpath` returns `undefined` when the target does not exist. `fs.read` returns `AsyncIterable<Uint8Array>`, optionally limited to a byte range.
- The line splitter turns `AsyncIterable<Uint8Array>` into lines, each with its byte offset, byte length and 1-based line number. It handles CRLF line endings, a final line without a newline, and multi-byte UTF-8 characters split across chunks.

### `/node`

- Exports `createNodePlatform({ env?, home? })`, the Node implementation of `Platform`. Without arguments it uses the current process environment and the OS home directory; `env` and `home` replace them (for example a temporary `HOME` in tests).
- `process.spawn` passes only the `env` it is given and never inherits the parent environment. When its `signal` aborts, the child receives `SIGTERM`, then `SIGKILL` after a grace period. `stdin`, `stdout` and `stderr` are Web Streams.
- `process.self` is the identity of the current process (`host`, `bootId`, `pid`, `startTime`). `process.identify(pid)` returns `undefined` when no process has that pid; when the pid was reused, its `startTime` differs from the recorded identity.
- `/node` and its Effect counterpart `/node/effect` are the only entries that bind to Node.

### `/platform/effect` and `/node/effect`

- `/platform/effect` exports `PlatformService`, the `Context.Service` keyed `@rivus/agent-kit/platform/Platform/v1` whose value is the plain `Platform`. Effect entries read the platform from it.
- `/node/effect` exports `NodePlatformLive`, a Layer that provides `PlatformService` with `createNodePlatform()`, called when the Layer is built. An application that needs another `env` or `home` provides `Layer.succeed(PlatformService, createNodePlatform({ env, home }))`.
- Both require the host to install `effect` itself, at the exact version of the kit's optional peer (4.0.1). The kit resolves the host's copy and ships none of its own.

### `/sessions`

- Exports `listSessions(platform, opts)`, the sessions adapter table `builtinSessionAdapters` and `isSessionHead`, with the types `SessionAdapter`, `SessionAdapters`, `SessionPlatform`, `DiscoverOptions`, `LoadOptions`, `ListSessionsOptions`, `SessionRef`, `SessionHead`, `SessionListFailure`, `SessionListError` and `SessionErrorCode`. A `SessionAdapter` carries `specificationVersion: 'sessions-v1'`. Helpers for writing an adapter stay internal until a consumer outside the kit needs them.
- `listSessions` uses only `fs.list`, `fs.stat`, `fs.read`, `env` and `home`. It accepts `agents`, `adapters`, `signal` and `onTotal`, and yields one item per session: a `SessionHead`, or `{ ref, error }` when a root is missing (`RootMissing`) or a directory or a session cannot be read (`ReadFailed`, the same tag as for reading a session). One unreadable session does not end the listing.
- A `SessionRef` carries its `CodingAgentId`, so later calls route to the right adapter without the caller naming the agent again.
- Claude Code sessions are found under the Claude home (honoring `CLAUDE_CONFIG_DIR`). Codex sessions are found under the Codex home (honoring `CODEX_HOME`), including archived sessions.
- Listing reads at most 128 KB of each file (a head and tail preview), whatever the file's size.
- 0.1.0 ships built-in session adapters for `claude-code`, `codex` and `grok`.

### `/transcript`

- Exports `loadTranscript`, `summarizeSession`, `foldTranscript`, `readOriginal`, the per-agent translation functions (`translateClaudeCodeRecords`, `claudeCodeUsage`, `CLAUDE_CODE_CAPABILITIES`, and the same for each built-in agent), the rules a viewer needs to interpret events (`mainAgentId`, `laneOf`, `isPrompt`, `recordKey`, `promptStarts`, `requestUsage`, `shadowedIn`, `MAIN_LANE_ID`, `promptSnapshot`, `latestSnapshot`, `snapshotHasSystemPrompt`, `snapshotHasTools`), `CAPABILITIES`, `TRANSCRIPT_EVENT_KINDS`, `SESSION_SUMMARY_VERSION`, and the types of the transcript model. Translation functions are pure and need no platform.
- `loadTranscript`, `summarizeSession` and `readOriginal` resolve to a `Result`. `loadTranscript` merges all files of a session, returns the skipped records and reports progress. Without an agent in the ref, each adapter's `detect` decides. Its failures are `SessionNotFound`, `CapabilityUnsupported` (the ref names an agent without an adapter), `NoAdapterAccepted` (no adapter recognized the file), `UnknownFormatGeneration` and `ReadFailed` (an IO error such as a permission error); `readOriginal` fails with `SourceChanged`, `SessionNotFound` or `ReadFailed`. A `SessionAdapter`'s `load` and `summarize` return the same `Result` shape. `streamEvents` and a resume position are not in 0.1.0: compaction marks earlier events after they were read, so events cannot be final before the whole session is read.
- `TranscriptEvent.kind` is one of `user`, `assistant`, `reasoning`, `tool_call`, `tool_result`, `request`, `system`, `compaction`, `hook`, `unknown`. A record whose type the adapter does not recognize becomes an event of kind `unknown`. Model reasoning is `reasoning` (never `thinking`), and the stop reason of a request is `finishReason` (never `stopReason`).
- A `request` payload may also carry `granularity` (`request`, `turn`, or `session`), `modelCalls`, and `usageByModel`. Each `usageByModel` entry has `usage` and may have `modelCalls`. Grok sets `granularity` to `turn` from `turn_completed.usage`. In 0.1.0 an agent's own cost units, including Grok's `costUsdTicks`, stay on the original record.
- Events form a flat list and reference each other through `agentId`, `parentId`, `requestId`, `callId` and `shadowedBy`. The session also has an `agents[]` list in which each subagent records its `parentId` and `spawnEventId`. `spawnEventId`, when set, names a `tool_call` or `system` event on the parent lane. Translation sets these references; consumers do not need to understand agent log formats to follow them.
- Every source record is accounted for: it becomes one or more events or is recorded as skipped. A line that cannot be parsed is skipped, not a failure. An unrecognized format generation is a failure with the `UnknownFormatGeneration` `_tag`.
- Event ids are unique within a session, and reading the same files again yields the same ids in the same order. `seq` orders the events. Every `tool_result` is paired with its `tool_call` through `callId`, or marked orphan. Events replaced by a compaction carry `shadowedBy`.
- Every event has a source pointer (file, byte offset, byte length, line number); reading those bytes returns the original record.
- Usage numbers exposed by `/transcript` follow the `Usage` interface definition in plan 3.11: input includes cached tokens, output includes reasoning, and a missing value stays missing instead of becoming 0.
- Turn trees, timelines, context reconstruction, truncation of long text, prompt deduplication and source file numbering are not part of `/transcript`.

### `/harness/events`

- Exports `readHookEvent(agent, payload, env, { adapters }?)`, `builtinHookDialects`, `reduceLifecycle`, `lifecycleStatus`, `heartbeatSignal` and `INITIAL_LIFECYCLE_STATE`, with the types `LifecycleEvent` (and its `LifecyclePhase`, `LifecycleScope`, `LifecycleOutcome`, `LifecycleBlocker`, `TerminalHost`, `TerminalIdentity`, `LifecycleMapping`), `LifecycleState` (with `BlockSource`), `LifecycleStatus`, `LifecycleClock`, `HeartbeatSignal`, `ReadHookEventOptions`, and the dialect types `HookDialect`, `HookDialects`, `HookEventSpec`, `HookOutput`, `HookTimeout`, `ForeignHooks`, `PayloadFields`, `FieldSource`, `FieldPath` and `LifecycleSwitch`.
- The entry is synchronous, does no IO and has zero dependencies: its built files and chunks import no npm package and no Node built-in, so a hook process loads only this entry. Payload fields are read with `typeof` checks, not a validation library.
- `readHookEvent` returns a LifecycleEvent with `agent`, `phase` (`start`, `activity`, `blocked`, `finish`, `unknown`), `nativeEvent` (the event name as the payload carried it, or `""`) and, when the payload has them, `scope` (`session` or `turn`), `outcome` (`completed`, `failed`, `cancelled`), `blocker` (`permission`, `question`, `elicitation`), `turnId`, `subagent` (`id`, `type`), `tool` (`name`, `callId`), `sessionId`, `cwd`, `transcriptPath` and `terminal`. A field the payload does not carry is absent. Tool arguments are never copied.
- The reported agent is the real source. Payload evidence decides: a payload with `hookEventName` means Grok (every Grok payload carries it), one with `cursor_version` means Cursor. The environment is inherited (Grok sets `GROK_SESSION_ID` for every MCP server it starts), so `GROK_SESSION_ID` never names Grok, and `env.CURSOR_VERSION` names Cursor only when the declared agent is one whose hooks Cursor runs (Claude Code), because what Cursor sends to those hooks is undocumented. Otherwise it is the declared agent. The payload is then read with that agent's dialect, which also understands the other agent's event names it runs (Cursor reads Claude Code's `PreToolUse` as its `preToolUse`).
- `terminal` comes from the environment, the first set of `HERDR_PANE_ID` (herdr), `CMUX_SURFACE_ID` or `CMUX_PANEL_ID` (cmux), `SUPERSET_TERMINAL_ID` or `SUPERSET_PANE_ID` (Superset), `TMUX_PANE` (tmux).
- A payload of an unknown shape, or an event the dialect does not map, reads as phase `unknown`; `readHookEvent` never throws because of its payload or environment. Naming an agent that has no dialect, in the built-in table or in `adapters`, throws an `AgentKitError` with code `capability-unsupported`.
- `subagent` is set on a subagent's own start and stop and on every event the agent reports from inside a subagent.
- `reduceLifecycle(state, event, { ttlMs, now })` returns the next `LifecycleState`, whose `status` is `idle`, `working`, `blocked` or `unknown`. A turn start moves to `working`, activity to `working`, a blocker to `blocked`, any end to `idle`. A session start only moves `unknown` or `idle` to `idle`: it can arrive after the first prompt, never ends a running turn, and its own turn id (Cursor sends one) is not a turn. An event naming a turn that already ended or was superseded is dropped; an unseen turn id is a new turn. Without turn ids, only a turn start leaves `idle`. Subagent events keep a busy session alive without changing its status, except that a subagent's permission request makes a session that is not `idle` `blocked` (the dialog is shown to the user). The state records who raised each open block (`blockedBy`, each source once: the main agent, or a subagent by id). Main-agent activity closes only the main agent's own block; a subagent's block closes on a later event of the same subagent (its stop included) or when the main turn starts or finishes; a sibling subagent's activity closes none. A block from a subagent without an id cannot be matched and is left to the TTL: while it is open, subagent events do not count as signs of life. `lifecycleStatus(state, { ttlMs, now })` reads `working` and `blocked` as `unknown` once no event arrived within the TTL.
- `heartbeatSignal(before, after, event)` takes the session's state before and after `reduceLifecycle` folded the event. It returns `start` for a turn start and for any main-agent event that makes a session busy that was not (a turn whose start hook was lost), `heartbeat` for activity and blockers while the session stays busy, `finish` for any end, and nothing for a session start, an unknown event or a late event of an ended or superseded turn. A subagent event, whose payload can carry the parent's session id, never starts or finishes the session; it only beats while the session is busy.
- Each `HookDialect` carries `specificationVersion: 'harness-v1'` and records the agent's hook facts: how hooks are delivered (`command` or an in-process `plugin` that forwards each event), the timeout unit (`seconds` for Claude Code, Codex, Cursor and Grok, `milliseconds` for Gemini CLI, none for plugins), the payload field paths, each native event's LifecycleEvent mapping and aliases, which events are permission gates, how exit codes and stdout are read (including where plain text becomes model context, as on Codex's `SessionStart`, `UserPromptSubmit` and `SubagentStart`) and what an observing hook prints (`passThrough`), the trust model, and the other agents' hooks it runs (Grok runs Claude Code's and Cursor's; Cursor runs Claude Code's). A fact the agent's documentation does not confirm carries an `unverified` note.

### `/discovery`

- Exports `detectAgents(platform, opts)`, the probe recipe table `builtinProbeRecipes`, the rules `classifyInstallation`, `resolveAuthState` and `versionFromOutput`, `DETECTION_STATUSES`, and the types `Installation`, `Evidence`, `DetectionStatus`, `AuthState`, `AuthSource`, `Version`, `ProbeProblem`, `ProbeRecipe`, `ProbeRecipes`, `ProbePath`, `CredentialFileProbe`, `AuthVariable`, `DiscoveryPlatform` and `DetectAgentsOptions`. A `ProbeRecipe` carries `specificationVersion: 'discovery-v1'`.
- `detectAgents` uses only `env`, `home`, `os`, `fs.stat`, `fs.read` (credential files) and `process.run`. It accepts `agents` (ids or aliases), `recipes`, `signal`, `timeoutMs` (per probe command, default 5 seconds), `versionProbe` (default `true`) and `authProbe` (`files` by default, or `commands`), and resolves to one `Installation` per agent, in table order. Naming an agent without a recipe throws `AgentKitError` with code `capability-unsupported`; an abort rejects with `signal.reason` and stops the running commands.
- An `Installation` has the agent's id, display name and kind (`cli`, `app` or `extension`), a `status`, the resolved `command`, the first existing `appPath`, the `version` (the trimmed output and its first dotted number), the login state `auth`, the `evidence` behind the status (command on `PATH`, version output, application path, configuration path, MCP configuration path, in that order), the `problems` of checks that could not complete, and the recipe's `warnings`, which also name the facts upstream sources do not confirm.
- `status` is `runnable` when the version probe succeeded, `found` when any other evidence exists, `missing` when every check completed without evidence, and `unknown` when nothing was found but a check could not complete. A version probe that times out, cannot start (a spawn error with an errno code), prints more than the platform collects (`output-too-large`) or prints nothing it recognizes is a problem; the agent stays `found`. Any other rejection is a defect and rejects `detectAgents`. On Windows a command that is a `.cmd` or `.bat` file, as npm installs agents, is not run, because Node runs those only through a shell and detection runs none: the agent is `found` with a `shell-shim-not-run` problem and a warning.
- Commands are looked up in the absolute directories of `PATH`, in order, as regular files (on Windows with each `PATHEXT` extension, under any spelling of the variable names, with quotes around an entry dropped); empty and relative entries are skipped. A candidate that cannot be checked is a `StatFailed` problem. Platform reports no permission bits, so a non-executable file earlier on `PATH` shadows later ones, and running it is a `start-failed` problem. Probe commands run without a shell, with fixed arguments, the platform's environment, the user's home directory as working directory and a time limit. The version probe runs the agent's own command, so it has whatever effects that command has on start; each recipe lists the known ones in `version.sideEffects` (Codex creates `$CODEX_HOME/tmp/arg0`). With `versionProbe: false` and the default `authProbe`, detection runs nothing and has no side effects, and no agent is `runnable`.
- With `authProbe: 'files'` the login state comes only from credential files and environment variables: a file's existence, or for a file the recipe parses, non-secret facts such as whether any credential is stored (at most 8 MiB is read). Secret values never leave the parser and file content is never reported. With `authProbe: 'commands'` detection also runs each agent's login status command, whose answer wins; the command runs only when its executable is on `PATH` and, if it is the agent's version-probed command, only after the version probe succeeded. Each recipe lists the command's side effects in `auth.command.sideEffects`. Only a status command can report `logged-out`; without an answer the state is `unknown`. Nothing starts a login.
- `builtinProbeRecipes` covers 27 agents: agent-finder's 26 and Grok. It starts from agent-finder's facts and corrects those that upstream sources contradict (for example Kiro CLI's command `kiro-cli`, Command Code's `~/.commandcode`, Copilot CLI's `copilot` and `~/.copilot`, Windsurf's rename to Devin Desktop, the Codex app installed as `ChatGPT.app`, Trae as an application); the parity test lists every corrected fact with its source; paths under a catalog home follow its override variable. Login checks: Claude Code (`oauthAccount` in `~/.claude.json`, `.credentials.json`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`; `claude auth status --json`), Codex (`auth.json`; `codex login status`), Gemini CLI (`oauth_creds.json`, `GEMINI_API_KEY`), opencode (`auth.json`, `OPENCODE_AUTH_CONTENT`), Grok (`auth.json`, `XAI_API_KEY`), Amp (`secrets.json`) and Cursor (the CLI's `auth.json`; `cursor-agent status --format json`).

### `/testing`

- Exports `createMemoryPlatform({ files, commands })`, an in-memory `Platform` (without `process.spawn` and `sqlite`) whose file system holds the given files and whose `process.run` runs the given scripted programs, and the conformance suite of each context that has one: `sessionAdapterConformance`, with `oversizedSession` to build its large sample, `hookDialectConformance` with the types `HookDialectFixtures` and `HookDialectSample`, and `probeRecipeConformance`. Each check is a named function that rejects on failure, so any test runner can run it.
- A scripted program behaves like a spawned one: it runs only while its file exists, a missing program or working directory is `ENOENT`, a file that is not a program is `EACCES`, a `.cmd` or `.bat` file on a Windows platform is `EINVAL`, it gets the platform's environment unless the run gives one, and it honors `timeoutMs` and `signal`.
- The probe recipe conformance suite checks that a recipe names a catalog agent by its canonical id and display name (or a third-party agent by a canonical id), probes bare command names with fixed arguments, names a login command from its own commands and lists that command's side effects, checks only absolute, home-relative or agent-home paths, has version, login and credential file parsers that return a well-formed value or `undefined` for any input, reads its sample outputs and credential files as stated, passes on no value from its login inputs (a canary placed in every string position of the samples never reaches a reading), and that detection on a machine with everything and on an empty machine reports the expected status the same way every time.
- Readers produce the same results on the memory platform as on the Node platform over the same files.
- The hook dialect conformance suite checks a `HookDialect` against sample payloads: it declares `harness-v1`, a command dialect has a timeout unit and output rules, every mapped event (and every case of a field-dependent mapping) resolves to a known phase with consistent `outcome` and `blocker`, every gate event declares its own response format whose `passThrough` is valid for it, foreign event renames point at mapped events, every event has a sample, every sample reads to its expected LifecycleEvent through `readHookEvent`, and probe payloads (wrong types, inherited object keys such as `constructor`, unmapped names) read as phase `unknown` without throwing.
- The sessions conformance suite checks a `SessionAdapter` against sample logs: listing reads at most 128 KB per file, event ids are stable and unique, every record is accounted for, tool results are paired, compaction shadowing holds, references between events and lanes resolve (a `spawnEventId` names an existing `tool_call` or `system` event on the parent lane), source pointers read back, declared capabilities match the output, and summaries equal the folded transcript. Built-in adapters and third-party adapters run the same suite; keeping `node:*` out of adapters is the boundary test's job.

### Planned entries

These entries are not part of 0.1.0. The phase in brackets is the phase in plan 6.3 that ships them.

#### `/transcript/usage` (P2)

- `decodeUsage(platform, agent, file, { since, from })` streams `UsageRecord`s without building a transcript, and can continue from a previous cursor.
- A `UsageRecord` has `granularity` `request`, `turn` or `session`. Per-request data is `request` and carries `model`. An aggregate stays an aggregate (`turn` or `session`) with `modelCalls`; it is never split into invented per-request records. `usageByModel` splits the record's usage and cost by model, and totals take either the record or its split, never both.
- `noCacheInputTokens`, `toAiSdkUsage` and `toOtelAttributes` convert usage for pricing, AI SDK and OTel (`cacheWriteKey` defaults to `cache_creation`).
- Per-agent mapping follows plan 3.11: Claude Code input is input + cache read + cache creation; Codex prefers `last_token_usage` and otherwise takes differences of cumulative values, skipping the replay at the start of a forked session; Grok's turn aggregate is a `turn` record.

#### `/cost` (P2)

- `createPricing(table, { overrides })`, `costOf`, `calendarWindow`, `summarize`, `fromLiteLLM`. The kit ships no price data; the caller injects the table.
- Pricing applies three rules in order: a cost reported by the record (`costSource: 'agent'`) wins; otherwise cost is computed per bucket (non-cached input, cache read, 5-minute cache write, 1-hour cache write falling back to the 5-minute price, output); the result is multiplied by `pricingMultiplier`.

#### `/harness` (P3, Effect)

- `planInstall` returns an InstallPlan handle whose `changes` list each file's diff, the agent commands to run and the expected trust prompts. `applyInstall` re-checks every target before writing and refuses when a target changed after the plan. `verify`, `uninstall` and `inventory` work from the ledger. Layers such as `HarnessLive` provide the ports.
- Injection prefers, in order: launch arguments or ACP session parameters, the agent's native plugin mechanism, a scanned skills directory, and only then an append-only, ledger-recorded, format-preserving edit of shared configuration.
- A plan is rejected as a whole when it has a conflict without an explicit force / adopt / backup choice, and when the ledger changed since the plan was built.
- `uninstall` removes only what the ledger records for that owner, and only when the file still matches what was installed; a user-modified file is kept and reported.
- Every ledger modification happens while one LedgerLock is held. Without `platform.sqlite` and without an injected LedgerLock, ledger modification is refused with `ledger-lock-unavailable`. A ledger with an unknown `schemaVersion` is refused or kept whole, never cleared.
- Concurrent changes by writers that do not take part in the lock may be lost, and such a loss cannot be detected afterwards; the kit promises no CAS for shared configuration files.


#### `/redact` (P5)

- `redact(value, { home })` and `redactText` replace the spellings of the home path and secret keys (such as `sk-`, `ghp_`, `xox*`) in values and text.

#### `/acp` (P6, Effect)

- `connectAgent` starts the agent, completes the handshake and probes login; the connection belongs to the caller's Scope. The connection offers `newSession`, `loadSession`, `prompt` (an event stream), `cancel` and `close`.
- A session runs at most one turn at a time. Permission requests go to the caller's callback and are denied by default. When a cancel does not settle within its deadline (send cancel plus wait for the turn to end), the session binding is invalidated and the process closed. A closed session refuses every operation.
- The event stream yields deltas named after AI SDK stream events (`text-delta`, `reasoning-delta`, `tool-input-*`, `finish`) and completed `TranscriptEvent`s. The child process receives only the environment variables given explicitly.

#### `@rivus/agent-kit-collab` `/lease` and `/process-lock` (P5)

- `/lease` (Effect): `createLeaseManager` with SQLite, file and memory stores; pure rules `isFresh`, `canAcquire`, `nextFencingToken`. A lease has one holder; its generation never decreases, including after release; holder liveness checks pid and start time; expiry uses the observer's monotonic clock. Losing the lease interrupts fenced work. Only local directories are supported.
- `/process-lock`: `acquireProcessLock(path)` is a single-instance lock released when the process exits; a second instance is refused.

#### `@rivus/agent-kit-collab` `/lanes` (P6, Effect)

- `createLanes({ maxConcurrent, maxQueued?, activate })` returns `wake`, `cancel`, `status` and `close`. At most one activation runs per key, repeated wakes for a key coalesce, total concurrency stays within `maxConcurrent`, and the queue is bounded.

## Domain Invariants

- `catalog` contains only agent identity, home directory rules and `Result`.
- An agent supports a capability exactly when that context's adapter table has an adapter for it.
- Usage totals include their breakdowns: `cacheReadTokens` and `cacheWriteTokens` are subsets of `inputTokens`, `cacheWrite1hTokens` is a subset of `cacheWriteTokens`, and `reasoningTokens` is a subset of `outputTokens`. A missing value is absent, never 0.
- Every source record becomes events or a skipped entry; nothing is dropped silently.
- Event references (`agentId`, `parentId`, `requestId`, `callId`, `shadowedBy`, `agents[]`) are set during translation and point to events or agents of the same session.
- Each event's source pointer reads back to its original record.
- Expected failures are values with a `_tag`; only defects throw.
- Detection never reports an agent `missing` while one of its checks could not complete, never reports `logged-out` from anything but the agent's own status command, never runs a status command unless asked to, and never returns a credential's value.
- Aggregate classes never appear in the public surface; aggregates are exposed as handle interfaces and read-only snapshots.
- Planned contexts add their own invariants (plan 3.1 and 3.9): an InstallPlan is immutable and refused when stale or conflicting; ledger revisions strictly increase and an unknown ledger version is never cleared; a lease generation never decreases; an ACP session runs one turn at a time; a lane runs one activation per key.

## Acceptance Examples

### S1: Claude home honors `CLAUDE_CONFIG_DIR`

- Given `env` contains `CLAUDE_CONFIG_DIR=/tmp/claude-config` and `home` is `/u/me`
- When `resolveHome('claude-code', { env, home })` is called
- Then it returns `/tmp/claude-config`; without the variable it returns `/u/me/.claude`

### S2: Codex home honors `CODEX_HOME`

- Given `env` contains `CODEX_HOME=/tmp/codex-home` and `home` is `/u/me`
- When `resolveHome('codex', { env, home })` is called
- Then it returns `/tmp/codex-home`; without the variable it returns `/u/me/.codex`

### S3: An alias identifies the same agent

- Given the alias `claude`
- When it is resolved through `/catalog`
- Then it identifies the same built-in agent as `claude-code`

### S4: Archived Codex sessions are listed

- Given a memory platform with one Codex session under the Codex sessions directory and one under the archived sessions directory
- When `listSessions(platform, { agents: ['codex'] })` runs
- Then both sessions are yielded

### S5: One unreadable session does not stop the listing

- Given two Claude Code session files, one of which cannot be read
- When `listSessions` runs
- Then the readable file yields a `SessionHead`, the other yields `{ ref, error }`, and the iteration completes

### S6: Listing reads at most 128 KB per file

- Given a Claude Code session file of several megabytes
- When `listSessions` runs
- Then the bytes read from that file total at most 128 KB

### S7: Leaving the loop or aborting cancels reading

- Given a listing over many sessions
- When the consumer `break`s out of the loop, or the `signal` aborts
- Then the iteration ends and no further file reads start

### S8: A third-party session adapter is used for one call

- Given a `SessionAdapter` for `my-agent` with `specificationVersion: 'sessions-v1'`
- When `listSessions(platform, { agents: ['my-agent'], adapters: { ...builtinSessionAdapters, 'my-agent': adapter } })` runs
- Then its sessions are listed in the same shape as built-in ones, and a later call without `adapters` does not see `my-agent`

### S9: An unsupported capability throws a branded error

- Given an agent id with no sessions adapter
- When `listSessions` is asked for that agent
- Then it throws an `AgentKitError` with code `capability-unsupported`, and the brand check recognizes it even when it was created by another copy of the kit
- And `loadTranscript` for a ref that names that agent resolves to `{ ok: false, error: { _tag: 'CapabilityUnsupported', agent } }`

### S10: An unreadable line is skipped

- Given a Claude Code JSONL file with one malformed line between valid lines
- When `loadTranscript` reads it
- Then the valid lines become events, the malformed line is listed as skipped with its source pointer, and no error is reported

### S11: An unknown format generation is an error

- Given a session file written in a format generation the adapter does not recognize
- When `loadTranscript` reads it
- Then it resolves to `{ ok: false, error }` with the `UnknownFormatGeneration` `_tag`, the file and the line, instead of skipping every line

### S12: An unrecognized record type becomes `unknown`

- Given a record in a known format whose event type the adapter does not recognize
- When it is translated
- Then the event has kind `unknown` and its source pointer reads back to the record

### S13: Community names are used

- Given a Claude Code assistant message with a thinking block and a model response with a stop reason
- When they are translated
- Then the thinking block becomes an event of kind `reasoning`, and the `request` event exposes `finishReason` and no `stopReason`

### S14: Tool results are paired or marked orphan

- Given a `tool_call` with `callId` `c1`, a `tool_result` for `c1`, and a `tool_result` for `c2` without a call
- When the session is translated
- Then the first result pairs with `c1` and the second is marked orphan

### S15: Compaction shadows the events it replaces

- Given a session that was compacted
- When it is translated
- Then the events replaced by the compaction carry `shadowedBy` pointing to it

### S16: Subagent references are set

- Given a Claude Code session that spawned a subagent
- When it is translated
- Then the subagent's events carry its `agentId` and `parentId`, and the session's `agents[]` lists the subagent with `parentId` and `spawnEventId`

### S17: Source pointers read back

- Given any event produced by a built-in adapter
- When the bytes at its source pointer's offset and length are read from its file
- Then they are exactly the original record

### S18: Multi-file sessions merge

- Given a session whose records span several files
- When `loadTranscript` runs
- Then the result contains the events of all files in `seq` order (resuming from a position is not in 0.1.0)

### S19: The memory platform matches the Node platform

- Given the same sample logs in `createMemoryPlatform({ files })` and in a temporary directory read through `createNodePlatform({ home })`
- When `listSessions` and `loadTranscript` run on both
- Then the results are equal

### S20: Browser-safe entries pull in no Node module

- Given browser-target bundles of `/catalog`, `/platform`, `/sessions` and `/transcript`
- When the bundles are built
- Then they contain no `node:*` module or Node builtin

### S21: Plain entries work without Effect

- Given a consumer project that installs the packed kit but not `effect`
- When it imports and type-checks every entry except the Effect entries
- Then npm has not installed `effect`, both steps succeed, and neither the module graph nor the `.d.ts` graph of any of those entries reaches `effect`

### S22: The line splitter keeps bytes and line numbers exact

- Given chunks that split a multi-byte UTF-8 character, use CRLF endings and end with a line that has no newline
- When the line splitter reads them
- Then every line has the right text, byte offset, byte length and 1-based line number, and the last line is returned

### S23: The Node platform takes overrides

- Given `createNodePlatform({ env: { CODEX_HOME: dir }, home: tmp })`
- When Codex sessions are listed with it
- Then `platform.env` and `platform.home` are the given values and sessions are read from `dir`

### S24: Spawned processes get only the given environment

- Given a parent process whose environment contains `SECRET=1`
- When `platform.process.spawn` starts a child with `env: {}`, and the `signal` later aborts
- Then the child does not see `SECRET`, receives `SIGTERM`, and receives `SIGKILL` if it is still running after the grace period

### S25: File checks do not follow links by default

- Given a symlink and a missing path
- When `fs.stat` is called on the symlink without options, and `fs.realpath` on the missing path
- Then `stat` reports kind `symlink`, and `realpath` returns `undefined`

### S26 (planned, P2): Claude usage includes cache in input

- Given a Claude Code record with input 10, cache read 100, cache creation 5 and output 7 tokens
- When `decodeUsage` decodes it
- Then `inputTokens` is 115, `cacheReadTokens` 100, `cacheWriteTokens` 5, `outputTokens` 7, and `noCacheInputTokens` returns 10

### S27 (planned, P2): Codex usage prefers the last request and skips fork replay

- Given a forked Codex session that replays the parent's records and then reports `last_token_usage`
- When `decodeUsage` decodes it
- Then the replayed records are skipped and each request uses `last_token_usage`

### S28 (planned, P2): Aggregates are not split

- Given a Grok `turn_completed.usage` covering three model calls with a per-model breakdown
- When `decodeUsage` decodes it
- Then one record with `granularity: 'turn'`, `modelCalls: 3` and `usageByModel` is produced, and a summary counts its tokens once

### S29 (planned, P2): Pricing rules apply in order

- Given one record with an agent-reported cost and one without, and a pricing multiplier of 2
- When `costOf` prices them
- Then the first uses the reported cost, the second uses the bucket formula, and both are multiplied by 2

### S30: Hook events name the real source

- Given a payload with `hookEventName` registered for Claude Code, a Claude Code payload with only an inherited `GROK_SESSION_ID`, and a Codex payload with `CURSOR_VERSION` in the environment
- When `readHookEvent` reads each with its declared agent
- Then the first returns synchronously with `agent` set to Grok, the second keeps `claude-code`, and the third keeps `codex`, because Cursor does not run Codex's hooks

### S31: Late events from older turns are ignored

- Given turn 1 started, then turn 2 started and finished, followed by a late `activity` event for turn 1
- When `reduceLifecycle` folds them
- Then the status stays `idle`

### S32 (planned, P3): A stale or conflicting plan is refused

- Given a plan built at ledger revision 4, or a plan with an unresolved conflict
- When `applyInstall` runs after the ledger moved to revision 5, or without a force / adopt / backup choice
- Then nothing is written and the plan is refused

### S33 (planned, P3): Uninstall keeps user-modified files

- Given an installed artifact that the user edited afterwards
- When `uninstall(owner)` runs
- Then the artifact is kept and reported as user-modified

### S34 (planned, P3): Only one writer modifies the ledger

- Given two processes applying at the same time
- When one holds the LedgerLock and is then killed
- Then only one enters the critical section at a time, and the other acquires the lock immediately after the kill and probes pending operations before continuing

### S35 (planned, P3): Ledger changes need a lock implementation

- Given a platform without `sqlite` and no injected LedgerLock
- When `applyInstall` runs
- Then it fails with `ledger-lock-unavailable` and changes nothing

### S36: Detection reports a status per agent

- Given an agent whose command is on `PATH` and whose version command succeeds, and an agent with only a configuration directory
- When `detectAgents` runs
- Then the first is reported `runnable` with its version, and the second is reported from its evidence without being `runnable`

### S37 (planned, P5): Lease generations never go backwards

- Given a lease acquired at generation 3 and then released
- When it is acquired again, including by the same holder after losing it
- Then the new generation is greater than 3, and a fenced write carrying generation 3 is rejected

### S38 (planned, P5): A second instance is refused

- Given a process holding `acquireProcessLock(path)`
- When a second process tries the same path, and later the first process exits
- Then the second attempt is refused, and an attempt after the exit succeeds

### S39 (planned, P6): An ACP session runs one turn at a time and denies permission by default

- Given a session with a turn in progress and no permission callback
- When a second `prompt` is sent and the agent asks for permission
- Then the second prompt is refused and the permission request is denied

### S40 (planned, P6): Lanes coalesce wakes and bound the queue

- Given `createLanes({ maxConcurrent: 1, maxQueued: 1, activate })`
- When one key is woken three times while its activation runs, and two other keys are woken
- Then the first key has one activation running and at most one pending, at most one activation runs in total, and the number of queued activations never exceeds `maxQueued`

### S41: An unknown payload reads as `unknown` without throwing

- Given payloads that are not objects, name no event, name an event as a number, or name `constructor`, for every built-in agent
- When `readHookEvent` reads them
- Then each returns phase `unknown` with the agent and a string `nativeEvent`, and nothing throws; an agent without a dialect throws `AgentKitError` with code `capability-unsupported`

### S42: Only the tool's name and call id are kept

- Given a Codex `PreToolUse` payload whose `tool_input` holds a command
- When `readHookEvent('codex', payload, env)` reads it
- Then `tool` is `{ name, callId }` and the event contains nothing from `tool_input`

### S43: The terminal pane is kept apart from the session

- Given a hook environment with `TMUX_PANE=%4` and `SUPERSET_TERMINAL_ID=t-9`
- When `readHookEvent` reads any payload
- Then `terminal` is `{ host: 'superset', paneId: 't-9' }` and `sessionId` still comes from the payload

### S44: Every dialect states its timeout unit (agent-presence#85)

- Given the built-in dialects
- When their timeout units are read
- Then Claude Code, Codex, Cursor and Grok use seconds, Gemini CLI uses milliseconds, and the plugin-delivered opencode and Pi have no hook timeout

### S45: Gemini CLI uses its own event names (agent-presence#86)

- Given the Gemini CLI dialect
- When its events are listed, and a payload named `UserPromptSubmit`, `PreToolUse`, `PostToolUse` or `Stop` is read
- Then the events are exactly `SessionStart`, `SessionEnd`, `BeforeAgent`, `AfterAgent`, `BeforeTool`, `AfterTool`, `BeforeModel`, `AfterModel`, `BeforeToolSelection`, `PreCompress` and `Notification`, and the Claude Code names read as `unknown`

### S46: Cursor's permission hooks are gates, including Claude Code's PreToolUse (agent-presence#89)

- Given the Cursor dialect
- When its gate events and its rename of Claude Code's events are read
- Then the gates are `beforeShellExecution`, `beforeMCPExecution`, `beforeReadFile`, `beforeTabFileRead`, `subagentStart` and `preToolUse`; Claude Code's `PreToolUse` runs as `preToolUse`, where invalid output blocks, exit code 2 denies and empty output is marked undocumented; and an observing hook prints `{}`, which is also what Claude Code and Grok accept

### S47: Subagents and silence do not fake the main session's state

- Given a working session, a subagent's `finish` event, and later no event for longer than the TTL; and, in another session, a turn start followed by a late session start
- When `reduceLifecycle` folds them, `lifecycleStatus` reads the state and `heartbeatSignal` reads each step
- Then the status stays `working` within the TTL counted from the subagent event and reads `unknown` after it, the subagent's `finish` gives no `finish` signal, and the late session start leaves the turn `working`

### S48: The hook entry imports nothing and starts fast

- Given the packed tarball installed into a fresh consumer
- When the built `/harness/events` files and chunks are checked, and a fresh Node process imports the entry and reads one payload
- Then no file imports an npm package or Node built-in, and the import plus the read take less than 100 ms

### S49: Effect entries run on the host's single copy of Effect

- Given a consumer project that installs the packed kit and `effect` 4.0.1
- When it type-checks and runs a program that reads `PlatformService` with `Effect.runPromiseExit`, provided by `NodePlatformLive`
- Then every Effect entry imports, the program succeeds with the Node platform, the consumer's tree holds exactly one `effect` package (by real path), every Effect entry resolves the same one as the consumer at 4.0.1, and no built file bundles a module from `node_modules`

### S53: A check that cannot complete is not a missing agent

- Given an agent whose only configuration path cannot be checked (a permission error), and an agent whose version probe times out
- When `detectAgents` runs
- Then the first is `unknown` with a `StatFailed` problem, and the second is `found` with a `CommandFailed` problem of reason `timed-out`

### S54: Only the agent's status command reports logged out

- Given a Codex whose `codex login status` prints `Not logged in`, and an agent whose credential file is absent
- When `detectAgents` runs with `authProbe: 'commands'`
- Then Codex is `logged-out` with the command as source, and the other agent's login state is `unknown`

### S55: Probes run no shell and nothing from the working directory

- Given `PATH` with an empty entry, a relative entry and an absolute entry, each holding the agent's command
- When `detectAgents` runs
- Then the command from the absolute entry is used, and every probe command runs without a shell, in the user's home directory, with the platform's environment and the time limit

### S56: Login state is read from files unless commands are asked for

- Given a Codex whose `auth.json` records a ChatGPT login and whose `codex login status` prints `Not logged in`
- When `detectAgents` runs without options, and then with `authProbe: 'commands'`
- Then the first run reports `logged-in` with method `chatgpt` from the file without running the status command, and without any credential value in the result; the second runs it and reports `logged-out`

## Compatibility And Constraints

- Public API: `@rivus/agent-kit` exposes subpath entries only; the shell package re-exports each name explicitly from the internal packages' public surface, so every change to the public surface shows up in review. Correcting an agent fact (a path, an event name) is a patch; adding an agent, an event type or a capability is a minor; dropping a Node LTS is a major. Unstable APIs live under `/experimental/*`. Adapter interfaces carry version literals so that a later `sessions-v2` can coexist with `sessions-v1`.
- Persisted data: 0.1.0 writes nothing and opens agent logs read-only. Planned harness state (the ledger and its lock files) lives under `$XDG_STATE_HOME`, outside dotfiles source directories.
- Configuration: agent home overrides (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) are read from the `env` passed to the kit, never from the global process environment directly.
- Operational bounds: ESM only, `sideEffects: false`, `engines.node >=22.13` (development and CI use Node 24), MIT. Published type declarations do not reference the private internal packages. Listing reads at most 128 KB per session file. Planned lock-based features support local directories only, not NFS.
- Dependencies: `zod/mini` is the only validation library, except in `/harness/events`, which uses no dependencies. `effect` is an optional peer pinned to exactly 4.0.1, needed only by consumers of Effect entries.

## Acceptance Evidence

- Scenario IDs and corresponding tests: each test that proves a scenario cites its ID in the test name. S1–S3 are covered by catalog unit tests; S4–S9 by sessions tests on the memory platform; S10–S18 by transcript tests and by the sessions conformance suite, which runs for every built-in adapter on scrubbed sample logs; S19 and S23–S25 by platform-node tests; S20 by the browser bundle check; S21 and S49 by the architecture boundary test, the dist check and the consumer smoke test; S22 by the line splitter unit tests. S30, S31 and S41–S47 by harness unit tests (`packages/harness`), by the hook dialect conformance suite, which runs for every built-in dialect on scrubbed sample payloads, and by folding those payloads through `reduceLifecycle` in each agent's order (`packages/testing/test/hook-lifecycle-sequences.test.ts`); S48 by the dist check and the consumer smoke test; S36 and S53–S56 by the discovery tests on the memory platform, and S36 again by the consumer smoke test with a real executable on `PATH`. Planned scenarios S26–S29, S32–S35 and S37–S40 are linked when their phase starts.
- Runtime or package evidence: `npm run check` and the package checks (publint, attw, size budgets, browser bundle check) on the packed shell; the trace viewer's adoption in P1, where its tests and the conformance tests pass and its session list matches its main branch; for P4, the parity test, which feeds agent-finder's test probes (and one synthetic probe) with agent-finder's own provider facts to `detectAgents` and compares the reports with the ones agent-finder's MoonBit scanner produced, then lists the built-in recipes whose facts were corrected, and the probe recipe conformance suite over every built-in recipe.
