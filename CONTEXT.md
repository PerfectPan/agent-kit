# agent-kit Language

This glossary defines the terms that code, documentation and reviews in this repository use. Terms are grouped by bounded context: a term means what its context says, and the same word in another context, or in a consuming project, can mean something else (see [Same name, different meaning](#same-name-different-meaning)). The context analysis behind it is in [plan 0001, section 3.1](docs/plans/0001-agent-kit.md#31-bounded-context-analysis); authoring rules are in [docs/architecture/authoring.md](docs/architecture/authoring.md).

`@rivus/agent-kit` connects to external coding agents: catalog, discovery, sessions (with transcript), cost, harness, acp, and the redact utility. `@rivus/agent-kit-collab` provides collaboration primitives between agents: lease (with the process lock) and lanes. Platform is a technical port, not a bounded context.

## catalog (shared kernel)

**CodingAgent**:
A third-party coding agent product, such as Claude Code, Codex or Grok.
_Avoid_: agent on its own where a host application's Agent could be meant

**CodingAgentId**:
The id of a CodingAgent, such as `claude-code` or `codex`. Documented aliases, such as `claude`, identify the same CodingAgent.

**AgentHome**:
The configuration and data root of a CodingAgent, including its overrides such as `CLAUDE_CONFIG_DIR` and `CODEX_HOME`.
_Avoid_: home on its own, which means the user's home directory

**Result**:
The value `{ ok: true, value } | { ok: false, error }` that plain TS functions return for expected outcomes; `error` carries a `_tag`. It is the only type shared by every context.

## discovery

**Installation**:
What is known about one CodingAgent on this machine: its evidence, DetectionStatus, version, AuthState and the ProbeProblems of checks that could not complete.

**Evidence**:
One observation that an agent is present: a command on `PATH`, version output, an application path, a configuration path, or an MCP configuration path.

**DetectionStatus**:
The classification of an Installation from its evidence: `runnable` (the version probe succeeded), `found` (other evidence), `missing` (every check completed and found nothing) or `unknown` (nothing found, but a check could not complete).

**AuthState**:
Whether the agent is logged in, as far as detection can tell: `logged-in`, `logged-out` or `unknown`. By default it comes from credential files and authenticating variables, which can only say `logged-in`; the agent's own status command, run only on request, is the only source of `logged-out`.
_Avoid_: reading a missing credential file as logged out

**ProbeRecipe**:
How discovery detects one agent: executable names, application, configuration and MCP paths, the version probe and the login checks, with the caveats about its facts.

**ProbeProblem**:
A check that could not complete: a path that could not be checked (`StatFailed`), a probe command that could not start, timed out or printed something its parser does not recognize (`CommandFailed`), or a credential file that could not be read or recognized (`CredentialFileFailed`).

## sessions

**Session**:
One conversation of one CodingAgent, as recorded in that agent's own files.
_Avoid_: AcpSession, a host application's session

**SessionRef**:
The reference to a Session. It carries the CodingAgentId, so later calls reach the right adapter.

**SessionHead**:
The summary of a Session that listing produces from the head and tail of its files, without reading it fully.

**Transcript**:
The ordered TranscriptEvents of a Session, merged from all its files, with the records that were skipped.

**TranscriptEvent**:
One event in a Transcript. Its `kind` is one of `user`, `assistant`, `reasoning`, `tool_call`, `tool_result`, `request`, `system`, `compaction`, `hook`, `unknown`. Events form a flat list and reference each other by id.
_Avoid_: thinking (use reasoning), message as the general word for an event

**Turn**:
One exchange in a recorded Session: a user input and the agent's work in response.

**Request**:
One model request inside a Turn; the events it produced share a `requestId`, and its stop reason is `finishReason`.
_Avoid_: stopReason

**Lane**:
One subagent's execution line inside a Session, identified by its `agentId`, with a `parentId` and the event that spawned it.

**Compaction**:
An event where the agent replaced earlier context with a summary. Events it replaced carry `shadowedBy` pointing to it.

**Orphan**:
A `tool_result` whose `tool_call` is not in the Session.

**SourcePointer**:
The location of the original record of an event: file, byte offset, byte length and line number. Reading those bytes returns the record.

**Skipped record**:
A line that could not be parsed. It is recorded with its SourcePointer instead of failing the read.

**Format generation**:
A version of an agent's log format. A generation the adapter does not recognize is reported as an error; single unreadable lines are skipped records.

**Usage**:
Token counts in the community convention: `inputTokens` includes cache reads and writes, `outputTokens` includes reasoning, and the cache and reasoning counts are subsets. A missing count is absent, never 0.

**UsageRecord**:
Usage attributed to an agent, a Session and a source, with a granularity: `request` (one model request), `turn` or `session` (an aggregate, with `modelCalls`). An aggregate is never split into invented per-request records.

**UsageSource**:
A file, directory or database that holds one agent's usage, such as a session file or opencode's database. Usage is decoded one source at a time.

**UsageCursor**:
Where a decode of one UsageSource stopped, as plain data: the bytes read and the state the agent's rules carry between records. A later decode continues from it and reads only what was written since.

**Usage scan**:
A decode of every UsageSource of the chosen agents that continues from the previous scan's state (a UsageCursor per source and the request keys seen) and counts a request that several files hold once.

## cost

**PricingTable**:
Prices per model, injected by the caller; the kit ships no price data. A key is a model id or a part of model ids, such as a family alias; a model takes its own id, else the longest key it contains.

**Price**:
The prices of one model, in USD per million tokens, for input without cache, cache read, cache write (5-minute and 1-hour) and output.

**Cost**:
An amount in USD for a UsageRecord or a summary, with its CostSource. A record whose model has no price has no Cost, which is not a Cost of 0.

**CostSource**:
Where a cost comes from: `agent` (reported by the agent itself) or `pricing-table` (computed by the kit).

**CalendarWindow**:
The last N calendar days up to now, from a midnight in a time zone, over which usage is summarized: 1 is today, 7 is today and the six days before.

**UsageSummary**:
Usage and cost totals over a CalendarWindow, overall and grouped by agent, model or both.

## harness

**Harness**:
The part of a CodingAgent's runtime that can be extended: skills, hooks, MCP servers, instructions and plugins. The harness context injects into it and reads lifecycle signals back.
_Avoid_: integrations

**Bundle**:
What one Owner wants installed into Harnesses: hooks, skills and other Artifacts, with a version and a digest.

**Owner**:
The application on whose behalf Artifacts are installed, such as `agent-presence`. Every LedgerEntry has one.

**ForeignOwner**:
Another tool that manages the same files, such as chezmoi. harness reads what it manages and does not touch its paths.

**Artifact**:
One installed thing: a file, directory, symlink, JSON or TOML entry, managed block, or registration through an agent's command line.

**Strategy**:
How an Artifact reaches the agent, in order of preference: launch-time injection, native plugin, scanned directory, shared configuration edit.

**InstallPlan**:
The immutable result of comparing a Bundle with the Ledger and the files on disk: the steps, diffs, agent commands and expected TrustPrompts. It is refused when the Ledger changed after it was built, and rejected as a whole on an unresolved conflict.

**PlanStep**:
One action of an InstallPlan on one Artifact (`create`, `update`, `adopt`, `remove`, `noop`, `conflict`), with the precondition it re-checks before writing.

**Ledger**:
The local record of what harness installed, per scope, with a lineage and a strictly increasing revision. Every modification happens while the LedgerLock is held. An unknown ledger version is refused or kept whole, never cleared.

**LedgerEntry**:
The Ledger's record of one Artifact: owners, content hash, pre-image and the versions that installed it.

**Pre-image**:
What existed at an Artifact's location before harness wrote it, kept so that uninstall can restore it.

**Pending operation**:
A PlanStep recorded in the Ledger before its target is touched and cleared once its outcome is known. After a crash, the next holder of the LedgerLock probes the target and resolves the operation instead of replaying it.

**Legacy marker**:
A substring by which an Owner recognizes what its older versions installed without a Ledger, such as their hook command lines, so that a plan replaces or removes those Artifacts instead of installing them a second time.

**LedgerLock**:
The lock held for the whole of each Ledger modification. By default it is an SQLite exclusive lock that the kernel releases when the holding process exits.

**Drift**:
A difference between the disk, the Ledger and the desired state, found by three-way verify: outdated, user-modified, deleted externally, or adoptable.

**TrustPrompt**:
A confirmation the agent will ask the user for after installation, such as reviewing a new hook. A plan announces it and never approves it.

**HookDialect**:
One agent's hook facts: event names, timeout unit, permission semantics and response format per event, and how it records trust. It is the only source of these facts.

**LifecycleEvent**:
A hook payload translated into orthogonal fields: `phase` (`start`, `activity`, `blocked`, `finish`, `unknown`), optional `scope`, `outcome`, `blocker`, `turnId`, `subagent`, `tool`, and identity fields. `agent` is the real source after sniffing.

**LifecycleState**:
What `reduceLifecycle` keeps per session: a status (`idle`, `working`, `blocked`, `unknown`), who raised each open block, the current turn, recently ended turns and the time of the last event. A busy status reads as `unknown` after the TTL. Main-agent activity answers only the main agent's own block; a subagent's block closes on that subagent's next event or when the main turn starts or finishes, and one raised by a subagent without an id only expires.

**Gate**:
A hook event whose response decides whether the operation it announces proceeds, such as Cursor's `preToolUse`. An observing hook registered on a gate prints the dialect's pass-through output.
_Avoid_: guessing gates from event name prefixes

## acp

**Connection**:
A running ACP agent process that the kit started, after the handshake.

**AcpProfile**:
How one agent is launched over ACP and how it expects `_meta` fields.

**AcpSession**:
A live ACP session on a Connection. It is a state machine (starting, ready, turn in progress or awaiting permission, cancelling, closed) that runs at most one Turn at a time.
_Avoid_: Session (the recorded conversation)

**Turn (acp)**:
One prompt and the agent's live response inside an AcpSession.

**PermissionRequest**:
The agent asking the caller to allow an action during a Turn.

**PermissionDecision**:
The caller's answer to a PermissionRequest. Without an answer the request is denied.

**SessionBinding**:
The mapping from the caller's `sessionKey` to an ACP `sessionId`. It is invalidated when a cancel does not settle in time.

## lease (collab)

**Lease**:
Exclusive, expiring ownership of a key by one Holder.

**Holder**:
The process that holds a Lease, identified by host, boot id, pid and start time, so that a reused pid is not mistaken for the holder.

**Generation**:
The fencing token of a Lease. It increases on creation and takeover, never decreases, not even after release, and heartbeats do not change it.

**Revision**:
A counter that increases on every write of a lease record; stores compare it for CAS.

**TTL**:
How long a Lease stays valid without a Heartbeat, judged by the observer's monotonic clock.

**Heartbeat**:
A renewal that keeps a Lease alive. Heartbeat × 2 must not exceed the TTL.

**Tombstone**:
A released lease record kept with no holder, so the Generation cannot go backwards.

**FenceCheck**:
The check that rejects a write carrying an older Generation than the protected resource has seen.

**Fence**:
The per-key guard a LeaseStore holds across processes while one fenced operation runs, so that a successor's fenced work starts only after the old holder's fenced fiber has ended. A non-cancellable write in that fiber keeps the fence only inside `Effect.uninterruptible`.

**Observation**:
When an observer first saw the current Revision of a lease record, by its own monotonic clock; a held lease expires for that observer once the Revision has not changed for the TTL.

**ProcessLock**:
A single-instance lock for a path, released by the kernel when the process exits. Without SQLite it falls back to a lock file whose dead holder is reclaimed, one reclaimer at a time.

## lanes (collab)

**Lane (lanes)**:
A scheduling unit identified by a key; work for one key runs serially. A Lane is idle, queued (waiting for Capacity) or running one Activation.

**Activation**:
One run of the work for a Lane, in a Scope of its own.

**Wake**:
A request to run a Lane. Wakes that arrive before an Activation starts coalesce into it: a queued Lane stays queued, and a running Lane owes one pending Activation however often it is woken.

**Capacity**:
The maximum number of activations running at once across all Lanes.

**QueueBound**:
The maximum number of Lanes waiting for Capacity. A Lane waits at most once, and a running Lane's pending Activation is not counted until it waits.

**TurnTimeout**:
The longest one Activation may run, from its start; then it is interrupted.

## Technical terms

**Platform**:
The port through which the kit reaches files, processes, environment variables, clocks and SQLite. It has no domain language. `/node` implements it for Node and `/testing` provides an in-memory version. Effect code reads it from `PlatformService` (`/platform/effect`), which `NodePlatformLive` (`/node/effect`) provides.

**redact**:
A utility module of pure functions that remove home path spellings and secret keys from values and text. It has no domain model.

**Agent adapter**:
The per-agent implementation of a context's adapter interface, under `agents/<agent>/`. It translates the agent's external format into the context's model and is registered in that context's `builtinXxx` table.

**Port adapter**:
An implementation, under `adapters/`, of a port the kit declares itself, such as a format-preserving configuration editor or a ledger store.

**Entry**:
A public subpath of a published package, such as `@rivus/agent-kit/sessions`.

**Shell package**:
The published package `@rivus/agent-kit`, whose entries only re-export names from the internal packages' public surface; the internal packages are bundled into it at build time. `@rivus/agent-kit-collab` is published too, in the same lockstep version, but keeps its own code under `src/<entry>/`.

**Conformance test**:
A test suite, exported from `/testing`, that checks an agent adapter or a store against a context's interface definition. Built-in and third-party adapters run the same suite.

## Same name, different meaning

| Word | In agent-kit | Elsewhere |
| --- | --- | --- |
| Agent | CodingAgent: a third-party coding agent product | An Effect-based host application's Agent: the product that host runs |
| Harness | The extensible part of an agent's runtime, and the context that injects into it | A host application's AgentHarness (the execution model of one run); AI SDK's HarnessV1 (an adapter that drives an agent's runtime); agent-orchestration's Harness (the configuration passed to the agent on every turn, the closest to this meaning). A consumer that uses two of them aliases the import |
| Session | In sessions, a recorded conversation read from the agent's files; in acp, AcpSession, a live session the kit drives | A host application's Session Key |
| Turn | In sessions, a recorded turn in a Transcript; in acp, a live Turn in an AcpSession | A host application's Agent Run |
| Lane | In sessions, a subagent's execution line; in lanes, a scheduling unit serialized by key | Each context keeps its own meaning; the two are never mixed |
| Generation | In lease, the fencing token | In sessions, a format generation of an agent's logs |
| Revision | The Ledger's revision (per apply or uninstall) and a lease record's revision (per write) | Each counter belongs to its own record |
| Adapter | An agent adapter (`agents/`) or a port adapter (`adapters/`) | An ACP adapter: an agent's ACP server program, such as claude-agent-acp |
| Scope | An install scope (`user` / `project`); `LifecycleEvent.scope` (`session` / `turn`) | An Effect `Scope`, which owns long-lived resources |
| Event | TranscriptEvent (recorded activity) and LifecycleEvent (hook signal) | Domain events returned by aggregate transitions; ACP `session/update` notifications |
| Lock | LedgerLock (harness), ProcessLock and Lease (collab) | harness cannot depend on collab, so the LedgerLock and the ProcessLock are separate implementations of the same technique |
| Input tokens | Include cache reads and writes (OTel GenAI, AI SDK) | Anthropic, the Claude Agent SDK, ccusage and Langfuse count input without cache |
