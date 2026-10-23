# agent-kit Language

This glossary defines the terms that code, documentation and reviews in this repository use. Terms are grouped by bounded context: a term means what its context says, and the same word in another context, or in a consuming project, can mean something else (see [Same name, different meaning](#same-name-different-meaning)). Authoring rules are in [docs/architecture/authoring.md](docs/architecture/authoring.md).

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

**HomeRule**:
The data that resolves an AgentHome from the caller's home and environment. A service's own rule takes precedence over its identity's fallback rule.

**Service table**:
A `ServiceTable<T>`: a read-only partial record of one service, keyed by CodingAgentId. Context use cases receive their tables from the caller; the shell assembles built-in tables from providers.

**CapabilityUnsupported**:
The expected result when data names an agent with no implementation of the required service. Explicitly requesting an unsupported agent instead throws `AgentKitError` with code `capability-unsupported`.

**Result**:
The value `{ ok: true, value } | { ok: false, error }` that plain TS functions return for expected outcomes; `error` carries a `_tag`. It is the only type shared by every context.

## discovery

**Installation**:
What is known about one CodingAgent on this machine: its evidence, DetectionStatus, version, AuthState and the ProbeProblems of checks that could not complete.

**Evidence**:
One observation that an agent is present: a command on `PATH`, version output, an application path, or an agent-owned state path. The `config` and `mcp-config` kinds remain in the interface; built-in recipes exclude installer-writable configuration and use session or credential paths for `config`.

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
One event in a Transcript. Its `kind` is one of `user`, `assistant`, `reasoning`, `tool_call`, `tool_result`, `request`, `system`, `compaction`, `hook`, `unknown`, and it determines the type of its `payload` (`TranscriptEventPayloads` maps each kind to that type); a payload may carry fields of the agent's own beyond that type. Events form a flat list and reference each other by id.
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
How an Artifact reaches the agent: launch-time injection, native plugin, scanned directory, shared configuration edit. Each agent's InstallAdapter declares the Strategies it supports in its own order of preference; the flow chooses a caller override the adapter declares, otherwise the first declared strategy whose required executable is on `PATH` — launch-time injection included, whenever an adapter declares it (none of the built-in ones does).

**InstallAdapter**:
One agent's install knowledge (`harness-v1`): which Strategies it supports for hooks and skills, in order of preference, and how each renders a Bundle into Artifacts at that agent's paths. A pure service supplied by a provider alongside its HookDialect.

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

**Legacy entry**:
One untracked Artifact an older version of the Owner left without a Ledger, recognized by its Legacy markers. The internal `findLegacy` use case lists them without writing: agent, locator, kind, a hook entry's event and command, and whether planning would replace the entry or protect it — kept as the user's, or indistinguishable from the user's own because an owned hook is missing from its event. Every built-in InstallAdapter covers its `kind: "file"` Artifacts with legacy sources. Grok's source is only its canonical `hooks/<owner-slug>.json`; a differently named file stays outside legacy cleanup even when it mixes the user's own hook with a marked hook. Built-in directory sources ignore extensions the agent does not load. A custom adapter's rendered paths still need declared legacy sources, and listing a symlinked or externally managed file as `replace` does not resolve planning's path conflict; the harness legacy-source tests state the boundary.

**LedgerLock**:
The lock held for the whole of each Ledger modification. By default it is an SQLite exclusive lock that the kernel releases when the holding process exits.

**Drift**:
A difference between the disk, the Ledger and the desired state, found by three-way verify: outdated, user-modified, deleted externally, or adoptable.

**TrustPrompt**:
A confirmation the agent will ask the user for after installation, such as reviewing a new hook. A plan announces it and never approves it.

**HookDialect**:
One agent's hook facts: event names, timeout unit, permission semantics and response format per event, and how it records trust. It is the only source of these facts.

**Host marker**:
A HookDialect declaration (`hostMarkers`) that identifies the coding agent actually running a hook from payload fields or environment variables. It is runtime evidence, distinct from an agent marker used by lint.

**Foreign hooks**:
A HookDialect's `foreignHooks` declaration: hooks belonging to another agent that this agent also runs. The relation names the other agent by id.

**LifecycleEvent**:
A hook payload translated into orthogonal fields: `phase` (`start`, `activity`, `blocked`, `finish`, `unknown`), optional `scope`, `outcome`, `blocker`, `turnId`, `subagent`, `tool`, and identity fields. `agent` is the real source after sniffing.

**LifecycleState**:
What the internal `reduceLifecycle` function keeps per session: a status (`idle`, `working`, `blocked`, `unknown`), who raised each open block, the current turn, recently ended turns and the time of the last sign of life. A busy status reads as `unknown` after the TTL. Main-agent activity answers only the main agent's own block; a subagent's block closes on that subagent's next event or when the main turn starts or finishes, and one raised by a subagent without an id is replaced on every id-less raise and expires one TTL after its `raisedAt`.

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

**Stream part**:
One part of a live Turn's stream: a delta named after AI SDK's stream parts (`text-delta`, `tool-input-*`, `finish`), or a completed event. Folding the deltas gives the completed events, which are TranscriptEvents without a SourcePointer.

## lease (collab)

**Lease**:
Exclusive, expiring ownership of a key by one Holder.

**Holder**:
The process that holds a Lease, identified by host, boot id, pid and start time, so that a reused pid is not mistaken for the holder.

**Generation**:
The fencing token of a Lease. It increases on creation and takeover, never decreases, not even after release, and heartbeats do not change it.

**Revision**:
A counter that increases on every write of a lease record; repositories compare it for CAS.

**TTL**:
How long a Lease stays valid without a Heartbeat, judged by the observer's monotonic clock.

**Heartbeat**:
A renewal that keeps a Lease alive. Heartbeat × 2 must not exceed the TTL.

**Tombstone**:
A released lease record kept with no holder, so the Generation cannot go backwards.

**FenceCheck**:
The check that rejects a write carrying an older Generation than the protected resource has seen.

**Fence**:
The per-key guard a LeaseRepository holds across processes while one fenced operation runs, so that a successor's fenced work starts only after the old holder's fenced fiber has ended. A non-cancellable write in that fiber keeps the fence only inside `Effect.uninterruptible`.

**Observation**:
When an observer first saw the current Revision of a lease record, by its own monotonic clock; a held lease expires for that observer once the Revision has not changed for the TTL.

**ProcessLock**:
A single-instance lock for a path, released by the kernel when the process exits. It records its holder's identity for diagnostics only, so a process that cannot read its own identity still takes it, with the holder unknown. Without SQLite it falls back to a lock file whose dead holder is reclaimed, one reclaimer at a time; the lock file needs the identity to judge its holder, so it cannot be taken without it. Acquisitions of one lock inside a process take turns in memory, so none attempts it while another one in the process holds or attempts it. Turns cover acquisitions through the same `sqlite` object (without SQLite, the same `fs`) that name the same directory, resolved through symlinks, and the same last segment, which is not followed; any others exclude each other in SQLite or the lock file, as processes do. `isProcessLockHeld` checks whether it is held without taking it or writing anything. Another check never takes a check for a holder, nor does an acquisition's first attempt; with SQLite, a retry of a waiting acquisition can, and the acquisition gets the lock after another backoff.

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
A provider's implementation of a context SPI interface, translating the agent's external format into the context model or supplying its agent-specific behavior. It lives in `packages/providers/<agent>/`, not in a context's domain adapters.

**Provider**:
One agent's service implementations and facts, grouped in a private package named `@rivus/agent-kit-provider-<agent>`. Built-in provider packages are bundled into the shell.

**Provider descriptor**:
A `Provider` value exported through `/providers`: an id and the optional service implementations it supplies. `builtinProviders` contains the built-in descriptors; routed calls accept descriptors in their `providers` option.

**Service**:
One capability a provider implements: identity, discovery, hooks, install, sessions, usage or ACP. A context owns the model and use cases; a service is the unit of routing.
_Avoid_: confusing a provider service with a domain service or an Effect `Context.Service`

**SPI entry**:
A context's `spi.ts`, exposed as `./spi`: provider interface types and the shared helpers their implementations use. Access is granted separately from sibling entry access in the boundary manifest.

**Sibling entry**:
An internal package entry explicitly allowed for other workspace packages, such as `public` or `public/events`. It is listed in `siblingEntries`; the importer declares `dependsOn`. It need not be published by the shell.

**Shared format adapter**:
A pure external-format reader or renderer in a context's `domain/<concept>/adapters/`. It has no agent-specific knowledge and does not implement an IO port.

**Agent marker**:
An agent-specific id, alias, home directory or environment name declared in a provider's `agentMarkers`. Boundary lint uses these values to detect agent facts in context source.

**Snapshot**:
The plain data representing an aggregate, entity or value at a boundary. Write-side classes expose it through `toSnapshot()` and restore it where needed; it carries no methods.

**Repository**:
The port an aggregate is stored through: `load` reads the stored snapshot or `undefined`, and `save` writes only over the revision it is shown, failing with a `RevisionConflict`. Each context declares its own `RevisionConflict`; the shape rules are in [authoring.md](docs/architecture/authoring.md).

**Port adapter**:
An implementation, under `infra/`, of a port the kit declares itself, such as a format-preserving configuration editor, an aggregate repository, or the session-binding key-value store. Persistence implementations live in `infra/repository/`, stored formats and codecs in `infra/models/`.

**Entry**:
A public subpath of a published package, such as `@rivus/agent-kit/sessions`.

**Shell package**:
The published package `@rivus/agent-kit`, whose entries re-export selected internal public names and bind routed functions to provider service tables; internal contexts and providers are bundled into it at build time. `@rivus/agent-kit-collab` is published too, in the same lockstep version, but keeps its own code under `src/<entry>/`.

**Conformance test**:
A test suite, exported from `/testing` (the aggregate-repository suite from `/testing/effect`), that checks an agent adapter or a repository against a context's interface definition. Built-in and third-party adapters run the same suite.

## Same name, different meaning

| Word | In agent-kit | Elsewhere |
| --- | --- | --- |
| Agent | CodingAgent: a third-party coding agent product | An Effect-based host application's Agent: the product that host runs |
| Host | The machine a process runs on (a Holder's `host`, `platform.process.self.host`); as `TerminalHost`, the terminal an agent runs in; the runtime or application that embeds the kit. The coding agent whose sessions are read is the agent (CodingAgent), and its command-line program is its CLI | Some session readers call that coding agent the host |
| Harness | The extensible part of an agent's runtime, and the context that injects into it | A host application's AgentHarness (the execution model of one run); AI SDK's HarnessV1 (an adapter that drives an agent's runtime); agent-orchestration's Harness (the configuration passed to the agent on every turn, the closest to this meaning). A consumer that uses two of them aliases the import |
| Session | In sessions, a recorded conversation read from the agent's files; in acp, AcpSession, a live session the kit drives | A host application's Session Key |
| Turn | In sessions, a recorded turn in a Transcript; in acp, a live Turn in an AcpSession | A host application's Agent Run |
| Lane | In sessions, a subagent's execution line; in lanes, a scheduling unit serialized by key | Each context keeps its own meaning; the two are never mixed |
| Generation | In lease, the fencing token | In sessions, a format generation of an agent's logs |
| Revision | The Ledger's revision (per apply or uninstall) and a lease record's revision (per write) | Each counter belongs to its own record |
| Adapter | An agent adapter (a provider), a shared format adapter (domain `adapters/`) or a port adapter (`infra/`) | An ACP adapter: an agent's ACP server program, such as claude-agent-acp |
| Scope | An install scope (`user` / `project`); `LifecycleEvent.scope` (`session` / `turn`) | An Effect `Scope`, which owns long-lived resources |
| Event | TranscriptEvent (recorded activity) and LifecycleEvent (hook signal) | Domain events returned by aggregate transitions; ACP `session/update` notifications |
| Lock | LedgerLock (harness), ProcessLock and Lease (collab) | harness cannot depend on collab, so the LedgerLock and the ProcessLock are separate implementations of the same technique |
| Input tokens | Include cache reads and writes (OTel GenAI, AI SDK) | Anthropic, the Claude Agent SDK, ccusage and Langfuse count input without cache |
