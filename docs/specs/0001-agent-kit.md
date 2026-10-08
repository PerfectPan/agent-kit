# Spec 0001: agent-kit public entries

## Status

Accepted (the 0.1.0 entries, `/harness/events`, `/platform/effect`, `/node/effect`, `/discovery`, `/cost`, `/redact`, `/acp` and `@rivus/agent-kit-collab`'s `/lease`, `/process-lock` and `/lanes` are implemented; entries marked as planned are not yet)

Paired Plan: [docs/plans/0001-agent-kit.md](../plans/0001-agent-kit.md)

## Problem And Scope

Applications that work with third-party coding agents (agent-presence, agent-task-loop, a trace viewer, an editor plugin, an Effect-based host application) each keep their own copy of agent facts: agent ids, home directories, log layouts, usage rules, hook dialects. The copies cover different agents and have started to disagree (plan 1.2). `@rivus/agent-kit` gives them one place for each kind of agent knowledge (plan 1.3):

| Knowledge | Owner entry |
| --- | --- |
| Identity and home directories | `/catalog` |
| What an agent stores and how to read it | `/sessions`, `/transcript`, `/transcript/usage` |
| What can be extended and how to install it | `/harness`, `/harness/events` |
| What recorded usage costs, over a caller's price table | `/cost` |
| What is installed on this machine | `/discovery` |
| How to drive an agent | `/acp` |
| Hiding home paths and secrets in what an application shows or exports | `/redact` |
| Mutual exclusion between agent processes | `@rivus/agent-kit-collab/lease`, `@rivus/agent-kit-collab/process-lock` |
| Scheduling work per key under a concurrency cap | `@rivus/agent-kit-collab/lanes` |

Included in 0.1.0: the observable behavior of `/catalog`, `/platform`, `/node`, `/sessions`, `/transcript` and `/testing`, with built-in session support for Claude Code, Codex and Grok.

Included after 0.1.0: `/harness/events` (P3a), with hook dialects for Claude Code, Codex, Cursor, Gemini CLI, Grok, opencode and Pi; `/discovery` (P4), which detects 27 agents, with an identity for each in `/catalog`; `/cost` (P2b), pricing and summaries of usage records over a price table the caller passes in; `/acp` (P6), which drives Claude Code, Codex, Gemini CLI, Grok and opencode over the Agent Client Protocol.

Included in P5: `/redact` in `@rivus/agent-kit`, and the second published package `@rivus/agent-kit-collab` with `/lease` and `/process-lock`, released in lockstep with `@rivus/agent-kit` (one version).

Included in P6: `/acp` and collab's `/lanes`.

Included as planned behavior: `/transcript/usage` (P2) and `/harness` (P3). These entries do not exist in 0.1.0. Their sections record the behavior the plan has already decided; each phase revises this Spec before it starts if the behavior changes.

Excluded: application state and policy (presence's online state, agent-task-loop's Task/Run, a viewer's turn tree, timeline, context reconstruction and UI fields); price data; an in-session MCP tool server; daemons and durable queues; Promise facades over Effect entries; a global adapter registry.

## Behavioral Requirements

### All entries

- Plain TS entries must expose functions and plain data. Stateful parts are created by factory functions. The only public class is `AgentKitError` (`code` + `cause`); it is recognized through a `Symbol.for` brand, so a check succeeds even when several copies of the kit are installed.
- A plain TS entry must return a `Promise` for a single result and an `AsyncIterable` for sessions, events and usage. Leaving a `for await` loop (`break`) cancels the iteration. Every function that does IO accepts `{ signal?: AbortSignal }`.
- Expected outcomes must be returned as values, `{ ok: true, value } | { ok: false, error }`, where `error` carries a `_tag`; a Promise-returning entry resolves to such a value. An abort rejects with `signal.reason`, and only defects throw.
- A plain TS entry takes the platform, or the part of it that it uses, as its first parameter. There is no kit object bound to a platform.
- Each context that has per-agent behavior defines its own adapter interface with a version literal (`specificationVersion`), exports a `builtinXxx: Record<CodingAgentId, XxxAdapter>` table, and accepts an `adapters` option that overrides or extends it for one call. An agent supports a capability exactly when the context's table has an adapter for it. A caller that asks for an unsupported capability by name (such as `listSessions({ agents })`) gets an `AgentKitError` with code `capability-unsupported` thrown; a stored ref that names such an agent yields a `CapabilityUnsupported` value.
- Only Effect entries (`/platform/effect`, `/node/effect`, `/acp`, collab's `/lease` and `/lanes`, and the planned `/harness`) may depend on `effect`. No other entry may reach it, in either its module graph or its published `.d.ts` graph, so a consumer that never installs `effect` can import and type-check every other entry.
- `/catalog`, `/platform`, `/platform/effect`, `/redact`, `/sessions`, `/transcript`, `/discovery`, `/cost`, `/harness/events` and `/acp` must be browser-safe: bundling them for a browser target pulls in no `node:*` module or Node builtin. `/node`, `/node/effect` and `/testing` are exempt.

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
- Live turns are a stream of `TranscriptStreamPart`s (plan 3.11): deltas named after AI SDK's UI message stream parts (`text-start`, `text-delta`, `text-end`, the same for `reasoning`, `tool-input-start`, `tool-input-available`, `tool-output-available` for a completed call, `tool-output-error` with `errorText` for a failed one, `finish`), `update` for an update that becomes one event as it is, and `event` carrying a completed `LiveTranscriptEvent`: a `TranscriptEvent` without a `source`, because a live update is stored in no file. `foldStreamParts(parts, now?)` turns the deltas into those events: text and reasoning at their end, a tool call with its result once its output is available (so the call carries its final input), and at `finish` the calls that never ended and the turn's `request`; it skips `event` parts, so folding a turn's whole stream gives the events it carried, with other times. Grok's `updates.jsonl` and live ACP turns read ACP `session/update` records with one set of rules: message chunk kinds, chunk text, and the merging of a tool call's updates.

### `/cost`

- Exports `createPricing(table, { overrides, fallback })`, `costOf`, `calendarWindow`, `summarize` and `fromLiteLLM`, with the types `Price`, `PricingTable`, `PriceOverrides`, `PricingOptions`, `Pricing`, `Cost`, `CalendarWindow`, `CalendarWindowOptions`, `SummarizeOptions`, `UsageSummary`, `UsageTotals`, `UsageGroup`, `UsageGroupKey` and `CostErrorCode`. The kit ships no price data; the caller passes the table. The entry is pure computation and, like `/harness/events`, its built files import nothing.
- A `Price` gives USD per million tokens for input without cache, output, cache reads, cache writes and, optionally, one-hour cache writes. `createPricing` matches keys regardless of case: a model takes the entry of a matching override key when there is one, else of a table or fallback key (the table's entry wins for the same key); among each set of keys, its own id wins, then the longest key its id contains. A partial override takes its missing prices from the table's, else the fallback's, entry with the same key. A model that no key matches, or that only an incomplete override matches, has no price.
- `costOf(record, pricing)` applies three rules in order: a cost the record carries (`costUsd`, such as an amount the agent logged) wins; otherwise each count is charged at the model's price: `noCacheInputTokens` at the input price, cache reads at the cache read price, cache writes other than one-hour ones at the cache write price, one-hour cache writes at their own price or else the cache write price, and output at the output price; that amount is multiplied by `pricingMultiplier`. An amount the record carries is not multiplied. A record split by model (`usageByModel`) is charged per model, each from its own cost or at its own price, and its aggregate is not charged again: when the agent logged an amount for the record and for every model, the models' amounts are used. The record stays whole only when the agent logged an amount for it that the split does not divide among every model; an amount from a price table on a split record (`{ ...record, ...costOf(record, pricing) }`) does not keep it whole. `summarize` charges records by the same rules. A missing count costs nothing; a record without a model, or with a model that has no price, has no cost (`undefined`, never 0). A `Cost` is `{ costUsd, costSource }`, the record's own field names.
- `calendarWindow(days, { now, timeZone })` returns `{ since, until }`: from the midnight that started the day `days − 1` days before the day of `now`, in the given IANA time zone or the host's, to `now`. The start is a midnight also when a daylight saving change falls inside the window, the earlier midnight of a day whose clocks turned back over midnight, and the first moment of a day whose midnight the clocks skipped. A `days` that is not a positive integer, a `now` that is not finite and an unknown time zone throw `AgentKitError` with code `invalid-window`.
- `summarize(records, pricing, { window, groupBy })` totals the records with `since ≤ timestamp < until`: tokens in the `Usage` convention, the number of records, and the sum of the costs `costOf`'s rules know, per group (by agent and model unless `groupBy` says otherwise; groups in the order of their first record) and overall. A group's cost is absent when none of its records had a known cost. The total adds up the groups, as presence adds up its sources, and counts each record once. A record split by model adds its split, so its tokens count once and each model's tokens land in that model's group.
- `fromLiteLLM(json)` turns LiteLLM's model price list (USD per token) into a `PricingTable` under LiteLLM's keys. It reads `input_cost_per_token` and `output_cost_per_token` (both required), `cache_creation_input_token_cost`, `cache_creation_input_token_cost_above_1hr` and `cache_read_input_token_cost`; a missing cache price is the input price. Tiered, batch, flex and priority prices are not read.
- presence keeps four buckets per record. From a `Usage` they are `noCacheInputTokens(usage)`, `cacheReadTokens`, `cacheWriteTokens` (with `cacheWrite1hTokens` as its one-hour part) and `outputTokens`, and presence's token count is `inputTokens + outputTokens`. On these buckets `costOf` gives presence's dollars exactly.

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

### `/acp`

- Exports `connectAgent(agent, options)`, `probeAgent(agent, options)`, the profile table `builtinAcpProfiles`, `agentEnv`, `optionOfKind`, the `SessionBindingStore` port with `MemorySessionBindingStoreLive` and `FileSessionBindingStoreLive(path)`, `foldStreamParts`, and the types of connections, sessions, profiles, permissions, bindings, stream parts and errors. An `AcpProfile` carries `specificationVersion: 'acp-v1'`. The ACP SDK is an internal dependency: no published declaration imports it.
- `connectAgent` reads the platform from `PlatformService`, starts the profile's command with `Platform.spawn` in `options.cwd` with exactly `options.env` (nothing is inherited), completes `initialize` within `handshakeTimeoutMs` (30 s by default) and returns an `AcpConnection` that belongs to the caller's Scope. A program that cannot start fails with `AgentUnavailable`; a timeout, an exit before the handshake, another protocol version or an `initialize` error fail with `HandshakeFailed`; in each case the process is stopped. An agent without a profile, in `builtinAcpProfiles` or `options.profiles`, or a timeout that is not a positive number, throws `AgentKitError` (`capability-unsupported`, `invalid-option`) as a defect.
- Built-in profiles: `claude-code` (`claude-agent-acp`, system prompt in `_meta.systemPrompt`), `codex` (`codex-acp`), `opencode` (`opencode acp`), `gemini-cli` (`gemini --experimental-acp`) and `grok` (`grok agent stdio`, system prompt in `_meta.rules`). An agent without a system prompt channel gets the system prompt as a text block before the first prompt of a new session. A profile lists the environment variables its agent reads; `agentEnv(profile, env)` picks them from an environment the caller chooses. Facts not checked against the agent are listed in the profile's `warnings`.
- `newSession({ cwd?, mcpServers?, systemPrompt?, meta?, sessionKey? })` sends `session/new` within `requestTimeoutMs` (30 s by default; `AcpTimeout`); an agent that needs a login refuses it with `AuthRequired`. `loadSession({ sessionKey } | { sessionId })` opens an existing session with `session/load`, or with `session/resume` when the agent supports only that, and fails with `LoadUnsupported` when it supports neither; the agent's replay of the history is not streamed. Concurrent loads of one session send one request and share the session, and loading a session already open on the connection returns it, binding the given `sessionKey` and returning a handle that carries it. With a `sessionKey`, `newSession` binds the key to the session in the `SessionBindingStore` and `loadSession` reads the binding (`BindingNotFound` when it is missing or was made for another agent). Without a store provided, a `sessionKey` fails with `SessionBindingStoreFailure` (`unavailable`).
- A session runs one turn at a time: `prompt(blocks)` returns a `Stream` of `TranscriptStreamPart`s (see `/transcript`), and a second prompt while a turn runs fails with `TurnInProgress`. A turn's parts arrive in the order the agent sent its updates, and its `finish` comes after all of them.
- Permission requests go to `onPermission(request)`, an Effect that answers with one of the request's options or `undefined`. Without a callback, without an answer, with an option the request did not offer, or with a callback that fails, the request is denied: the request's reject option is selected, or `cancelled` when it offers none. While the turn is cancelling, every pending request is answered `cancelled` at once, without waiting for the callback, which is interrupted; so a callback may cancel or close its own session.
- `cancel()` sends `session/cancel` and waits for the turn to end; the deadline (`cancelTimeoutMs`, 5 s by default) covers both. Interrupting a turn's stream, or leaving it before it ends, cancels the turn the same way. When the turn does not end in time, the session closes and the connection is closed, which stops the process and fails every other session on it with `ConnectionClosed`; then the session's bindings are removed (each only while it still names that session, and each within `requestTimeoutMs`), and the cancel and the turn fail with `CancelUnsettled`.
- A closed session refuses `prompt` and `cancel` with `SessionClosed`. `close()` cancels a running turn and sends `session/close` when the agent supports it; once started it runs to the end. When the connection ends (the caller closes it, the process exits, or a cancel did not settle), every running turn fails with `ConnectionClosed` and every session closes. Closing stops the process with SIGTERM, then SIGKILL after the platform's grace period, and waits for it to exit.
- Client file reads and writes (`fileSystem: { read, write }`, off by default) act only inside the session's directory: a path must be absolute, the target is compared after `realpath`, which resolves `..` the way the file system does (after the links before it), a target that does not exist yet is judged by its nearest existing parent, and a link whose target does not exist is refused.
- `probeAgent(agent, options)` connects, opens one trial session in `options.cwd` and closes both. It reports `ready`, `needs-login` (the agent refused the session until the user logs in) or `unavailable` with the error.
- The `SessionBindingStore` calling convention: `set` replaces the binding of the same key (the last write wins), and `remove(sessionKey, sessionId)` deletes the binding only while it still names `sessionId`. `FileSessionBindingStoreLive(path)` keeps the bindings in one JSON file with a `schemaVersion`, replaced atomically on every change; a file that does not parse, or that a newer version wrote, is refused and left as it is, and writers in other processes are not locked out.

### `/testing`

- Exports `createMemoryPlatform({ files, commands })`, an in-memory `Platform` (without `process.spawn` and `sqlite`) whose file system holds the given files and whose `process.run` runs the given scripted programs, and the conformance suite of each context that has one: `sessionAdapterConformance`, with `oversizedSession` to build its large sample, `hookDialectConformance` with the types `HookDialectFixtures` and `HookDialectSample`, and `probeRecipeConformance`. Each check is a named function that rejects on failure, so any test runner can run it.
- A scripted program behaves like a spawned one: it runs only while its file exists, a missing program or working directory is `ENOENT`, a file that is not a program is `EACCES`, a `.cmd` or `.bat` file on a Windows platform is `EINVAL`, it gets the platform's environment unless the run gives one, and it honors `timeoutMs` and `signal`.
- The probe recipe conformance suite checks that a recipe names a catalog agent by its canonical id and display name (or a third-party agent by a canonical id), probes bare command names with fixed arguments, names a login command from its own commands and lists that command's side effects, checks only absolute, home-relative or agent-home paths, has version, login and credential file parsers that return a well-formed value or `undefined` for any input, reads its sample outputs and credential files as stated, passes on no value from its login inputs (a canary placed in every string position of the samples never reaches a reading), and that detection on a machine with everything and on an empty machine reports the expected status the same way every time.
- Readers produce the same results on the memory platform as on the Node platform over the same files.
- The hook dialect conformance suite checks a `HookDialect` against sample payloads: it declares `harness-v1`, a command dialect has a timeout unit and output rules, every mapped event (and every case of a field-dependent mapping) resolves to a known phase with consistent `outcome` and `blocker`, every gate event declares its own response format whose `passThrough` is valid for it, foreign event renames point at mapped events, every event has a sample, every sample reads to its expected LifecycleEvent through `readHookEvent`, and probe payloads (wrong types, inherited object keys such as `constructor`, unmapped names) read as phase `unknown` without throwing.
- The sessions conformance suite checks a `SessionAdapter` against sample logs: listing reads at most 128 KB per file, event ids are stable and unique, every record is accounted for, tool results are paired, compaction shadowing holds, references between events and lanes resolve (a `spawnEventId` names an existing `tool_call` or `system` event on the parent lane), source pointers read back, declared capabilities match the output, and summaries equal the folded transcript. Built-in adapters and third-party adapters run the same suite; keeping `node:*` out of adapters is the boundary test's job.

### `/redact`

- `redact(value, { home })` returns a copy of a JSON-like value with every string, object keys included, passed through `redactText`; arrays and plain objects are copied, other objects are returned as they are, and nothing is mutated. `redactText(text, { home })` does the same for one string. Both are pure, synchronous, browser-safe and import nothing.
- Every spelling of the home directory becomes `~`: the native path anywhere in a string (also inside `a/<home>` or a file URL), its JSON-escaped form, its URL-encoded form, the POSIX path without its leading slash when no name character precedes it, a Windows home with either separator, JSON-escaped and as MSYS spells it (`/c/Profiles/me`), Claude Code's project slug (`-u-me`) where a path segment starts, the percent-encoded folder name (`%2Fu%2Fme`), and `~<user>`, also right after a JSON escape (`\n~me`). A home followed by a character that continues the path segment (`<home>x`, `<home>.bak`, `<home>-old`) is another path and stays. A home of one segment (`/root`) has no slash-less spelling, so the word `root` stays. Matching ignores case. An empty home or a file system root hides no path.
- Secret-shaped strings become `[redacted]`: `sk-` keys, AWS key ids (`AKIA`, `ASIA`), GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`), Slack tokens (`xox[abprs]-`), npm tokens (`npm_`) and PEM private key blocks; a block without its END line is hidden to the end of its base64 lines. A token counts at the start, after a character that is not a letter or digit, or right after a JSON escape (`\n`, `\u0022`) or URL encoding (`%22`, `%3D`); a prefix inside a longer word (`task-…`) is not a key.

### `@rivus/agent-kit-collab/process-lock`

- `acquireProcessLock(platform, path, { wait?, retryMs?, signal? })` resolves to `Result<ProcessLock, ProcessLockHeld>`. Plain TS; it never reaches `effect`. `ProcessLock` has `path`, `mechanism` (`sqlite` or `file`), `holder` and `release()`, which is idempotent. `ProcessLockHeld` carries the holder the lock recorded, for diagnostics; it may be stale.
- With `platform.sqlite`, `path` is a SQLite database held with `locking_mode=EXCLUSIVE`: the kernel releases it the moment the holder exits or crashes. The holder's identity goes into `<path>.holder`. Without SQLite, `path` is a lock file holding the identity; a file whose holder is dead (same host, and an earlier boot, no process with that pid, or a reused pid) is reclaimed, and only one reclaimer at a time may remove it (`<path>.stale`). A holder on another host is never judged dead. After writing its stamp, a holder reads it back and gives the lock up if another stamp replaced it. Known gaps of the fallback: a crash between creating the file and writing the stamp leaves an empty file that counts as held for 30 s, and a holder stalled longer than that between the two steps can end up holding the lock together with its reclaimer.
- Without `wait`, a held lock resolves to `ProcessLockHeld` at once; with `wait`, the call retries until the lock is free, with pauses that double from `retryMs` up to 16 times it. Only the first attempt may block the thread (for at most a few 10 ms SQLite busy waits, which settle processes that start together); retries do not. Aborting `signal` rejects with `signal.reason`, releasing a lock taken after the abort. A second acquisition in the same process is refused like another process's.
- Local directories only (not NFS), on darwin and linux, where the platform identifies processes. Holder and contenders must see one process table: same host name and boot id are taken to mean that, so containers sharing a host name and kernel but not a PID namespace are not supported, and after a host is renamed its earlier holders look remote.

### `@rivus/agent-kit-collab/lease` (Effect)

- `createLeaseManager({ ttlMs, heartbeatMs, retryMs? })` needs `LeaseStore` and `PlatformService` and fails with `LeaseConfigInvalid` unless every duration is positive and `heartbeatMs × 2 ≤ ttlMs`. The manager's `acquire(key, { wait? })` returns a `LeaseHandle` in the caller's Scope (`key`, `token`, `lost`, `runFenced`) or fails with `LeaseHeld` or `LeaseStoreFailure`; `read(key)` returns the stored `LeaseSnapshot`.
- `LeaseStore` is a `Context.Service` keyed `@rivus/agent-kit-collab/lease/LeaseStore/v1` (`read`, `compareAndSet` on the record's revision, `fence` per key). `sqliteLeaseStore({ path })` compares inside `BEGIN IMMEDIATE`; `fileLeaseStore({ dir })` keeps one JSON file per key and compares under a per-key process lock, reporting `busy` when that lock stays held for 1 s; `memoryLeaseStore()` serves one process. Each returns a Layer that requires `PlatformService`. A stored record that is unreadable, breaks the invariants, or has an unknown schema version is refused (`LeaseStoreFailure`) and never overwritten.
- A lease has one holder at a time. Its generation (the fencing token, `{ key, generation }`) grows by one on every acquisition and never decreases; release keeps the record as a tombstone. Every write increases the revision.
- A holder on the observer's host is judged by pid, start time and boot id: a holder whose process is gone, or whose pid belongs to another process now, is taken over at once. A holder the platform fails to look up counts as unknown. Any other holder keeps the lease while its record changes at least once per `ttlMs`, as the observer's monotonic clock measures from the moment it first read the current revision.
- The holder renews every `heartbeatMs` in a fiber of the acquiring Scope. A refused renewal, or no confirmed renewal for `ttlMs`, completes `lost` with `LeaseLost`. Closing the Scope stops the heartbeat, then writes the tombstone.
- `runFenced(work)` waits for the store's fence for the key (failing with `LeaseLost` if the lease is lost meanwhile), re-reads the record, and fails with `FenceRejected` unless this acquisition still holds that generation; otherwise it runs `work(token)`, interrupting it and failing with `LeaseLost` when the lease is lost. The fence is released when `work`'s fiber has ended. An interrupted fiber ends at once while a Promise it started keeps running, so a write that cannot be cancelled must sit in `Effect.uninterruptible` (or settle only after the AbortSignal of `Effect.tryPromise` has stopped it) to keep a successor's fenced work from starting before it settles; a resource that can compare atomically also checks the token with `checkFence`. Pure rules for resources and hosts: `isFresh`, `canAcquire`, `nextFencingToken`, `checkFence` (refuses a smaller generation than the highest seen), `holderLiveness`.
- Local directories only (not NFS), on darwin and linux, with the process-table limits of `/process-lock`.

### `@rivus/agent-kit-collab/lanes` (Effect)

- `createLanes({ maxConcurrent, maxQueued?, turnTimeoutMs?, activate, onExit? })` returns, in the caller's Scope, lanes with `wake(key)`, `cancel(key)`, `status` and `close`, or fails with `LanesConfigInvalid` unless `maxConcurrent` is a positive integer, `maxQueued` a non-negative integer and `turnTimeoutMs` a positive duration. It needs no service of its own; `activate(key)` and `onExit` may require services, which the lanes take from the context `createLanes` ran in. Nothing is persisted.
- A lane (one key) is idle, queued, or running one activation; at most one activation per key runs at a time, and at most `maxConcurrent` run in total. A wake that arrives before an activation starts is served by it: a queued lane stays queued, and a running lane owes exactly one more activation however often it is woken (`pending`).
- `wake(key)` never waits for an activation. An idle lane starts when a slot is free and no lane waits, otherwise it joins the end of the queue; when `maxQueued` lanes already wait, `wake` fails with `LaneQueueFull` and nothing changes. It resolves to `started`, `queued` or `coalesced`, and fails with `LanesClosed` after `close`. Without `maxQueued`, the queue holds at most one entry per key.
- A slot that frees goes to the lane that has waited longest. A running lane that owes an activation joins the end of the queue when its activation ends, so lanes queued meanwhile go first.
- Each activation runs in a Scope of its own, raced against its interruption by `cancel`, `close` or the turn timeout (`turnTimeoutMs`, measured from the start of the activation). The slot passes on only after the activation's Scope has closed and `onExit` has run with `ActivationSucceeded`, `ActivationFailed` (failure, defect or self-interruption, with the cause) or `ActivationInterrupted` (`cancel`, `close` or `timeout`). An activation that succeeded or failed by itself keeps that exit when a cancel, close or timeout comes while its Scope closes, with what the cleanup added but without that interruption; `ActivationInterrupted` names whichever of cancel, close and the timeout came first and means the lanes cut it short, or stopped it before it started, in which case `activate` is never called. A failed activation does not stop the lane, and a defect in `onExit` is logged as a warning.
- `cancel(key)` drops the key's place in the queue or the activation it owes, interrupts its running activation and returns once that activation has ended; later wakes are served as usual. `close` (also run when the creating Scope closes) refuses later wakes, drops the queue and every owed activation, interrupts the running activations and returns once all have ended; it is idempotent. `status` reports the number running and queued, whether the lanes are closed, and the snapshot (`key`, `state`, `pending`) of every lane that is not idle: the running ones, then the queued ones in queue order.

### Planned entries

These entries are not part of 0.1.0. The phase in brackets is the phase in plan 6.3 that ships them.

#### `/transcript/usage` (P2)

- `decodeUsage(platform, agent, file, { since, from })` streams `UsageRecord`s without building a transcript, and can continue from a previous cursor.
- A `UsageRecord` has `granularity` `request`, `turn` or `session`. Per-request data is `request` and carries `model`. An aggregate stays an aggregate (`turn` or `session`) with `modelCalls`; it is never split into invented per-request records. `usageByModel` splits the record's usage and cost by model, and totals take either the record or its split, never both.
- `noCacheInputTokens`, `toAiSdkUsage` and `toOtelAttributes` convert usage for pricing, AI SDK and OTel (`cacheWriteKey` defaults to `cache_creation`).
- Per-agent mapping follows plan 3.11: Claude Code input is input + cache read + cache creation; Codex prefers `last_token_usage` and otherwise takes differences of cumulative values, skipping the replay at the start of a forked session; Grok's turn aggregate is a `turn` record.

#### `/harness` (P3, Effect)

- `planInstall` returns an InstallPlan handle whose `changes` list each file's diff, the agent commands to run and the expected trust prompts. `applyInstall` re-checks every target before writing and refuses when a target changed after the plan. `verify`, `uninstall` and `inventory` work from the ledger. Layers such as `HarnessLive` provide the ports.
- Injection prefers, in order: launch arguments or ACP session parameters, the agent's native plugin mechanism, a scanned skills directory, and only then an append-only, ledger-recorded, format-preserving edit of shared configuration.
- A plan is rejected as a whole when it has a conflict without an explicit force / adopt / backup choice, and when the ledger changed since the plan was built.
- `uninstall` removes only what the ledger records for that owner, and only when the file still matches what was installed; a user-modified file is kept and reported.
- Every ledger modification happens while one LedgerLock is held. Without `platform.sqlite` and without an injected LedgerLock, ledger modification is refused with `ledger-lock-unavailable`. A ledger with an unknown `schemaVersion` is refused or kept whole, never cleared.
- Concurrent changes by writers that do not take part in the lock may be lost, and such a loss cannot be detected afterwards; the kit promises no CAS for shared configuration files.

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
- A lease has one holder at a time; its generation never decreases, release and takeover included, and every write increases its revision. A recorded holder is the same process only when host, boot id, pid and start time all match.
- Planned contexts add their own invariants (plan 3.1 and 3.9): an InstallPlan is immutable and refused when stale or conflicting; ledger revisions strictly increase and an unknown ledger version is never cleared; a lane runs one activation per key.
- An ACP session runs at most one turn at a time and refuses everything once closed; a cancel either ends the turn within its deadline or invalidates the session's binding and closes its connection; the agent process receives only the environment given explicitly.

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

### S29: Pricing rules apply in order

- Given one record with an agent-reported cost and one without, both with a pricing multiplier of 2
- When `costOf` prices them
- Then the first costs the reported amount as it is, and the second costs the bucket formula multiplied by 2

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

### S37: Lease generations never go backwards

- Given a lease acquired and released, with each store (memory, SQLite, file)
- When it is acquired again, and again after the persistent store is reopened
- Then the released record keeps generation 1 as a tombstone without a holder, and the next acquisitions get generations 2 and 3

### S38: A second instance is refused

- Given a process holding `acquireProcessLock(path)`, with SQLite and with the lock-file fallback
- When a second process tries the same path, a third waits for it, and the first process is killed
- Then the second attempt resolves to `ProcessLockHeld` naming the first process, and the waiting one acquires the lock within 1.5 s of the kill

### S39: An ACP session runs one turn at a time and denies permission by default

- Given a session with a turn in progress and no permission callback
- When a second `prompt` is sent and the agent asks for permission
- Then the second prompt is refused and the permission request is denied

### S40: Lanes coalesce wakes and bound the queue

- Given `createLanes({ maxConcurrent: 1, maxQueued: 1, activate })` with key `a` running
- When `a` is woken three more times, `b` twice and `c` once, and then each activation finishes
- Then the wakes of `a` coalesce into one pending activation, `b` is queued once, `c` fails with `LaneQueueFull`, at most one activation runs at any time, and the activations run in the order `a`, `b`, `a`

### S100: Lanes share the capacity in wake order

- Given `createLanes({ maxConcurrent: 2, activate })`
- When `a`, `a`, `b` and `c` are woken, then `a`'s activation ends, then `b`'s
- Then `a` and `b` start, `c` waits, `c` takes the slot `a` frees, and `a`'s pending activation starts only when `b` ends

### S101: An activation that outlives the turn timeout is interrupted

- Given `createLanes({ maxConcurrent: 1, turnTimeoutMs: 1000, activate, onExit })` with `a` running and `b` queued, on a test clock
- When 999 ms pass, then 1 ms more
- Then nothing changes at 999 ms; at 1000 ms `a` is interrupted, its Scope closes and `onExit` reports `ActivationInterrupted` with `timeout` before `b` starts, and `b`'s timeout counts from its own start

### S102: Cancel drops what a key owes and waits for its activation

- Given one slot with `a` running and owing an activation, and `b` and `c` queued
- When `b` is cancelled, then `a`
- Then `b` leaves the queue; `cancel(a)` returns after `a`'s Scope has closed and `onExit` has reported `cancel`, `a` does not run again, `c` holds the slot; cancelling an idle key returns at once, and a later wake of `a` is served

### S103: Closing the lanes interrupts what runs and refuses what comes

- Given lanes with `a` and `b` running, `c` queued and `a` owing an activation
- When `close` runs, or the Scope that created the lanes closes
- Then `a` and `b` are interrupted and reported with `close`, `c` never starts, `status` shows nothing running or queued, later wakes fail with `LanesClosed`, and a second `close` returns at once

### S104: A failed activation is reported and the lane goes on

- Given an activation that fails, then one that dies, then one that succeeds; an `activate` that throws instead of returning an Effect; and an `onExit` that blocks for one key and dies for another
- When each is woken, and the blocked key is cancelled while its `onExit` waits
- Then `onExit` reports `ActivationFailed` with the failure and with the defect, then `ActivationSucceeded`, each after the activation's Scope closed; the throwing `activate` is reported as a defect; the queued key starts and `cancel` returns only after the blocked `onExit` has finished; and a dying `onExit` is logged as a warning while the next wake still starts

### S105: Lane limits out of range are refused

- Given `maxConcurrent: 0`, `maxQueued: -1` or `turnTimeoutMs: 0`
- When `createLanes` runs
- Then it fails with `LanesConfigInvalid`

### S106: An activation that ended by itself keeps its exit

- Given an activation whose body succeeds, or fails with `session lost`, after 90 ms and whose Scope takes 30 ms more to close, under a 100 ms turn timeout, or with a cancel or `close` arriving while the Scope closes
- When the timeout, the cancel or the close comes during that cleanup
- Then `onExit` reports `ActivationSucceeded`, or `ActivationFailed` with `session lost`, not `ActivationInterrupted`

### S107: A key stopped before its activation starts never calls `activate`

- Given a key whose activation was recorded but whose fiber has not run yet: woken and then cancelled or closed at once, or given the slot by a cancel that the next statement follows with `close`
- When its fiber runs
- Then `activate` is not called and `onExit` reports `ActivationInterrupted` with `cancel` or `close`

### S108: The first stop names the reason

- Given activations that never end by themselves, whose Scope takes 100 ms to close, under a 50 ms turn timeout
- When one is cancelled at 10 ms, another's lanes close at 45 ms, and a third is cancelled at 60 ms, after its timeout
- Then they are reported as interrupted by `cancel`, `close` and `timeout`, although every cleanup outlasts the deadline

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

### S70: A model finds its price by its id, then the longest key it contains

- Given a table with `claude-opus-4-8` and a fallback with the alias `opus`
- When `createPricing` looks up `claude-opus-4-8-20260101`, `CLAUDE-OPUS-4-8`, `claude-3-opus` and `mystery`, and then `claude-opus-4-8` with the override `{ opus: { input: 99 } }`
- Then the first two take `claude-opus-4-8`, the third takes `opus`, `mystery` has no price, and the override wins with its other prices taken from `opus`

### S71: A turn split by model is priced per model

- Given a turn record whose `usageByModel` splits it between two priced models, and the same turn with one unpriced model added
- When `costOf` prices them
- Then the first costs each model's share at that model's price, without charging the aggregate again, and the second has no cost

### S72: A calendar window starts at a midnight across a daylight saving change

- Given `now` on March 10, 2026 at 12:00 UTC and the time zone `America/New_York`, which moved to daylight saving time on March 8
- When `calendarWindow(7, { now, timeZone })` is called
- Then `since` is midnight of March 4 in New York (05:00 UTC), not six times 24 hours before the midnight of March 10, and `until` is `now`

### S73: A summary's cost covers only what is priced

- Given a priced record, a record of an unpriced model and a record without a model
- When `summarize` totals them by agent and model
- Then the total counts the tokens of all three and the cost of the first, and the groups of the other two have no cost

### S74: LiteLLM's per-token prices become a pricing table

- Given LiteLLM entries with input, output, cache creation, one-hour cache creation and cache read prices per token, one without cache prices and one without an output price
- When `fromLiteLLM` converts them
- Then the prices are per million tokens, missing cache prices are the input price, and the entry without an output price is left out

### S60: Redaction hides every spelling of the home directory and secret-shaped strings

- Given the home `/u/me` (or `C:\Profiles\me`) and text that names it as a path, inside a diff header or a file URL, JSON-escaped, percent-encoded, as a Claude Code project slug, as `~me`, and next to `/u/meeting`, together with `sk-`, AWS, GitHub, Slack and npm tokens and a PEM private key
- When `redactText` or `redact` runs
- Then each spelling of the home becomes `~`, `/u/meeting` stays, each secret becomes `[redacted]`, object keys are redacted too, and the input is not mutated

### S61: Two reclaimers at once, exactly one wins

- Given a process lock or a lease (SQLite store, and file store without SQLite) whose holder process was killed
- When four processes try to take it at the same moment
- Then exactly one gets it (the lease at generation 2) and the other three are refused

### S62: Losing and regaining a lease gives a new generation

- Given a holder at generation 1 whose lease is taken over by another holder
- When the same process acquires it again
- Then it holds generation 3, its old handle's fenced work fails with `LeaseLost`, and `checkFence` refuses the old token at a resource that has seen generation 3

### S63: A reused pid is not the holder

- Given a lease record or lock file whose holder has a live process's pid but another start time
- When a process acquires it
- Then it is taken over at once, without waiting for the TTL

### S64: Losing the lease interrupts fenced work

- Given a holder running fenced work, in the same process or in another process that is stopped (`SIGSTOP`) until another process takes the lease over after the TTL
- When the holder's heartbeat finds the lease lost (after `SIGCONT`)
- Then the fenced work is interrupted and fails with `LeaseLost`, and the successor's fenced work starts only after the interrupted work has stopped

### S65: A heartbeat must fit twice into the TTL

- Given `createLeaseManager({ ttlMs: 100, heartbeatMs: 60 })`, or a duration that is not positive
- When the manager is created
- Then it fails with `LeaseConfigInvalid`

### S66: collab reaches agent-kit only through its public entries, as a peer

- Given the packed `@rivus/agent-kit` and `@rivus/agent-kit-collab` installed together, and a consumer that also installs `effect` 4.0.1
- When the consumers import every entry, take and release a process lock, and run a lease program on `sqliteLeaseStore` with `NodePlatformLive`
- Then `/process-lock` loads without `effect`, every collab entry resolves the consumer's copies of `@rivus/agent-kit` and `effect`, the lease generations are 1 then 2, and collab's `dist` inlines nothing outside its own `src/`

### S67: A non-cancellable fenced write keeps the fence until it settles

- Given a holder whose fenced work runs a 600 ms Promise write inside `Effect.uninterruptible`, and whose lease is taken over 50 ms into it
- When a successor acquires the lease and runs fenced work, and in another case a holder waits for a fence that another holder keeps
- Then the successor's work starts only after the old write has settled and the old `runFenced` fails with `LeaseLost`; the waiting holder stops waiting with `LeaseLost` within a few heartbeats of the loss, without running its work

### S80: The agent receives only the environment it is given

- Given a variable set in the parent process and an `env` option without it
- When `connectAgent` starts the agent
- Then the agent's environment holds exactly the variables of `env`, not even `PATH` unless it is given

### S81: A turn streams deltas and completed events in the agent's order

- Given an agent that sends a thought, two text chunks, a tool call with two updates, a plan and more text before answering the prompt
- When the turn's stream is collected
- Then the deltas come in that order and end with `finish`, each completed event follows the delta that completed it, the request carries the turn's usage in the kit's convention, and `foldStreamParts` over the deltas gives the same events

### S82: A cancel that settles keeps the session

- Given a turn in progress
- When `cancel()` is called and the agent ends the turn
- Then the stream ends with `finish` of reason `cancelled`, the session is `ready` with its binding, and the next prompt runs

### S83: A cancel that does not settle invalidates the binding and closes the connection

- Given two sessions with bindings on one connection, each running a turn, and an agent that ignores `session/cancel` on the first
- When the first is cancelled and its deadline passes on the Effect clock (and not one millisecond before)
- Then the cancel and the first turn fail with `CancelUnsettled`, the first binding is removed and the second kept, the second turn fails with `ConnectionClosed` (`cancel-unsettled`), both sessions are closed and the agent process has exited

### S84: A closed session refuses every operation

- Given a session that was closed
- When it is prompted or cancelled
- Then both fail with `SessionClosed`, and closing a session with a running turn cancels the turn first

### S85: Client file calls stay in the session directory

- Given a session with client file reads and writes on, a link inside its directory to a file outside, a link to a missing file, and a link to an outside directory
- When the agent reads and writes through each of them, through `..`, by a relative path, and inside the directory
- Then only the calls inside the directory succeed (a new file in an existing subdirectory included), and nothing outside changes

### S86: A bound session is loaded by key on a later connection

- Given a session created with a `sessionKey` on a connection that has since closed
- When a new connection calls `loadSession({ sessionKey })`
- Then the agent loads the same session id in the bound directory, and its replay of the history is not streamed

### S87: Starting an agent fails with a reason and leaves no process

- Given a program that does not exist, an agent that exits before the handshake, one that speaks another protocol version, and one that never answers `initialize`
- When `connectAgent` starts each
- Then they fail with `AgentUnavailable`, `HandshakeFailed` `exited`, `protocol-version` and, once the handshake timeout passes on the Effect clock, `timeout`

### S88: A connection leaves nothing running

- Given a connection that ran a turn, a permission request and a settled cancel
- When its Scope closes
- Then the agent process has exited and no timer, child process or pipe of it remains

### S89: Grok logs and live turns read ACP updates with the same rules

- Given the same ACP tool call updates recorded in a Grok log and received live
- When `translateGrokRecords` reads the log and `foldStreamParts` folds the live parts
- Then both give the same `tool_call` and `tool_result` payloads

## Compatibility And Constraints

- Public API: `@rivus/agent-kit` exposes subpath entries only; the shell package re-exports each name explicitly from the internal packages' public surface, so every change to the public surface shows up in review. Correcting an agent fact (a path, an event name) is a patch; adding an agent, an event type or a capability is a minor; dropping a Node LTS is a major. Unstable APIs live under `/experimental/*`. Adapter interfaces carry version literals so that a later `sessions-v2` can coexist with `sessions-v1`.
- Persisted data: 0.1.0 writes nothing and opens agent logs read-only. Planned harness state (the ledger and its lock files) lives under `$XDG_STATE_HOME`, outside dotfiles source directories. collab writes only where the caller points it: a process lock's database or lock file and its `.holder` file; a SQLite lease store's database (schema version in `user_version`) and its `<path>.<key>.fence` locks; a file lease store's `<key>.lease.json` (with `schemaVersion`) and lock files.
- Configuration: agent home overrides (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) are read from the `env` passed to the kit, never from the global process environment directly.
- Operational bounds: ESM only, `sideEffects: false`, `engines.node >=22.13` (development and CI use Node 24), MIT. Published type declarations do not reference the private internal packages. Listing reads at most 128 KB per session file. Lock-based features support local directories only, not NFS; collab's locks and leases need darwin or linux.
- Dependencies: `zod/mini` is the only validation library, except in `/harness/events`, `/cost` and `/redact`, which use no dependencies. `effect` is an optional peer pinned to exactly 4.0.1, needed only by consumers of Effect entries. `@rivus/agent-kit-collab` names `@rivus/agent-kit` as a peer at the same version (`^<version>`).

## Acceptance Evidence

- Scenario IDs and corresponding tests: each test that proves a scenario cites its ID in the test name. S1–S3 are covered by catalog unit tests; S4–S9 by sessions tests on the memory platform; S10–S18 by transcript tests and by the sessions conformance suite, which runs for every built-in adapter on scrubbed sample logs; S19 and S23–S25 by platform-node tests; S20 by the browser bundle check; S21 and S49 by the architecture boundary test, the dist check and the consumer smoke test; S22 by the line splitter unit tests. S30, S31 and S41–S47 by harness unit tests (`packages/harness`), by the hook dialect conformance suite, which runs for every built-in dialect on scrubbed sample payloads, and by folding those payloads through `reduceLifecycle` in each agent's order (`packages/testing/test/hook-lifecycle-sequences.test.ts`); S48 by the dist check and the consumer smoke test; S36 and S53–S56 by the discovery tests on the memory platform, and S36 again by the consumer smoke test with a real executable on `PATH`. S29 and S70–S74 by cost unit tests (`packages/cost`) and by pricing the usage fixtures (`packages/testing/test/usage-cost.test.ts`), which also checks every decoded record against presence's formula; the consumer smoke test prices one decoded session per seeded agent through `/cost`. S60 by redact unit tests (`packages/redact`); S37, S62, S63 by the Lease domain tests and the lease manager tests for every store (`packages/agent-kit-collab/src/lease/domain/lease/aggregate/lease.test.ts`, `test/lease-manager.test.ts`); S38 and S61 by the process lock and lease tests with real child processes (`test/process-lock.test.ts`, `test/lease-cross-process.test.ts`); S64 by the lease manager tests and the `SIGSTOP` test in `test/lease-cross-process.test.ts`; S67 by the lease manager tests; S65 by the lease manager tests; S66 by collab's dist check, the boundary test and the consumer smoke test. S40 and S100–S108 by the Lane domain tests (`packages/agent-kit-collab/src/lanes/domain/lane/aggregate/lane.test.ts`) and the lanes tests on Effect's test clock (`test/lanes.test.ts`), which also run three fibers of random wakes, cancels, completions, cleanups and clock moves, with turn timeouts and a `close` in the middle, and check after each step that the cap, the queue bound and one activation per key hold and that nothing calls `activate` after `close`; the consumer smoke test runs one lanes program through the installed tarballs. S39 and S80–S88 by the acp tests (`packages/acp/test`, against a fake ACP agent spawned through the Node platform, with the Effect test clock for deadlines) and S81 again by the consumer smoke test, which runs one turn through the installed tarball; S89 by the sessions protocol tests (`packages/sessions/src/protocols`). Planned scenarios S26–S28 and S32–S35 are linked when their phase starts.
- Runtime or package evidence: `npm run check` and the package checks (publint, attw, size budgets, browser bundle check) on the packed shell and on collab; the trace viewer's adoption in P1, where its tests and the conformance tests pass and its session list matches its main branch; for P4, the parity test, which feeds agent-finder's test probes (and one synthetic probe) with agent-finder's own provider facts to `detectAgents` and compares the reports with the ones agent-finder's MoonBit scanner produced, then lists the built-in recipes whose facts were corrected, and the probe recipe conformance suite over every built-in recipe.
