# Spec 0001: agent-kit public entries

## Status

Draft

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

Included as planned behavior: `/transcript/usage` and `/cost` (P2), `/harness` and `/harness/events` (P3), `/discovery` (P4), `/redact` and `@rivus/agent-kit-collab`'s `/lease` and `/process-lock` (P5), `/acp` and collab's `/lanes` (P6). These entries do not exist in 0.1.0. Their sections record the behavior the plan has already decided; each phase revises this Spec before it starts if the behavior changes.

Excluded: application state and policy (presence's online state, agent-task-loop's Task/Run, a viewer's turn tree, timeline, context reconstruction and UI fields); price data; an in-session MCP tool server; daemons and durable queues; Promise facades over Effect entries; a global adapter registry.

## Behavioral Requirements

### All entries

- Plain TS entries must expose functions and plain data. Stateful parts are created by factory functions. The only public class is `AgentKitError` (`code` + `cause`); it is recognized through a `Symbol.for` brand, so a check succeeds even when several copies of the kit are installed.
- A plain TS entry must return a `Promise` for a single result and an `AsyncIterable` for sessions, events and usage. Leaving a `for await` loop (`break`) cancels the iteration. Every function that does IO accepts `{ signal?: AbortSignal }`.
- Expected outcomes must be returned as values, `{ ok: true, value } | { ok: false, error }`, where `error` carries a `_tag`; a Promise-returning entry resolves to such a value. An abort rejects with `signal.reason`, and only defects throw.
- A plain TS entry takes the platform, or the part of it that it uses, as its first parameter. There is no kit object bound to a platform.
- Each context that has per-agent behavior defines its own adapter interface with a version literal (`specificationVersion`), exports a `builtinXxx: Record<CodingAgentId, XxxAdapter>` table, and accepts an `adapters` option that overrides or extends it for one call. An agent supports a capability exactly when the context's table has an adapter for it. A caller that asks for an unsupported capability by name (such as `listSessions({ agents })`) gets an `AgentKitError` with code `capability-unsupported` thrown; a stored ref that names such an agent yields a `CapabilityUnsupported` value.
- No 0.1.0 entry may depend on `effect`, in either its module graph or its published `.d.ts` graph. A consumer that never installs `effect` can import and type-check every 0.1.0 entry.
- `/catalog`, `/platform`, `/sessions` and `/transcript` must be browser-safe: bundling them for a browser target pulls in no `node:*` module or Node builtin. `/node` and `/testing` are exempt.

### `/catalog`

- Exports `CodingAgentId`, `BuiltinCodingAgentId`, `parseCodingAgentId`, `isBuiltinCodingAgentId`, the identities of the built-in agents (`builtinCodingAgents`, `CodingAgent`), `AgentHome`, `HomeRule`, `resolveHome(id, { env, home })`, `homeFromRule`, `Result`, `ok`, `err`, and `AgentKitError` with `isAgentKitError`.
- A `CodingAgentId` has documented aliases (for example `claude` for `claude-code`); an alias identifies the same agent as its canonical id.
- `resolveHome` is pure: it reads only the `env` and `home` it receives. It honors the agents' home overrides (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `XDG_DATA_HOME` for opencode, `GROK_HOME`, `PI_CODING_AGENT_DIR`), otherwise returns the agent's default directory under `home`, and reports which of the two set the path.
- `catalog` holds identity, home directory rules and `Result` only. Log layouts, hook dialects, ACP launch details and probe methods belong to the context that uses them.

### `/platform`

- Exports the `Platform` port type, `ProcessIdentity` and the other port types, and the byte-stream line splitter. `@rivus/agent-kit-collab` takes these types from here.
- `Platform` provides `env`, `home`, `os`, `fs` (`stat`, `realpath`, `list`, `read`, `writeAtomic`, `createExclusive`, `rename`, `remove`), `process` (`run`, `spawn`, `self`, `identify`), `clock` (`now`, `monotonic`) and an optional `sqlite`, with the shapes in plan 3.2.
- `fs.stat` does not follow symlinks unless `followSymlinks: true` is passed, and returns `undefined` for a missing path. `fs.realpath` returns `undefined` when the target does not exist. `fs.read` returns `AsyncIterable<Uint8Array>`, optionally limited to a byte range.
- The line splitter turns `AsyncIterable<Uint8Array>` into lines, each with its byte offset, byte length and 1-based line number. It handles CRLF line endings, a final line without a newline, and multi-byte UTF-8 characters split across chunks.

### `/node`

- Exports `createNodePlatform({ env?, home? })`, the Node implementation of `Platform`. Without arguments it uses the current process environment and the OS home directory; `env` and `home` replace them (for example a temporary `HOME` in tests).
- `process.spawn` passes only the `env` it is given and never inherits the parent environment. When its `signal` aborts, the child receives `SIGTERM`, then `SIGKILL` after a grace period. `stdin`, `stdout` and `stderr` are Web Streams.
- `process.self` is the identity of the current process (`host`, `bootId`, `pid`, `startTime`). `process.identify(pid)` returns `undefined` when no process has that pid; when the pid was reused, its `startTime` differs from the recorded identity.
- `/node` is the only entry that binds to Node.

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
- Events form a flat list and reference each other through `agentId`, `parentId`, `requestId`, `callId` and `shadowedBy`. The session also has an `agents[]` list in which each subagent records its `parentId` and `spawnEventId`. Translation sets these references; consumers do not need to understand agent log formats to follow them.
- Every source record is accounted for: it becomes one or more events or is recorded as skipped. A line that cannot be parsed is skipped, not a failure. An unrecognized format generation is a failure with the `UnknownFormatGeneration` `_tag`.
- Event ids are unique within a session, and reading the same files again yields the same ids in the same order. `seq` orders the events. Every `tool_result` is paired with its `tool_call` through `callId`, or marked orphan. Events replaced by a compaction carry `shadowedBy`.
- Every event has a source pointer (file, byte offset, byte length, line number); reading those bytes returns the original record.
- Usage numbers exposed by `/transcript` follow the `Usage` interface definition in plan 3.11: input includes cached tokens, output includes reasoning, and a missing value stays missing instead of becoming 0.
- Turn trees, timelines, context reconstruction, truncation of long text, prompt deduplication and source file numbering are not part of `/transcript`.

### `/testing`

- Exports `createMemoryPlatform({ files })`, an in-memory `Platform` (without `process` and `sqlite`) whose file system holds the given files, and the conformance suite of each context that has one. In 0.1.0 that is `sessionAdapterConformance`, with `oversizedSession` to build its large sample; each check is a named function that rejects on failure, so any test runner can run it.
- Readers produce the same results on the memory platform as on the Node platform over the same files.
- The sessions conformance suite checks a `SessionAdapter` against sample logs: listing reads at most 128 KB per file, event ids are stable and unique, every record is accounted for, tool results are paired, compaction shadowing holds, references between events and lanes resolve, source pointers read back, declared capabilities match the output, and summaries equal the folded transcript. Built-in adapters and third-party adapters run the same suite; keeping `node:*` out of adapters is the boundary test's job.

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

#### `/harness/events` (P3)

- `readHookEvent(agent, payload, env)` is synchronous, does no IO and has zero dependencies; a hook process loads only this entry.
- It returns a LifecycleEvent with `agent`, `phase` (`start`, `activity`, `blocked`, `finish`, `unknown`) and the optional `scope`, `outcome`, `blocker`, `turnId`, `subagent`, `tool` (name only), `sessionId`, `cwd`, `transcriptPath`, `terminal` and `nativeEvent` fields of plan 3.8.
- The reported agent is the real source: `env.GROK_SESSION_ID` or a payload with `hookEventName` means Grok; `payload.cursor_version` or `env.CURSOR_VERSION` means Cursor; otherwise the declared agent.
- `reduceLifecycle(state, event, { ttlMs })` returns `idle`, `working`, `blocked` or `unknown`, ignores late events from older turns, and falls back after the TTL.

#### `/discovery` (P4)

- `detectAgents` returns `Installation[]` with evidence (command on `PATH`, application path, configuration directory, version output), a status of `runnable`, `found`, `missing` or `unknown`, the version and the login state. Probe commands run with a timeout.

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

### S21: 0.1.0 works without Effect

- Given a consumer project that does not install `effect`
- When it imports and type-checks every 0.1.0 entry
- Then both succeed, and neither the module graph nor the `.d.ts` graph of any entry reaches `effect`

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

### S30 (planned, P3): Hook events name the real source

- Given a Claude-style hook payload delivered with `GROK_SESSION_ID` in the environment
- When `readHookEvent('claude-code', payload, env)` is called
- Then it returns synchronously with `agent` set to Grok

### S31 (planned, P3): Late events from older turns are ignored

- Given a `finish` event for turn 2 followed by a late `activity` event for turn 1
- When `reduceLifecycle` folds them
- Then the state stays `idle`

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

### S36 (planned, P4): Detection reports a status per agent

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

## Compatibility And Constraints

- Public API: `@rivus/agent-kit` exposes subpath entries only; the shell package re-exports each name explicitly from the internal packages' public surface, so every change to the public surface shows up in review. Correcting an agent fact (a path, an event name) is a patch; adding an agent, an event type or a capability is a minor; dropping a Node LTS is a major. Unstable APIs live under `/experimental/*`. Adapter interfaces carry version literals so that a later `sessions-v2` can coexist with `sessions-v1`.
- Persisted data: 0.1.0 writes nothing and opens agent logs read-only. Planned harness state (the ledger and its lock files) lives under `$XDG_STATE_HOME`, outside dotfiles source directories.
- Configuration: agent home overrides (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) are read from the `env` passed to the kit, never from the global process environment directly.
- Operational bounds: ESM only, `sideEffects: false`, `engines.node >=22.13` (development and CI use Node 24), MIT. Published type declarations do not reference the private internal packages. Listing reads at most 128 KB per session file. Planned lock-based features support local directories only, not NFS.
- Dependencies: `zod/mini` is the only validation library, except in `/harness/events`, which uses no dependencies. `effect` becomes an optional peer pinned to exactly 4.0.1 with the first Effect entry (P3); consumers of plain TS entries never need it.

## Acceptance Evidence

- Scenario IDs and corresponding tests: each test that proves a scenario cites its ID in the test name. S1–S3 are covered by catalog unit tests; S4–S9 by sessions tests on the memory platform; S10–S18 by transcript tests and by the sessions conformance suite, which runs for every built-in adapter on scrubbed sample logs; S19 and S23–S25 by platform-node tests; S20 by the browser bundle check; S21 by the architecture boundary test and the package checks; S22 by the line splitter unit tests. Planned scenarios S26–S40 are linked when their phase starts.
- Runtime or package evidence: `npm run check` and the package checks (publint, attw, size budgets, browser bundle check) on the packed shell; the trace viewer's adoption in P1, where its tests and the conformance tests pass and its session list matches its main branch.
