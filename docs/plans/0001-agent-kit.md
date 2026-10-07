# agent-kit: a shared foundation for agent projects

agent-presence, a trace viewer and agent-task-loop (plus an editor plugin) each implement their own code for working with third-party coding agents. This plan moves that code into two npm packages: `@rivus/agent-kit` (connect to external coding agents) and `@rivus/agent-kit-collab` (agent collaboration primitives). The Effect-based host application that runs agents stays independent.

- Status: accepted (all decisions confirmed, see section 7); P0 and P1 implemented, 0.1.0 ready to release (6.3); the kit side of P5 implemented; collab's `/lanes` of P6 implemented
- Owner: PerfectPan
- Reviewer: codex (review rounds in [A.5](#a5-review-record))
- Last updated: 2026-10-07
- Paired Spec: [docs/specs/0001-agent-kit.md](../specs/0001-agent-kit.md) (the kit's public entries; each application's external behavior stays the same)
- Repository: `PerfectPan/agent-kit`, generated from `PerfectPan/project-template-rush` after the decisions were confirmed

## Contents

- [1. Background and goals](#1-background-and-goals)
- [2. Outline](#2-outline)
- [3. Detailed design](#3-detailed-design)
- [4. Release and rollback](#4-release-and-rollback)
- [5. Verification](#5-verification)
- [6. Execution plan](#6-execution-plan)
- [7. Risks and open questions](#7-risks-and-open-questions)
- [Appendix](#appendix)

Consumers that are not public are named by role: "the host application" is a private Effect-based host application that runs agents, "the trace viewer" is a private browser viewer for agent sessions, and "the editor plugin" is a closed-source editor plugin that will bundle the kit's zero-dependency entry.

## 1. Background and goals

### 1.1 Current behavior and constraints

All of these projects publish under the `@rivus/*` scope:

| Project | What it does | Code that deals with agents |
| --- | --- | --- |
| Host application (private, GPL) | Runs agents through Pi/ACP and connects them to a chat platform; Effect v4 | The "run" half: the run event model, the Pi/ACP loop, harness, side-effect guards. No detection, no reading of other agents' logs, no usage, no hooks |
| agent-task-loop (public, GPL) | Task dispatch → execution → review → pull request | agent-finder (MoonBit, detects 26 agents), agent-sessions (Claude/Codex session discovery and preview), agent-orchestration (lease, inbox, ACP connector, ToolServer) |
| agent-presence (public, MIT) | Syncs the number of running agents and their token usage to a chat profile signature | Usage scanners for 6 agents, hook installation and event parsing, a price table, a source plugin mechanism |
| Trace viewer (private, GPL) | Shows Claude/Codex/Grok sessions in the browser and reconstructs the context the model actually saw | A reading kernel plus per-agent host parsers (Claude, Codex, Grok) and a 13-check conformance suite; browser-safe |
| Editor plugin (closed source) | Feeds its editor's agent into presence as a source | Because presence has no importable library, it copied presence's file-reading code and a Codex-style usage calculation |

### 1.2 Problem

The same knowledge about each agent is spread over four or five places. Each place covers only some agents, and they have started to diverge. Every item below was checked against the source:

- Copied code has already drifted: the editor plugin's Codex usage calculation only takes differences of cumulative totals. It does not prefer `last_token_usage` and does not skip the replay at the start of a forked session.
- Path rules disagree: only presence honors `CLAUDE_CONFIG_DIR` and scans Codex `archived_sessions`; the trace viewer and agent-sessions hard-code paths; none of them honors `CODEX_HOME`.
- There are two usage conventions: the trace viewer's input includes cached tokens (the OTel convention); presence splits cached tokens out.
- Agent facts are wrong: presence writes `timeout: 5000` into Claude and Codex hooks, but both agents measure the timeout in seconds (agent-presence #85). It uses Claude's event names for Gemini, and 4 of the 6 do not exist (agent-presence #86).
- The same agent has 4 sets of ids: agent-finder says `claude-code`, agent-sessions says `claude`, agent-task-loop has its own short ids, agent-orchestration has `claude | codex | opencode`.
- Applications also duplicate code internally: agent-task-loop has 3 copies each of `safeSegment` and atomic JSON writes; the host application has two redaction implementations; session root directories, resume commands and stream-json parsing exist in 2 copies each.

agent-task-loop already has a draft, `docs/plans/0008-shared-agent-infrastructure.md`. It covers only agent-task-loop and presence, leaves out the trace viewer (which has the best parsing layer), and plans to publish the weakest piece, agent-sessions, as the shared layer. This plan replaces it.

### 1.3 Goals and success criteria

- Each agent's knowledge is maintained in one place: identity and paths in `catalog`; what the agent stores and how to read it in `sessions`; what can be extended and how to install it in `harness`; what is installed on this machine in `discovery`; how to drive the agent in `acp`. `catalog` holds only identity and home directories.
- Each application deletes its own duplicate implementation (see "Adoption" in each phase of 6.3). Its tests still pass and its external behavior does not change. presence's token totals are equal per agent between the old and new implementations.
- Each phase ships and rolls back on its own: the kit releases first, then each application opens one adoption pull request.

### 1.4 Non-goals

- Do not move the host application's daemon, durable queue, deployment control, background sessions or chat platform adapter. There is no second consumer, and the generic part is a small fraction of that code.
- No general-purpose utilities (logging, secret storage, CLI framework, online price fetching). Applications use mature libraries when they need them.
- No application state or policy: presence's online-state machine and chat platform provider, agent-task-loop's Task/Run, the trace viewer's reconstruction and views.
- The plan review did not include creating the repository; the repository was generated after the decisions were confirmed.

## 2. Outline

### 2.1 Design principles

- Draw boundaries by what changes together: code that changes because of the same upstream change belongs to the same context. For example, when Gemini renames its events, both hook installation and hook parsing change.
- The domain layer is plain TS: no IO and no runtime framework. This matches the host application, whose domain layer does not import `effect`.
- Inject the runtime environment: the core depends only on ECMA-429 (WinterTC Minimum Common Web API) globals. Files, processes and environment variables are injected through the `Platform` port.
- Non-invasive by default: when injecting something into an agent, prefer the agent's own extension mechanism. Editing shared configuration comes last.
- An abstraction needs at least two real consumers: something with a single consumer stays in that application until a second consumer appears.

### 2.2 Boundaries and responsibilities

```text
Applications (each repository's own domain, policy, presentation and assembly root)
  agent-presence | trace viewer | agent-task-loop / room-web | editor plugin

@rivus/agent-kit: connect to external coding agents
  catalog | discovery | sessions | transcript | cost | harness | redact | acp

@rivus/agent-kit-collab: agent collaboration primitives (peer dependency on agent-kit)
  lease | process-lock | lanes

Host application: runs agents (independent)
  AgentLoop (Pi / ACP) | harness | durable queue | chat platform
```

The two packages are split by role (confirmed 2026-10-05). agent-kit connects to external coding agents: it knows them, reads their data, injects into them, and starts and drives them. agent-kit-collab provides collaboration primitives between agents (mutual exclusion, scheduling). It knows no specific agent and uses only agent-kit's `Platform` port. The dependency is one-way: collab → agent-kit. agent-task-loop uses both packages and is itself a plugin of the host application. The host application uses collab's process lock to add a single-instance lock, and may later replace its own ACP loop with `/acp`.

### 2.3 Design decisions

| Decision | Choice | Rejected alternatives and reasons |
| --- | --- | --- |
| Split dimension | By capability (bounded context); per-agent differences live inside each context | By agent: Claude's paths and event names would spread over several packages. Splitting by capability matches the combinations applications actually depend on |
| Release shape | Two packages, `@rivus/agent-kit` (connect to external coding agents) and `@rivus/agent-kit-collab` (collaboration primitives), each with subpath exports. Inside the repository, one private package per context, bundled into the matching published package at build time (as vitest 5 and MCP SDK v2 do) | One public package per capability: with a single maintainer, versions drift easily, and the same thing gets two import spellings. effect merged its v3 packages into a single v4 package for exactly this reason |
| Runtime environment | Inject a `Platform` port with an ECMA-429 baseline; only `/node` binds to Node | Separate Node-only features with export conditions: turning "can it run in a browser" into a namespace is less clear than a port and harder to test |
| Effect | Split by side-effect weight (confirmed 2026-10-06, replacing the 2026-10-05 decision that neither package uses Effect). The use cases and adapters of harness execution (apply / verify / uninstall, the ledger lock), `/acp`, collab's lease and lanes use Effect; their ports are `Context.Service`, and only Effect-native entries are exposed. The domain layer, per-agent translation, session reading, usage, cost, hook events and the process lock stay plain TS. `effect` is an optional peer, exactly 4.0.1 in the first release (3.7) | All plain TS: the ACP child process and streams, lease heartbeat and abort on loss, and lanes concurrency would need hand-written lifecycles, and the existing implementation has already missed cleanup (the ACP connector's timeout helper does not clear its timer and listeners after a normal finish). All Effect: translation is pure computation, and reading, detection and the process lock have simple lifecycles that plain TS handles; converting them gains little and costs hook cold start, the editor plugin's zero-dependency entry and browser bundle size. A Promise facade plus native dual API: the facade itself is the most error-prone boundary, and all three current consumers can run Effect in their own assembly root (settled after two rounds of discussion with codex) |
| Price data | Not shipped with the kit. `/cost` only provides formulas and lookup; the application injects the price table (presence keeps maintaining its snapshot) | A separate pricing package: only presence uses it today; wait for a second consumer |
| In-session MCP tool server | Not in the kit for now (confirmed 2026-10-05). agent-orchestration's ToolServer stays where it is for room-web; `/acp` only accepts MCP server descriptions and does not care who implements them | Put it in `/mcp`: room-web is the only consumer today. The host application has its own (a stdio MCP bridge for background sessions); move it when the host decides to switch |
| daemon | Not moved. Only lease and process lock go into collab; collab's lane scheduling takes over the host application's "global limit plus bounded queue" semantics | Move it whole: there is no second consumer, and it carries the host application's single-writer-process assumption |
| Running coding agents (ACP client) | Build it in agent-kit's `/acp` (confirmed 2026-10-05). Rewrite it in Effect (3.7), drawing on agent-orchestration's Promise implementation and the host application's ACP loop, and merge the pitfalls each side fixed. ACP updates are translated into our own event model. The ACP SDK is an internal dependency and is not exposed. Vercel AI SDK's HarnessV1 is only a design reference | Depend on Vercel AI SDK `@ai-sdk/harness`: it is designed for sandboxes, so running locally means adding our own sandbox layer, and sessions, tools and the event model would all have to follow its interface definitions |
| Name of the injection context | `harness` (confirmed 2026-10-06). What the community calls an agent harness is the extensible runtime layer around the model; this context injects extensions into it and reads lifecycle signals back | `integrations`: too vague. Cost of the choice: it shares the name, but not the meaning, with the host application's AgentHarness and AI SDK's HarnessV1; the glossary and import aliases tell them apart |
| How new agents are organized | Option A: each context keeps its own adapter table keyed by `CodingAgentId` (confirmed 2026-10-06); `catalog` holds only identity and home directories | Option B: one composite object per agent, `defineAgent({ sessions, harness, discovery, acp })`: `catalog` would depend on every context in reverse |
| License | MIT (confirmed 2026-10-05). The author of all source code is treated as PerfectPan; the parts moved from the trace viewer, agent-orchestration and the host application are published under MIT in the kit | Keep GPL: the kit is a library, and tools and libraries use MIT by convention. GPL would restrict consumers such as presence (MIT) |
| agent-finder | Rewrite it from MoonBit in TS and merge it into `/discovery` (confirmed 2026-10-05) | Keep MoonBit: the rest of the kit is TS, and CI would also need the MoonBit toolchain |
| First release scope | 0.1.0 = P0 + P1 (6.3). Only packages and entries with real content exist: `/catalog`, `/platform`, `/node`, `/sessions`, `/transcript`, `/testing`. The internal packages for discovery, cost, harness, acp and redact, and the collab package, are created in the phase that fills them | Create every planned package as an empty shell in P0: it would publish entries without behavior |
| Effect in the first release | No 0.1.0 entry imports `effect` (every P1 context is plain TS under 3.7). The Effect allowlist in the boundary test exists from P0. The checks for the optional `effect` peer and the resolved Effect version (3.7) are prepared in P0 but only become meaningful with the first Effect entry, so they move to P3 | Run the peer and version checks in P0: with no Effect entry there is nothing for them to check |
| Effect entries for the Platform port | `PlatformService`, a `Context.Service` keyed `@rivus/agent-kit/platform/Platform/v1` whose value is the plain `Platform`, is exported by `/platform/effect`; `NodePlatformLive`, a Layer that calls `createNodePlatform()` when it is built, by `/node/effect` (decided in P3b-1). An internal package keeps its Effect code in `src/effect.ts`, exported to the shell as `<package>/public/effect` and, when siblings need it, as `<package>/effect`: platform exports both, platform-node only the shell entry, because only applications provide the platform. The boundary test treats an import of `<package>/effect`, and a relative import of `src/effect.ts` from outside the Effect allowlist, as an Effect import | Both in `/platform` and `/node`: those entries must stay importable without `effect`. One `/effect` entry with both names: `PlatformService` would come with `node:*`, so an Effect consumer on another runtime or with a memory platform could not import it, and the port and its Node implementation are already separate entries. `PlatformService` in the platform package's `index.ts`: every plain sibling would reach `effect` through it; a probe showed the bundler keeps that import even where nothing uses the service |
| Location of the authoring conventions | `docs/architecture/authoring.md`; the template keeps durable documentation under `docs/` | `architecture/authoring.md` at the repository root |
| Shell build and declaration bundling | tsdown with the Oxc declaration generator (decided in P0): one entry per subpath export, internal packages bundled, `node:*` and runtime dependencies external. The internal packages enable `isolatedDeclarations`, so Oxc can emit their declarations exactly; exports whose type is only inferred (such as zod schemas) stay module-private | rslib `dts.bundle` plus `bundledPackages`: under TypeScript 7 it copied TypeScript source into the `.d.ts`. tsdown's tsgo generator: it only emits declarations for files inside the shell package, not for the internal packages it bundles |
| Dependency ranges | Runtime dependencies of the published package use caret ranges from the versions in 3.12 (`zod ^4.6.5`, `es-toolkit ^1.52.0`); devDependencies stay exact, as in the template; the `effect` peer that arrives in P3 stays exact (3.7) (decided in P0) | Exact runtime versions: a consumer whose own `zod` or `es-toolkit` differs by a patch would install a second copy and miss fixes. A caret `effect` peer: two Effect versions can fail inside the runtime (3.7) |
| Session adapter layout | Within option A, each agent's pure translation (layout, preview, events, usage) lives in `sessions/src/agents/<agent>/` without IO or Platform; the `SessionAdapter` that assembles it with file IO, and the `builtinSessionAdapters` table, live in `sessions/src/application/session-adapters/` (decided in P1) | The table in `agents/index.ts` (3.2, 3.3 as first written): a `SessionAdapter` reads files through the platform, and `agents/` must stay pure |
| `streamEvents` in 0.1.0 | Not shipped, and neither is a resume position (decided in P1). `loadTranscript` returns the whole transcript | Stream events while reading: compaction marks earlier events with `shadowedBy` after they were read, so no event is final before the whole session is read, and consumers would have to patch events they already received. Revisit when sessions gains live following (3.7) |

## 3. Detailed design

### 3.1 Bounded context analysis

Each context is worked through in DDD terms: responsibility, ubiquitous language, model, use cases, ports and anti-corruption layer, what it exposes, and its relationships. agent-kit's core domains are `sessions` (the unified cross-agent model and translation: the most complex, the fastest changing, the most consumers) and `harness` (safe injection: the most invariants and the highest cost of mistakes). `discovery`, `cost` and `acp` are supporting domains; `lease` and `lanes` are generic subdomains; `redact` is only a utility module. The real business core domains of the ecosystem live in the applications (presence's online semantics, agent-task-loop's task flow, the host application's hosting); the kit supports them.

```text
External systems (upstream): each coding agent's log format, hook mechanism, ACP adapter
        │ each context's own anti-corruption layer (agents/<agent>/) translates into its model
        ▼
┌──────────────────────── @rivus/agent-kit ─────────────────────────┐
│  catalog (shared kernel: CodingAgentId + AgentHome)                │
│     ▲ shared by discovery, sessions, harness, acp                  │
│  discovery     sessions ──UsageRecord──▶ cost                      │
│                   │ event model + ACP update translation           │
│                   ▼                                                │
│  harness          acp                             redact (utility) │
└────────────────────────────────────────────────────────────────────┘
┌──────────────── @rivus/agent-kit-collab ─────────────────┐
│  lease (incl. process lock)        lanes                 │  uses only agent-kit's Platform
└──────────────────────────────────────────────────────────┘
Applications (downstream): presence / trace viewer / agent-task-loop / room-web / host application,
through the public interfaces (conformist)
```

#### catalog: shared kernel

| Aspect | Content |
| --- | --- |
| Ubiquitous language | CodingAgent (a third-party coding agent product), CodingAgentId (with aliases such as `claude-code` / `claude`), AgentHome (the configuration and data root, including overrides such as `CLAUDE_CONFIG_DIR` and `CODEX_HOME`) |
| Model | Value objects only |
| Home rules (verified in P1) | Claude Code: `CLAUDE_CONFIG_DIR` names the configuration directory, default `~/.claude`. Codex: `CODEX_HOME`, default `~/.codex`. Gemini CLI: `GEMINI_CLI_HOME` replaces the user's home directory and the CLI appends `.gemini`. Grok: `GROK_HOME`, default `~/.grok`. opencode: `$XDG_DATA_HOME/opencode`, default `~/.local/share/opencode`. Pi: `PI_CODING_AGENT_DIR` replaces `~/.pi/agent` and expands a leading `~` |
| Use cases | None |
| Ports and anti-corruption layer | None |
| Exposure and relationships | Shared by four contexts. Holds only identity and home directories, plus the `Result` type that every context uses (a few lines of pure types, part of the API conventions in 3.5). Any change to the shared kernel requires every context to coordinate |

#### discovery: supporting

| Aspect | Content |
| --- | --- |
| Ubiquitous language | Installation, Evidence (command on `PATH`, application path, configuration directory, version output), DetectionStatus (`runnable` / `found` / `missing` / `unknown`), AuthState |
| Model | Value objects plus the rule `classifyInstallation`; no aggregate |
| Use cases | `detectAgents` (query) |
| Ports and anti-corruption layer | Platform `fs`, `process`, `env`; each agent's detection method (ProbeRecipe) |
| Exposure and relationships | Exposes `Installation[]`; used by agent-task-loop `init` and room-web |

#### sessions: core

| Aspect | Content |
| --- | --- |
| Ubiquitous language | Session (one conversation of one agent, not the host application's session), SessionRef, SessionHead, Transcript, TranscriptEvent, Turn, Request, Lane (a subagent's execution line), Compaction, UsageRecord |
| Model | Value objects plus model consistency rules (ordered `seq`, tool results paired or marked orphan, compaction shadowing marks; guaranteed by the conformance tests) plus the domain service `foldTranscript`; no aggregate (read-only projection) |
| Use cases | `listSessions`, `loadTranscript`, `summarizeSession`, `readOriginal` (0.1.0), `decodeUsage` (P2), all queries; `streamEvents` is deferred (2.3) |
| Ports and anti-corruption layer | Platform `fs`; an optional index cache port; one anti-corruption layer per agent covering directory layout, head/tail preview, event translation and usage decoding (the four change together for the same reason) |
| Exposure and relationships | Exposes SessionHead, TranscriptEvent, UsageRecord; `cost` and `acp` are downstream of it |

#### cost: supporting

| Aspect | Content |
| --- | --- |
| Ubiquitous language | PricingTable (injected by the caller), Price, Cost, CostSource (reported by the agent / computed from the price table), CalendarWindow, UsageSummary |
| Model | Value objects plus the domain services `priceUsage` and `summarizeUsage`; no aggregate |
| Use cases | None (pure functions exported directly) |
| Ports and anti-corruption layer | None |
| Exposure and relationships | Conforms to sessions' UsageRecord (customer–supplier) |

#### harness: core

| Aspect | Content |
| --- | --- |
| Ubiquitous language | Harness (the extensible part of an agent's runtime), Bundle, Owner, Artifact, Strategy (launch-time injection / native plugin / scanned directory / shared configuration edit), InstallPlan, PlanStep, Ledger, LedgerEntry, Drift, ForeignOwner, TrustPrompt, HookDialect, LifecycleEvent |
| Model | Aggregate InstallPlan: immutable once built; refuses to execute when the ledger revision it was based on has changed; rejected as a whole on any conflict. Aggregate Ledger: every entry has an owner; the revision strictly increases; every modification happens while the LedgerLock is held; an unknown version is refused or fully preserved, never cleared. Domain services `buildInstallPlan`, three-way `verify`, `readHookEvent`, `reduceLifecycle` |
| Use cases | `planInstall`, `applyInstall`, `verify`, `uninstall`, `inventory`; `readHookEvent` (pure function) |
| Ports and anti-corruption layer | Format-preserving configuration editors, agent command lines, ledger repository, LedgerLock (an SQLite exclusive lock by default, replaceable by the application, see 3.9), external owner (chezmoi), Platform; each agent's HookDialect, injection methods and configuration file locations |
| Exposure and relationships | Exposes the InstallPlan handle, LedgerEntry, LifecycleEvent. One context with two entries (injection / hook events), because both share the same HookDialect |

#### acp: supporting

| Aspect | Content |
| --- | --- |
| Ubiquitous language | Connection, AcpProfile (each agent's launch method and `_meta` conventions), AcpSession, Turn, PermissionRequest, PermissionDecision, SessionBinding (`sessionKey` → ACP `sessionId`) |
| Model | Aggregate AcpSession, a state machine: starting → ready → turn in progress / awaiting permission → cancelling → closed. At most one turn per session at a time; the binding is invalidated when a cancel does not settle; every operation is refused after close |
| Use cases | `connectAgent` → the connection object's `newSession`, `loadSession`, `prompt`, `cancel`, `close` |
| Ports and anti-corruption layer | Platform `process` (spawn the child process), `fs` (limited to the session directory); SessionBindingStore; the translation of ACP `session/update` is shared with sessions |
| Exposure and relationships | Exposes connection and session handles and a live event stream; downstream of sessions |

#### lease (collab): generic

| Aspect | Content |
| --- | --- |
| Ubiquitous language | Lease, Holder (host, bootId, pid, start time), Generation (fencing token), Revision, TTL, Heartbeat, Tombstone, FenceCheck, ProcessLock |
| Model | Aggregate Lease: a single holder; the generation never decreases (not even after release); holder identity checks pid and start time; expiry uses the observer's monotonic clock |
| Use cases | `acquire`, `renew`, `release`, `runFenced`, `acquireProcessLock` |
| Ports and anti-corruption layer | LeaseStore (CAS), Clock, process identity |
| Exposure and relationships | Exposes LeaseHandle, LeaseSnapshot and pure rules; used by agent-task-loop, room-web, the host application and presence |

#### lanes (collab): generic

| Aspect | Content |
| --- | --- |
| Ubiquitous language | Lane (per key), Activation, Wake (coalesced wake-up), Capacity, QueueBound, TurnTimeout |
| Model | Aggregate Lane (in-memory state machine: idle / queued / running, where a queued lane and a running lane woken again have a pending activation). Scheduling invariants: at most one activation per key, concurrency within the limit, a bounded queue; no persistence |
| Use cases | `createLanes` → `wake`, `cancel`, `status`, `close` |
| Ports and anti-corruption layer | Clock |
| Exposure and relationships | Used by room-web and the host application |

#### redact: utility module

`redact` has no ubiquitous language or state of its own. It is a set of pure functions (the many spellings of home paths; keys such as `sk-`, `ghp_`, `xox*`), and following Evans's advice for generic subdomains it gets no DDD treatment. Platform is not a bounded context either: it has no domain language and is only a technical port.

#### Corrections from the analysis (confirmed 2026-10-06)

- A smaller shared kernel: `catalog` holds only identity and home directories. Knowledge used by only one context belongs to that context: hook dialects to harness, ACP connection methods to acp, log directory layouts to sessions, detection methods to discovery. Facts such as agent-presence #85 and #86 still have one source (harness's HookDialect).
- New agents use option A: each context keeps its own adapter table keyed by `CodingAgentId`. There is no `defineAgent` object that combines the contexts (`catalog` would then depend on every context). The cost is that adding an agent means adding an adapter in several contexts, which each context's conformance tests check.
- The injection context is renamed `harness`: see 2.3 and the glossary below.
- One more aggregate: the ACP session is a state machine with invariants, so it is an aggregate; `redact` is demoted to a utility module.

#### Glossary highlights

The full glossary is in [CONTEXT.md](../../CONTEXT.md).

| Term | Meaning in the kit | Confusable concept with the same name |
| --- | --- | --- |
| CodingAgent | A third-party coding agent product (Claude Code, Codex, ...) | In the host application, Agent means the product the host runs |
| Harness | The part of an agent's runtime that can be extended (skills, hooks, MCP, instructions, plugins); the harness context injects into it and reads lifecycle events back | The host application's AgentHarness (the execution model of one run); AI SDK's HarnessV1 (an adapter that drives an agent's runtime); agent-orchestration's Harness (the configuration passed to the agent on every turn, the closest to this meaning). A host that uses both aliases the import |
| Session / Turn | One conversation / one turn of an agent | The host application's Session Key and Agent Run |
| Lane | In sessions, a subagent's execution line; in lanes, a scheduling unit serialized by key | Each context keeps its own meaning; the two are not mixed across contexts |

### 3.2 Internal layers and runtime injection

| Layer | Contents | Constraints |
| --- | --- | --- |
| `domain/<concept>/` | Created as needed: `aggregate/`, `value-objects/`, `policies/`, `factories/`, `errors/`, `events/`, plus `services/` (stateless domain services). `index.ts` is the concept's facade inside the package | Plain TS, no IO, never sees Platform. Imports only its own domain, `catalog`, and types from upstream packages (`import type`). Aggregates are frozen classes with a private constructor and `create` / `restore` factories; state transitions return `{ state, events }` |
| `agents/<agent>/` (anti-corruption layer) | Translates each agent's raw format into this context's model: a log line → TranscriptEvent, a hook payload → LifecycleEvent. Each one is registered in the context's `builtinXxx: Record<CodingAgentId, XxxAdapter>` table: in `agents/index.ts` when the adapter is pure, in `application/` when the adapter does IO (sessions: `application/session-adapters/`, 2.3) | Pure functions that depend only on this context's domain; no IO |
| `application/` | Use cases that carry agent knowledge and orchestrate ports. `ports.ts` declares the part of Platform it uses and this context's own ports | Depends only on domain, agents and ports. Holds no policy (trigger timing, fail-open, retries, which agents to count, where to store) |
| `adapters/` | Implementations of this context's ports: format-preserving configuration editors, ledger storage, SQLite index, lease store, and so on | Reaches the outside only through Platform; never imports `node:*` directly |
| `platform-node` | The Node implementation of Platform: fs, child processes, sqlite | The only package that may import `node:*` |

Pure computation contexts (catalog, cost, per-agent translation, hook event parsing) have no application layer and export domain functions directly. The assembly root lives in each application: it creates one Node platform and passes it to the use cases.

```ts
interface Platform {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home: string
  readonly os: 'darwin' | 'linux' | 'win32'
  readonly fs: {
    stat(path: string, opts?: { followSymlinks?: boolean }): Promise<FileStat | undefined>   // FileStat.kind: 'file' | 'dir' | 'symlink'; does not follow links by default (lstat semantics)
    realpath(path: string): Promise<string | undefined>               // undefined when the target does not exist; the caller resolves the parent directory instead
    list(dir: string): Promise<DirEntry[]>
    read(path: string, range?: ByteRange): AsyncIterable<Uint8Array>   // line splitting and byte offsets happen in the core
    writeAtomic(path: string, data: Uint8Array | string, opts?: { mode?: number }): Promise<void>
    createExclusive(path: string): Promise<boolean>                   // file locks rely on it
    rename(from: string, to: string): Promise<void>
    remove(path: string): Promise<void>
  }
  readonly process: {
    run(cmd: string, args: string[], opts: { cwd?: string; env?: Env; timeoutMs: number; signal?: AbortSignal }): Promise<RunResult>   // one-shot commands: version probes, an agent's own command line
    spawn(cmd: string, args: string[], opts: { cwd: string; env: Env; signal?: AbortSignal }): ChildHandle   // long-lived: the ACP child process
    // ChildHandle = { stdin: WritableStream<Uint8Array>; stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array>;
    //                 exited: Promise<{ code: number | null; signal: string | null }>; kill(signal?: 'SIGTERM' | 'SIGKILL'): void }
    readonly self: ProcessIdentity                                    // { host, bootId, pid, startTime }
    identify(pid: number): ProcessIdentity | undefined                // liveness checks; startTime does not match when a pid is reused
  }
  readonly clock: { now(): number; monotonic(): number }             // lease expiry uses the observer's monotonic clock
  readonly sqlite?: { open(path: string, opts?: { readonly?: boolean }): SqliteDatabase }   // optional: opencode reading, local lease store
}
// Each use case declares only the part it uses, for example listSessions(deps: Pick<Platform, 'fs' | 'env' | 'home'>, opts)
```

The `env` of `spawn` must be given explicitly and is not inherited from the parent process (a pitfall the host application's ACP loop fixed). When the `signal` aborts, the child gets `SIGTERM` first and `SIGKILL` after a grace period. `stdin` / `stdout` use Web Streams because the ACP SDK's `ndJsonStream` accepts them directly. Every path check (installation targets, the ACP client's session directory limit) calls `realpath` first. This covers two cases: a link inside the directory that points outside it, and a target that does not exist yet, for which the nearest existing parent directory is resolved.

File reads return `AsyncIterable<Uint8Array>` instead of `ReadableStream`: the Node side yields `Buffer`s directly, which is faster than Web Streams, and the browser side uses `Blob.stream()`. ECMA-429 does not include a file system, processes or environment variables, and TC55 lists host interaction only as future scope, so these must be injected.

### 3.3 Package organization and layout

The layout follows vitest 5 (internal subpackages are devDependencies of vitest and are bundled into `dist` at build time) and MCP SDK v2 (the private core-internal package is inlined into client and server). Each context is one private Rush package, bundled into the matching published package at build time:

```text
agent-kit/                                   Rush (project-template-rush), public, MIT
  packages/
    agent-kit/          @rivus/agent-kit                  first published package (shell): src/<entry>.ts only re-exports by name
    catalog/            @rivus/agent-kit-catalog          private  shared kernel
    platform/           @rivus/agent-kit-platform         private  Platform port types + byte-stream line splitting
    platform-node/      @rivus/agent-kit-platform-node    private  Node implementation
    discovery/          @rivus/agent-kit-discovery        private
    sessions/           @rivus/agent-kit-sessions         private  sessions + transcript + usage (one context)
    cost/               @rivus/agent-kit-cost             private
    harness/            @rivus/agent-kit-harness          private  injection + hook events
    acp/                @rivus/agent-kit-acp              private  ACP connection and sessions (ACP SDK is an internal dependency)
    redact/             @rivus/agent-kit-redact           private  utility module
    testing/            @rivus/agent-kit-testing          private  in-memory Platform + per-context conformance tests
    agent-kit-collab/   @rivus/agent-kit-collab           second published package: src/lease, src/process-lock, src/lanes as directories
  tests/smoke/                                           private  smoke tests against real local agents, not run in CI
  infra/architecture/boundaries.ts                       architecture manifest (package dependencies, layer dependencies, external dependency allowlist), executed by the boundary test under test/
  docs/specs/  docs/plans/  docs/architecture/authoring.md (DDD conventions)  AGENTS.md  CONTEXT.md (glossary)
```

Packages are created in the phase that gives them content (2.3): 0.1.0 contains `agent-kit`, `catalog`, `platform`, `platform-node`, `sessions` and `testing`.

The common template of each context package:

```text
<context>/src/
  domain/<concept>/
    aggregate/  value-objects/  policies/  factories/  errors/  events/  services/   created as needed
    index.ts
  application/          use case orchestration + ports.ts; holds the builtinXxx table when adapters do IO
  agents/<agent>/       anti-corruption layer; agents/index.ts exports the builtinXxx table when adapters are pure
  adapters/             port implementations
  public.ts             the public part (re-exported by the shell package)
  index.ts              for sibling packages
```

The domain layer of each context:

```text
catalog/src/domain/coding-agent/
  value-objects/      coding-agent-id.ts, agent-home.ts
catalog/src/agents/   claude-code.ts, codex.ts, ... (identity and home directory rules only)

discovery/src/domain/installation/
  value-objects/      evidence.ts, detection-status.ts, auth-state.ts, version.ts
  policies/           classify-installation.ts            evidence → status
discovery/src/agents/ each agent's ProbeRecipe: executable, application paths, version arguments, login state check

sessions/src/domain/
  session/value-objects/      session-ref.ts, session-head.ts
  transcript/
    value-objects/    transcript-event.ts, turn.ts, request.ts, lane.ts, compaction.ts, source-pointer.ts
    policies/         event-ordering.ts, tool-result-pairing.ts, compaction-shadowing.ts
    services/         fold-transcript.ts
    errors/           unknown-format-generation.ts
  usage/
    value-objects/    usage.ts, usage-record.ts
    services/         no-cache-input.ts, to-otel-attributes.ts, to-ai-sdk-usage.ts
sessions/src/agents/claude-code/   layout.ts, preview.ts, events.ts, usage.ts (codex/, grok/, ... have the same shape)
sessions/src/protocols/acp-updates.ts   ACP session/update → events (shared by Grok logs and acp)

cost/src/domain/pricing/
  value-objects/      price.ts, pricing-table.ts, cost.ts, calendar-window.ts, usage-summary.ts
  services/           price-usage.ts, summarize-usage.ts, from-litellm.ts

harness/src/domain/
  bundle/value-objects/       bundle.ts, artifact-spec.ts, owner.ts, strategy.ts
  install-plan/
    aggregate/        install-plan.ts
    value-objects/    plan-step.ts, artifact-locator.ts, precondition.ts, trust-prompt.ts, conflict.ts
    policies/         strategy-preference.ts, conflict-detection.ts, step-ordering.ts
    factories/        build-install-plan.ts               bundle + ledger snapshot + observed state → plan
    errors/           plan-stale.ts, plan-conflict.ts
  ledger/
    aggregate/        ledger.ts
    value-objects/    ledger-entry.ts, pre-image.ts, content-hash.ts, drift.ts
    policies/         ownership.ts, reconcile.ts, three-way-verify.ts
    factories/        create-ledger.ts, restore-ledger.ts
    errors/           ledger-version-unsupported.ts, ledger-busy.ts
    events/           artifact-installed.ts, artifact-removed.ts
  lifecycle/
    value-objects/    lifecycle-event.ts, lifecycle-state.ts
    policies/         reduce-lifecycle.ts, host-sniffing.ts
harness/src/agents/claude-code/    hook-dialect.ts, strategies.ts, config-files.ts (codex/, gemini/, ... have the same shape)
harness/src/adapters/              jsonc-editor.ts, toml-editor.ts, yaml-block-editor.ts, ledger-store.ts, chezmoi-owner.ts
harness/src/events.ts              /harness/events entry: references only domain/lifecycle and agents/*/hook-dialect

acp/src/domain/acp-session/
  aggregate/          acp-session.ts
  value-objects/      session-binding.ts, turn.ts, permission-request.ts, permission-decision.ts, acp-profile.ts
  policies/           turn-admission.ts, cancellation.ts, permission-default.ts
  factories/          create-acp-session.ts, restore-acp-session.ts
  errors/             turn-in-progress.ts, session-closed.ts
  events/             turn-started.ts, turn-finished.ts
acp/src/agents/       each agent's AcpProfile

agent-kit-collab/src/
  lease/domain/lease/
    aggregate/        lease.ts
    value-objects/    holder.ts, generation.ts, fencing-token.ts, lease-snapshot.ts
    policies/         freshness.ts, acquisition.ts, fence-check.ts
    factories/        create-lease.ts, restore-lease.ts
    errors/           lease-held.ts, lease-lost.ts, fence-rejected.ts
  lanes/domain/lane/
    aggregate/        lane.ts (coalescing is the Lane's own wake transition)
    value-objects/    lane-limits.ts (Capacity, QueueBound, TurnTimeout), lane-snapshot.ts
    policies/         admission.ts
    errors/           lane-queue-full.ts, lanes-config-invalid.ts
```

Rules (checked by the architecture tests):

- Package dependencies: discovery, sessions, harness → catalog + platform; acp → catalog + platform + sessions; cost → sessions (types only); platform-node → platform; collab uses agent-kit only through public subpaths. Rush forbids phantom dependencies.
- Cross-package imports go only through the other package's `index.ts`, never into its `domain/`, `agents/` or `adapters/`. In another codebase where this rule was not kept, other modules imported one module's domain directly dozens of times.
- `domain/` imports only its own domain, `catalog`, and types from upstream packages declared in the package dependencies (`import type` only; for example cost references sessions' UsageRecord; `Result` lives in catalog; the `{ state, events }` returned by aggregate transitions is a one-line type declared next to each aggregate). `agents/` depends only on this context's domain. Only platform-node may import `node:*`.
- `agents/` versus `adapters/`: the first translates an external agent's format into our model (anti-corruption layer); the second implements ports we declare ourselves (infrastructure).
- Two export layers: `index.ts` is for sibling packages; `public.ts` is the public part, and the shell package re-exports its names one by one, so every change to the public surface is visible in review. Internal aggregate classes do not go into `public.ts`; the public surface only offers handle interfaces and snapshot types.
- Effect allowlist: only the `application/` and `adapters/` of the contexts in the left column of 3.7 may import `effect`. `domain/`, `agents/` and every plain TS entry must not reference it; the boundary test checks both the module dependency graph and the `.d.ts` graph.
- Build: the shell package lists the internal packages as devDependencies, and tsdown bundles them into the output. Runtime dependencies (zod, es-toolkit, later jsonc-parser, the TOML editor and the ACP SDK) and `node:*` stay external. One entry per subpath, shared modules split into shared chunks (verified, appendix A.3). Declarations come from tsdown's Oxc generator, which needs `isolatedDeclarations` in every internal package (2.3); `check:package` verifies that `dist` imports no internal package and that browser entries bundle without Node built-ins.
- collab does not inline agent-kit's internal packages. It declares `@rivus/agent-kit` as a peer and uses only its public subpaths for the Platform types, the `Result` type from `/catalog`, and `/platform/effect` (its tests also use `/node`), so that a process never holds two copies of platform. It shares the `main` lockstep version policy with `@rivus/agent-kit` (decided 2026-10-08 in P5, replacing the separate policy first planned here; see 4).
- Adding an agent: add its identity in `catalog/agents`, add one adapter in the `agents/` of each context that applies, and register it in that context's `builtinXxx` table (`agents/index.ts`, or `application/` when the adapter does IO, as sessions' does). Each context's conformance tests check that it satisfies the interface definition.

### 3.4 Public entries

| Entry | Contents | Application layer | Ports used |
| --- | --- | --- | --- |
| `@rivus/agent-kit/catalog` | `CodingAgentId`, `AgentHome`, the built-in agent identities, `resolveHome(id, { env, home })`; `Result`, `ok`, `err` | No | None |
| `/discovery` | `detectAgents` (including version and login state) | Yes | `fs.stat`, `process.run`, `env` |
| `/sessions` | `listSessions` | Yes | `fs.list` / `stat` / `read` |
| `/transcript` | Per-agent translation, `loadTranscript` (multi-file merge, skipped records, progress), `summarizeSession`, `readOriginal`, the event-interpretation rules; `streamEvents` and a resume position are deferred (2.3) | Yes | `fs.read` |
| `/transcript/usage` | `decodeUsage` (lightweight, streaming, can resume from the previous position) | Yes | `fs.read` |
| `/cost` | `createPricing(table, { overrides, fallback })`, `costOf`, `calendarWindow`, `summarize`, `fromLiteLLM`; imports nothing | No | None |
| `/harness` | Effect: `planInstall` → InstallPlan, `applyInstall`, `verify`, `uninstall`, `inventory`, plus Layers such as `HarnessLive` | Yes | `fs` writes, `process.run`, ledger storage, LedgerLock |
| `/harness/events` | `readHookEvent(agent, payload, env)`, `reduceLifecycle`, `heartbeatSignal`, `builtinHookDialects`: synchronous, zero dependencies; the hook process loads only this | No | None |
| `/redact` | `redact(value, { home })`, `redactText` | No | None |
| `/acp` | Effect: `connectAgent` (starts the agent, handshakes, probes login; the connection belongs to the caller's Scope) → a connection object with `newSession`, `loadSession`, `prompt` (returns an event stream), `cancel`, `close`. Permission requests go to the caller through a callback and are denied by default | Yes | `process` (spawn the ACP child process), `fs` (client file reads and writes limited to the session directory) |
| `/platform` | Port types such as `Platform` and `ProcessIdentity`, plus general utilities such as byte-stream line splitting; collab takes its types from here | — | — |
| `/node` | `createNodePlatform({ env?, home? })` | — | (implementation) |
| `/platform/effect` | Effect: `PlatformService`, the `Context.Service` whose value is the plain `Platform` | — | — |
| `/node/effect` | Effect: `NodePlatformLive`, a Layer built from `createNodePlatform()` | — | (implementation) |
| `/testing` | `createMemoryPlatform({ files })`, per-context conformance tests | — | (implementation) |

The rule is one root entry per context, with a sub-entry only when the runtime profile differs: `/transcript/usage` and `/harness/events` are the lightweight versions used by presence's hook process, and `/platform/effect` and `/node/effect` are the Effect forms of the Platform port and its Node implementation, which need the `effect` peer that `/platform` and `/node` do not (2.3). Entries marked Effect return `Effect` / `Stream` / `Layer`, and their ports are `Context.Service`; unmarked entries are plain TS and do not reference `effect` (3.7).

0.1.0 ships `/catalog`, `/platform`, `/node`, `/sessions`, `/transcript` and `/testing` (2.3). The other entries arrive with their phase in 6.3.

Entries of `@rivus/agent-kit-collab`:

| Entry | Contents | Ports used |
| --- | --- | --- |
| `@rivus/agent-kit-collab/lease` | Effect: `createLeaseManager`, `sqliteLeaseStore`, `fileLeaseStore`, `memoryLeaseStore`; pure rules `isFresh` / `canAcquire` / `nextFencingToken` | sqlite or fs, `process.identify`, clock |
| `/process-lock` | `acquireProcessLock(path)`: a single-instance lock, released when the process exits | sqlite (falls back to fs) |
| `/lanes` | Effect: `createLanes({ maxConcurrent, maxQueued?, turnTimeoutMs?, activate, onExit? })` → `wake`, `cancel`, `status`, `close` | clock |

### 3.5 API conventions

- Functions plus plain data. Stateful parts are created by factory functions. The only public class is `AgentKitError` (`code` + `cause`, identified through a `Symbol.for` brand so that several installed copies do not cause false negatives). Plain data can pass through the trace viewer's RPC unchanged.
- Async shapes. Plain TS entries: a single result is a `Promise`; sessions, events and usage are `AsyncIterable` (`break` cancels); every IO function accepts `{ signal?: AbortSignal }`; functions on the hook path are synchronous and do no IO. Effect entries return `Effect` / `Stream`; cancellation is fiber interruption, and long-lived resources (ACP connection, lease manager, lanes) belong to a Scope provided by the caller.
- Errors. Plain TS entries return expected outcomes as values, `{ ok: true, value } | { ok: false, error }`, where `error` is a union tagged by `_tag` (agent not installed, lease held, a file failed to read); only defects throw. When parsing meets a line it cannot read, it records the line as skipped; only an unrecognized format generation is an error. `catchTag` matches plain `_tag` objects (verified), but `{ ok: false }` is a successfully resolved Promise and does not enter Effect's error channel by itself: an Effect caller first unwraps it with a few-line `fromResult` (`r.ok ? Effect.succeed(r.value) : Effect.fail(r.error)`), after which `catchTag` works (see 3.7). Effect entries put the same set of `_tag` errors into the typed error channel `Effect<A, E>`; inside the kit, a `Result` obtained from a plain TS function is unwrapped the same way. In 0.1.0 (decided in P1): `loadTranscript` and `summarizeSession` resolve to `Result`s that fail with `SessionNotFound`, `ReadFailed`, `UnknownFormatGeneration`, `NoAdapterAccepted` or `CapabilityUnsupported`, and `readOriginal` fails with `SourceChanged`, `SessionNotFound` or `ReadFailed`; `listSessions` yields `{ ref, error }` items (`RootMissing`, `ReadFailed`) and goes on. An abort rejects with `signal.reason` instead of resolving to a value, so a caller's own cancellation never looks like a data problem. Naming an agent without an adapter in the call's own options (`listSessions({ agents })`) throws `AgentKitError` with code `capability-unsupported`, because it is a caller error, not a property of the data.
- Dependency injection. Plain TS entries take the platform, or a part of it, as the first parameter; there is no "kit object bound to a platform", which would be a pure forwarding layer. The ports of Effect entries are `Context.Service`, with keys of the form `@rivus/agent-kit/<context>/<port>/v1` (for example LedgerStore, LedgerLock, AcpTransport, SessionBindingStore, LeaseStore); the version number changes only when the interface becomes incompatible. Platform stays a plain TS interface: a Layer such as `PlatformLive` builds the service from `createNodePlatform()`. Each fs method does not become its own service, and nothing is injected into aggregates.
- Adding agents (option A). Each context defines its own adapter interface with a version literal (for example `specificationVersion: 'sessions-v1'` on SessionAdapter, `'harness-v1'` on HookDialect), so v1 and v2 can coexist later (borrowed from AI SDK's LanguageModelV2/V3/V4). Each context exports `builtinXxx: Record<CodingAgentId, XxxAdapter>`; use cases use it by default and also accept an `adapters` parameter that overrides or extends it. There is no global registry. Which capabilities an agent supports is decided by which context tables contain an adapter for it; reading data for an agent without an adapter returns a `CapabilityUnsupported` value, and naming such an agent in a call's options throws `AgentKitError` with code `capability-unsupported` (decided in P1; see the spec's error convention). Third-party adapters use the conformance tests of the matching context from `/testing`.
- Versioning. Correcting an agent fact (a path, an event name) is a patch; adding an agent, an event type or a capability is a minor; dropping support for a Node LTS is a major. Unstable APIs go under `/experimental/*`.

```ts
const platform = createNodePlatform()

// Hook path: one synchronous call, no IO
const ev = readHookEvent('codex', payload, process.env)      // { phase: 'finish', sessionId, cwd }

// Sessions, translation, usage, cost
for await (const s of listSessions(platform, { agents: ['claude-code', 'codex'], signal })) { /* SessionHead | { ref, error } */ }
// Add a third-party agent: listSessions(platform, { adapters: { ...builtinSessionAdapters, 'my-agent': mySessionAdapter } })
const t = await loadTranscript(platform, ref, { signal })   // Result<Transcript>; ref carries the CodingAgentId; in t.value.events, kind is 'unknown' when not recognized
const pricing = createPricing(presencePricingSnapshot, { overrides })
for await (const r of decodeUsage(platform, 'claude-code', file, { since, from: cursor })) total = add(total, r, pricing)

// The following are Effect entries; consumers run them in their own assembly root
const KitLive = Layer.mergeAll(HarnessLive, AcpLive).pipe(Layer.provide(NodePlatformLive))

// Injection: preview first, then execute (presence setup runs it once: Effect.runPromiseExit(program.pipe(Effect.provide(KitLive))))
const program = Effect.gen(function* () {
  const plan = yield* planInstall({ owner: 'agent-presence', hooks: [...], skills: [...] }, { agents: ['claude-code', 'codex'] })
  // plan.changes: the diff of each file, the agent commands to run, the expected trust prompts
  return yield* applyInstall(plan)   // re-checks every target before writing and refuses if it changed after the plan; a window remains between the check and the write, see 3.9
})

// ACP: the connection belongs to the outer Scope; the event stream uses the sessions event model (room-web hosts it in a ManagedRuntime)
Effect.scoped(Effect.gen(function* () {
  const conn = yield* connectAgent('claude-code', { cwd, onPermission: policy })
  const session = yield* conn.newSession({ mcpServers })   // the caller provides MCP server descriptions; room-web keeps using agent-orchestration's ToolServer
  yield* session.prompt(blocks).pipe(Stream.runForEach(render))
}))

// lease (@rivus/agent-kit-collab/lease): the heartbeat is supervised inside the Scope; losing the lease interrupts fenced work
Effect.scoped(Effect.gen(function* () {
  const leases = yield* createLeaseManager({ ttlMs: 60_000, heartbeatMs: 15_000 })   // LeaseStore from sqliteLeaseStore({ path })
  const lease = yield* leases.acquire(`task:${id}`)
  yield* lease.runFenced((token) => write(token))
}))
```

### 3.6 Aggregates and exports

The kit is an Open Host Service for the applications; its public types are the Published Language, and the applications conform to it. It exports three kinds of things:

| Kind | Examples |
| --- | --- |
| Use cases | `listSessions`, `loadTranscript`, `planInstall`, `createLeaseManager` |
| Published Language (plain data, read-only snapshots) | CodingAgentId, AgentHome, SessionHead, TranscriptEvent, UsageRecord, LifecycleEvent, LedgerEntry, LeaseSnapshot |
| Reusable pure rules | Per-agent translation functions, the rules for interpreting events (`isPrompt`, `laneOf`, `shadowedIn`, ...), `readHookEvent`, `costOf`, `isFresh`, `nextFencingToken` (the host application can embed them in its own BackgroundSession aggregate) |

The public surface holds only these three kinds (decided in P1). 0.1.0 exports use cases, the published types, each built-in agent's translator with its usage function and capability list, and the event-interpretation rules a viewer needs; the helpers for writing an adapter (file walking, JSONL reading, event factories) stay internal until a consumer outside the kit needs them, so they can change without a breaking release.

Aggregate roots are exported as handles: LeaseHandle (`token`, `runFenced`; release is the owning Scope's job) and InstallPlan (`changes`, executed by `applyInstall` / `discard`). They can only be obtained through use cases, are interfaces rather than classes that can be constructed with `new`, and their methods go through the store or the ledger internally. The Ledger is stored locally by the kit and exposed through `verify` and `uninstall(owner)`. This matches AI SDK's HarnessAgentSession and Chat (the state machine lives in the object and its state can be exported as a snapshot); the difference is that outside code cannot construct lease tokens or plan diffs freely.

### 3.7 Where Effect is used

Effect use is split by side-effect weight (confirmed 2026-10-06 after two rounds of discussion with codex). The domain layer is plain TS in every case, and aggregate roots do not receive repositories. Effect appears only in the application layer and adapters of contexts with heavy side effects.

| Effect (use cases and adapters; ports are `Context.Service`) | Plain TS |
| --- | --- |
| harness apply / verify / uninstall and the ledger lock; `/acp`; collab's lease and lanes | catalog, discovery, sessions and transcript (translation and reading), `/transcript/usage`, cost, redact, `/harness/events`, process-lock |

- Why this split: the right column is either pure computation (translation, pricing, hook event parsing) or has side effects with simple lifecycles. Reading a session is a one-time file read, for which `AsyncIterable` plus `AbortSignal` is enough; the trace viewer's kernel is written that way. Discovery's probe commands have timeouts. The kernel releases the process lock when the process exits. The left column has concurrent lifecycles: ACP's child process, bidirectional streams, turns, permission requests and cancellation; lease heartbeats and abort on loss; lanes' concurrency limit and bounded queue; harness's multi-step writes under a lock. Leaving these to Scope, supervision and interruption is less likely to miss something than hand-writing many `catch` / `finally` blocks.
- When the right column moves: when sessions gains live following, file watching, background index refresh or concurrent scanning with backpressure, the reading layer moves to Effect. The translation functions do not change.
- Scope and supervision must actually be used. Wrapping async functions in `tryPromise` and swapping parameters for `Context.Service` does not justify the change. codex measured this with Effect 4.0.1: when `tryPromise` wraps a write that cannot be cancelled, a timeout releases the lock before the write finishes. The execution rules for harness and lease are therefore written in 3.9.
- Only Effect-native entries are exposed; there is no Promise facade. The facade itself is the most error-prone boundary (a lock acquired late, a long-lived handle closed by a short Scope, classification of exit causes), and every current consumer can run Effect in its own assembly root: presence setup runs a single `Effect.runPromiseExit`; agent-task-loop and room-web hold a `ManagedRuntime` in their server processes; the host application composes Layers directly. The kit is responsible for the guarantees about locks, heartbeats, cancellation and cleanup; consumers are responsible for starting programs and interpreting results (exit codes, HTTP responses). The kit provides and tests examples of these three kinds of integration. A helper is added when a repeated and stable need for a Promise handle appears.
- Dependency: `effect` is an optional peer of both packages, exactly `"4.0.1"` in the first release, and also a devDependency; it stays external at build time and is never inlined. Consumers that use only plain TS entries need not install it; a host that uses Effect entries must install the same version explicitly. The host application declares `^4.0.0` and its lockfile resolves 4.0.0; it aligns to 4.0.1 before adoption. The peer range widens only after interoperability with a newer version has been verified.
- Version risk: two copies of the same version interoperate. Different versions can fail inside the runtime, and v4 has no version check. Among the combinations tested, mixing rc.108 with 4.0.1 (three weeks apart) failed with `fiber.succeedWith is not a function`. This does not mean every pair of stable releases is incompatible; the exact 4.0.1 peer is the support policy of the first release. CI therefore builds an independent consumer from the published artifacts and checks that the host, agent-kit and collab all resolve Effect 4.0.1 and that the artifacts contain no inlined copy. The host runtime then executes the kit's Effects, Layers and Streams, covering injection, typed failures, cancellation, finalizers and runtime shutdown.
- Isolation of the plain entries cannot rely on tree-shaking alone. For plain entries such as `/harness/events`, `/transcript/usage`, `/cost` and `/process-lock`, check the full module dependency graph and the published `.d.ts` graph: neither may pass through `effect`. In a consumer fixture without Effect installed, verify imports, type checking, and the editor plugin and browser bundles. For the hook entry that presence actually runs, check loading and measure cold start. Introduce Effect once on purpose and confirm that the gate fails.
- Cost (measured; treat as examples): a minimal Effect, a composition without Schema, and a full composition are about 8.9, 16.0 and 33.6 KB gzip, and add about 2.9, 7.4 and 20.5 ms to startup when bundled; unbundled they add 67–91 ms. The cost falls only on consumers of left-column entries, and the final numbers come from measuring the real entries.
- Child processes: ACP still goes through `Platform.spawn` and does not use `effect/process` (v4 marks it unstable, so minor versions may break it).
- First release: no 0.1.0 entry imports `effect`. The boundary test's Effect allowlist runs from P0; the optional peer and resolved-version checks above run since P3b-1, with the first Effect entries `/platform/effect` and `/node/effect` (2.3, 6.3).

### 3.8 harness (injection and lifecycle signals)

Non-invasive by default. Choose the injection method in this order:

1. When we launch the agent ourselves, inject through launch arguments or ACP session parameters, leaving no persistent change.
2. The agent's native plugin mechanism: Claude's skills-dir plugin (`~/.claude/skills/<name>/.claude-plugin/plugin.json`, loaded as `<name>@skills-dir`; it can carry hooks, skills, agents and MCP without changing settings); Gemini extensions; hooks bundled with a Codex plugin (`hooks/hooks.json` at the plugin root, or the `hooks` field of `.codex-plugin/plugin.json`; enabling a plugin does not mean trusting it, and the hooks still run only after the user reviews them); the plugin or extension directories that Grok, opencode, Pi and Cursor each scan automatically.
3. Put a file of our own into a scanned directory such as `~/.agents/skills` (every agent except Claude reads `~/.agents/skills`; Claude reads `~/.claude/skills`).
4. Edit shared configuration last (today only TRAE's hooks, Codex hooks outside a plugin, and most MCP configuration are left): preview the diff first, only append, record in the ledger, and preserve formatting and comments (jsonc-parser, a TOML CST editor, the yaml Document API).

Facts that each agent's HookDialect in harness must record:

| Item | Content |
| --- | --- |
| Hook timeout unit | Claude, Codex, Grok, Cursor: seconds; Gemini: milliseconds |
| Gemini event names | `SessionStart`, `SessionEnd`, `BeforeAgent`, `AfterAgent`, `BeforeTool`, `AfterTool`, `BeforeModel`, `AfterModel`, `BeforeToolSelection`, `PreCompress`, `Notification` |
| Cross-agent execution | Grok and Cursor also run the hooks in `~/.claude/settings.json` by default; a hook written there fires in all three agents and is recorded as Claude every time. A skills-dir plugin avoids this |
| Trust prompts | Codex and TRAE record trust by a hash of the hook content, so a version number in the command forces a new prompt after every upgrade; the command should point to a stable shim path |
| Coexisting with dotfiles | Read chezmoi's managed list before writing and do not touch paths that chezmoi manages as templates; a dotfiles skill-cleanup script deletes undeclared entries, so our entries need to be on its allowlist |

LifecycleEvent (the output of `/harness/events`): the community tools that derive state from hooks (herdr, cmux, Superset, agent-deck, ccmanager) and the Claude Agent SDK's `session_state_changed` (`idle | running | requires_action`) all land on the same signals: turn started, turn finished, user action needed. The event therefore uses a few orthogonal fields instead of one large enum:

```ts
interface LifecycleEvent {
  agent: CodingAgentId           // the real source after sniffing: Grok and Cursor also run Claude's hooks by default
  phase: 'start' | 'activity' | 'blocked' | 'finish' | 'unknown'
  scope?: 'session' | 'turn'     // separates "the agent opened" from "it started working"
  outcome?: 'completed' | 'failed' | 'cancelled'   // turn end only: StopFailure, Codex Interrupt, Cursor stop.status, Grok StopCancelled
  blocker?: 'permission' | 'question' | 'elicitation'
  turnId?: string                // Codex turn_id, Grok promptId, Cursor generation_id; used to drop late events from older turns
  subagent?: { id?: string; type?: string }        // when set, the event describes a subagent and does not change the main session's state
  tool?: { name: string; callId?: string }         // only the name, never the arguments
  sessionId?: string
  cwd?: string
  transcriptPath?: string
  terminal?: { host: 'herdr' | 'cmux' | 'superset' | 'tmux'; paneId: string }  // terminal identity, kept separate from session identity
  nativeEvent: string
}
// Also provided: reduceLifecycle(state, event, { ttlMs, now }) → LifecycleState, whose status is
// 'idle' | 'working' | 'blocked' | 'unknown' (herdr's names, mapping one-to-one to the Claude SDK's
// idle / running / requires_action); the state also keeps the current turn, recently ended turns and the time of the
// last event, which turn ordering and the TTL need

```

- Hooks lose events: Claude's `Stop` does not fire when the user interrupts; some agents send nothing when a permission prompt is cancelled. herdr therefore uses hooks only to identify the session and reads the screen for state. The reducer needs `turnId` ordering (following Grok's documented rule: only the latest turn counts, late events from older turns are dropped) and a TTL fallback; presence's current 3-minute TTL stays.
- Source sniffing: `env.GROK_SESSION_ID` or a payload with `hookEventName` → grok; `payload.cursor_version` or `env.CURSOR_VERSION` → cursor; otherwise the declared agent. Decided in P3a: payload evidence decides. The environment is inherited (Grok sets `GROK_SESSION_ID` for every MCP server it starts), so `GROK_SESSION_ID` is not used (every Grok payload carries `hookEventName`), and `CURSOR_VERSION` only counts when the declared agent is one whose hooks Cursor runs.
- How presence derives its state: `start` + `turn` → started; `activity` and `blocked` → heartbeat; `finish` → finished. "Done but not yet viewed" (herdr's `done`, Superset's `review`) is computed by the UI from `finish` and the viewed state and is not part of the event model.
- Security: Cursor's permission hooks are gates. For `beforeShellExecution`, `beforeMCPExecution`, `beforeReadFile`, `beforeTabFileRead`, `subagentStart` and `preToolUse`, exit code 0 with empty output, invalid JSON, or output that does not match the event's schema blocks the operation; exit code 2 means deny; any other non-zero exit code allows it. Observation hooks are not registered on these events, or they return an allow response that matches the schema. HookDialect records permission semantics and the response format per event instead of judging by name prefix. presence currently registers `PreToolUse` in `~/.claude/settings.json` (exit code 0, no output). Cursor loads hooks from there by default and maps it to the permission hook `preToolUse` (`SubagentStart` is not in Cursor's mapping table); the documentation does not say whether empty output blocks the operation, see agent-presence #89.
- Codex hook output: exit code 0 with no output means success and execution continues. When there is output, it may only use the fields that event supports (for example `PreToolUse` does not support `continue` or `stopReason`; returning them marks this hook run as failed, and the tool call continues anyway). HookDialect records the empty-output, JSON field and exit code semantics per event.
- Injection methods worth borrowing: cmux injects hooks into Claude by passing `--settings` through a launch wrapper, writing no global file; each agent's hook definitions are a data catalog (cmux's AgentHookDef: event list, timeout, disable switch, marker).

Lifecycle: plan (diff, commands, expected trust prompts, dropped events, dotfiles conflicts) → apply (atomic writes, ledger records, agent command line calls) → verify (compare with the ledger, use each agent's introspection commands, trigger one synthetic hook) → uninstall (delete only what the ledger records) → doctor (wrong units, unknown events, duplicate firing, stale absolute paths, broken symlinks).

### 3.9 Aggregate shapes (drawing on community implementations)

No existing library can be used directly. The mainstream local option, proper-lockfile, only offers a single-process lock with mtime expiry; it has no CAS, fencing or pid check, and it has a known unfixed reclaim race (proper-lockfile #121). redlock, pg-boss and graphile-worker are bound to Redis or Postgres. The closest thing to plan/ledger is microsoft/apm's DeploymentLedger. The shapes below combine these implementations.

#### Lease (in agent-kit-collab)

```ts
interface LeaseRecord {
  key: string
  generation: number        // +1 on creation or takeover, unchanged by heartbeats; fencing token = { key, generation }
  revision: number          // +1 on every write; CAS compares it (instead of comparing heartbeatAt strings)
  holder: ProcessIdentity | null   // { host, bootId, pid, startTime }; set to null on release, the record stays (tombstone)
  holderId: string | null   // diagnostics only
  renewedAt: number
}
```

- Problems to fix in the existing implementation (agent-orchestration, verified): the token is `{key, holderPid, holderId}`, so the same holder losing and regaining the lease produces ABA; two reclaimers reclaiming the guard at the same time can both enter the critical section (the same shape as proper-lockfile #121); the guard judges liveness only by pid, so after pid reuse `runFenced` spins forever; `tryRelease` deletes the record, which would make the generation go backwards once a generation exists.
- Borrowed from: k8s Lease's `leaseTransitions`, Consul's `LockIndex`, etcd's revision (a monotonic counter); pg-boss identifies pid reuse with pid plus start time; client-go judges expiry with the observer's clock; npm/lockfile's two-phase `.STALE` reclaim (reclaiming itself is serialized); proper-lockfile's `onCompromised` and redlock's `using(signal)` (losing the lock aborts the running fenced operation through an `AbortSignal`).
- Resource-side checks: when the protected resource can check atomically (for example a comparison inside an SQLite transaction), store `lastFence` and reject smaller generations. File resources (such as harness's Ledger) cannot do this; they use a lock that is held for the whole modification and released by the kernel when the process exits (the ledger mutual exclusion below). `runFenced`'s "guard + re-read holder" is equivalent to such a check only when every writer goes through the same store on the same machine; this goes into the LeaseStore calling convention.
- Configuration checks: heartbeat × 2 ≤ ttl; `runFenced` needs a timeout or a lease-loss signal and never polls forever.
- Storage: locally, prefer the SQLite store (`node:sqlite` uses fcntl locks underneath, `BEGIN IMMEDIATE` provides cross-process CAS, the kernel releases on process exit, and neither pid reuse nor reclaim races exist). The process lock uses one db file per key plus `PRAGMA locking_mode=EXCLUSIVE`. The file store remains as the fallback when sqlite is not available. Neither is reliable on NFS; the calling convention states that only local directories are supported.

#### InstallPlan and Ledger

```ts
interface InstallPlan {               // produced by the pure domain function plan(bundle, ledgerSnapshot, observed), no IO
  planId: string
  basedOn: { ledgerLineage: string; ledgerRevision: number }   // modeled on Terraform's lineage + serial
  bundle: { owner: string; version: string; digest: string }
  agent: { id: CodingAgentId; scope: 'user' | 'project'; root: string }
  steps: PlanStep[]
  expectedTrustPrompts: TrustPrompt[] // announced only; never approved on the user's behalf
}
interface PlanStep {
  locator: ArtifactLocator   // { kind: file | dir | symlink | json-entry | toml-entry | managed-block | cli-registration,
                             //   path (absolute, after realpath), pointer? (JSON pointer / TOML key / block id) }
  action: 'create' | 'update' | 'adopt' | 'remove' | 'noop' | 'conflict'
  precondition: { absent: true } | { hash: string } | { ownedAt: number }   // per-artifact precondition; re-checked before writing, not an atomic CAS
  desired?: { hash: string; content: string | JsonValue }
  capturePreImage: boolean
  conflict?: 'unmanaged-exists' | 'user-modified' | 'other-owner' | 'dotfiles-managed' | 'symlinked-target'
}
interface Ledger {                    // one per scope, under $XDG_STATE_HOME, never in the dotfiles source directory
  schemaVersion: number
  lineage: string                     // generated at creation, never changes
  revision: number                    // strictly +1 on every apply / uninstall
  entries: Record<LocatorKey, LedgerEntry>
  pending: PendingOp[]                // written before acting, cleared after success (modeled on Pulumi pending_operations)
}
interface LedgerEntry {
  locator: ArtifactLocator
  owners: string[]; activeOwner: string                 // modeled on apm; records ownership transfer
  bundleVersion: string; toolVersion: string
  contentHash: string                                   // normalized sha256: CRLF→LF; JSON entries serialized with sorted keys
  preImage: { existed: false } | { existed: true; hash: string; blobRef: string }   // modeled on ruler's .bak
  appliedAt: string; entryRevision: number
}
```

- Plan invariants: at most one step per locator; `remove` may only target entries this owner holds in the ledger; paths must be inside the allowed roots; when there is a conflict and no explicit choice of force / adopt / backup, the whole plan is rejected (home-manager-style full preflight before writing); a plan whose `basedOn` differs from the current ledger is rejected (Terraform's stale plan check).
- Ledger invariants: shared files record ownership per entry; only files we created, or that the user explicitly adopted, are recorded as whole files. On uninstall, the entry is deleted or the pre-image restored only when the disk hash equals `contentHash`; otherwise it is marked user-modified and kept (apm's approach). A failed or skipped step keeps its old record. If `pending` is not empty at startup, probe the actual state first instead of replaying blindly. An unknown `schemaVersion` is refused or degraded to "keep everything", never cleared (vercel skills clears its lock on a version mismatch and does not record installed paths: a counterexample).
- verify uses a three-way comparison (modeled on chezmoi): actual equals ledger but differs from desired → outdated; actual differs from ledger but equals desired → update the ledger silently; differs from both → user-modified; in the ledger but missing on disk → deleted-externally; not in the ledger but equal to desired on disk → adoptable. `doctor --fix` uses dotagents' `Check{ name, status, message, fix? }` structure.
- Implementation pitfalls: TOML needs a comment-preserving editor (`@decimalturn/toml-patch` or `@shopify/toml-patch`; dotagents serializes the whole file with smol-toml, which loses the comments in Codex's `config.toml`); JSONC uses jsonc-parser's `modify` / `applyEdits`; YAML uses yaml's Document API. An atomic write replaces a symlink with a regular file, so resolve with realpath first or refuse to write symlink targets, and keep the original mode. Multi-file writes cannot be atomic; they rely only on preflight, per-step CAS, pending and pre-images, and no transaction is promised. Agents also edit the same files themselves (for example Claude's `~/.claude.json`): re-checking the precondition before `rename` only narrows the window and is not an atomic CAS; a writer that does not take part in our lock can still write after the check and then be overwritten by us. So for shared configuration an agent is actively using, prefer the agent's command line or native plugin. When only a file edit is possible, the calling convention states that "concurrent changes by non-cooperating writers may be lost": an overwritten external change cannot be detected afterwards either (after the overwrite, the disk content equals desired, and the three-way comparison sees no difference). No CAS is promised externally.
- Ledger mutual exclusion: every ledger modification (apply, uninstall, the silent update in verify) happens within one lock holding period: read the ledger → write pending → change target files → write the ledger → clear pending, and the lock is held until the last step, so no other writer can get between "compare revision" and "write". The lock comes from the LedgerLock port (`Context.Service`): `acquire(scope) → Effect<void, LedgerBusy, Scope>`, held until the owning Scope closes. harness does not depend on collab (the dependency direction is collab → agent-kit). The default implementation uses `platform.sqlite`: one `<scope>.lock.db` per scope, `PRAGMA locking_mode=EXCLUSIVE` plus `BEGIN EXCLUSIVE` held until release. This lock is an operating-system file lock (fcntl), released by the kernel when the holding process exits or crashes. There is no reclaim step, so the race "two processes both decide the old owner is dead and one deletes the other's new lock" cannot happen, nor can an ownerless lock left by "created the lock file and crashed before writing the identity"; no fencing is needed. Waiting for the lock can be interrupted. After acquiring the lock, the holder writes its identity into the adjacent `<scope>.lock.holder` (other connections cannot read the db while it is held exclusively, so the identity is not stored in the db). The file is only a reference for doctor and may be stale; doctor only reports "lock held" with this reference and never deletes the lock. When `platform.sqlite` is not available, harness refuses to modify the ledger (`ledger-lock-unavailable`) unless the application injects its own LedgerLock; an injected implementation must likewise have the kernel or the storage guarantee "never lost while the holder is alive, released automatically when it dies". Only local directories are supported (fcntl locks are unreliable on NFS). After a crash, the pending probe at the next lock acquisition recovers (previous item). This lock logic and collab's `/process-lock` use the same approach (about 20 lines); each side keeps its own copy because harness cannot depend on collab. Acceptance: when two processes apply at the same time, only one enters the critical section; when the holder is killed, another process gets the lock immediately and completes the pending probe; when the holder hangs, the other side waits and exits when interrupted.
- Execution rules (the Effect implementation must keep them): ownership must not be lost between acquiring the lock and registering its finalizer, and a lock that is acquired after the waiter was cancelled is released immediately; pending is persisted first, and cancellation takes effect only at recoverable step boundaries; the lock is not released before an in-flight write and its record are finished (when `tryPromise` wraps a write that cannot be cancelled, put it in an uninterruptible region); the whole installation is never made uninterruptible indefinitely; partially executed installations, ACP prompts and commands with unknown results are not retried automatically, and `Effect.retry` is used only for operations that are explicitly retryable. A failed lease renewal must be supervised explicitly and interrupt the fenced work; writes after losing the lease still go through fencing.

### 3.10 Compatibility and migration

- Each kit change is additive for existing use cases; when an application adopts the kit it deletes its own code without changing its external behavior.
- The usage convention is unified on the community convention (confirmed 2026-10-06, see 3.11): input includes cached tokens, output includes reasoning, and the breakdowns are subsets. presence converts when pricing, and the signature numbers stay the same.
- The new injection logic must recognize hooks installed by old versions of presence (identified today by the `isAgentSignatureCommand` fingerprint) and replace them on upgrade instead of installing a duplicate.
- The trace viewer's host packages, agent-orchestration's lease, and any parts moved from the host application are GPL in their original repositories. The author of all of them is treated as PerfectPan; when moved into the kit they are published under MIT, the original repositories keep their licenses, and the commit message of each moved file records its source commit.
- After agent-finder is rewritten in TS: `@rivus/agent-finder-cli` switches to calling the kit's `/discovery`; `@rivus/agent-finder-core` is marked deprecated on npm and points to the kit; `PerfectPan/agent-finder` on mooncakes stops receiving updates. The deprecation and the end of updates are confirmed with the owner again before they happen.

### 3.11 Published Language: event and usage model

The usage convention follows OTel GenAI and AI SDK 7 (confirmed 2026-10-06, following community practice): totals include their breakdowns, and a missing value stays missing instead of being filled with 0. UsageRecord carries a `granularity`. When per-request data is available it is `request` (one model request, with `model`); when only an aggregate exists it is honestly marked `turn` or `session` and carries `modelCalls`, instead of being split into fake per-request records (Grok only gives a turn aggregate in `turn_completed.usage`, one record covering several model calls, with the per-model breakdown in `modelUsage`). Session or agent totals are grouped by model (OTel removed cache breakdowns from the `invoke_agent` span because aggregating across models is misleading).

```ts
interface Usage {
  inputTokens?: number        // gen_ai.usage.input_tokens, includes cache reads and writes
  outputTokens?: number       // gen_ai.usage.output_tokens, includes reasoning
  totalTokens?: number
  cacheReadTokens?: number    // ⊆ inputTokens
  cacheWriteTokens?: number   // ⊆ inputTokens
  cacheWrite1hTokens?: number // Anthropic 1-hour cache, ⊆ cacheWriteTokens
  reasoningTokens?: number    // ⊆ outputTokens
}
interface UsageRecord {
  agent: CodingAgentId; sessionId: string; agentLaneId?: string
  granularity: 'request' | 'turn' | 'session'; modelCalls?: number   // for non-request granularity, the number of model calls this aggregate covers
  requestId?: string; responseId?: string; timestamp: number
  model?: string; provider?: string
  usage: Usage
  usageByModel?: Record<string, { usage: Usage; modelCalls?: number; costUsd?: number; costSource?: 'agent' | 'pricing-table' }>
                                       // per-model breakdown in an aggregate record (such as Grok's modelUsage, with per-model call counts and costUsdTicks);
                                       // it splits usage / costUsd, so totals take one side only and never add both
  costUsd?: number; costSource?: 'agent' | 'pricing-table'; pricingMultiplier?: number
  source: SourcePointer
}
noCacheInputTokens(u)    // for pricing: input − cacheRead − cacheWrite
toAiSdkUsage(u)          // converts to AI SDK's LanguageModelUsage
toOtelAttributes(u, { cacheWriteKey: 'cache_creation' | 'cache_write' })   // defaults to cache_creation until OTel releases the new name
```

| Agent | inputTokens | outputTokens | reasoningTokens |
| --- | --- | --- | --- |
| Claude Code | input + cache_read + cache_creation | output | thinking_tokens when present |
| Codex | input (prefer `last_token_usage`, otherwise the difference of cumulative values) | output | reasoning_output_tokens |
| Gemini CLI | input + tool (tool-use prompt tokens) | output + thoughts | thoughts |
| opencode (on disk) | input + cache.read + cache.write | output + reasoning | reasoning |
| Pi | input + cacheRead + cacheWrite | output | reasoning when present |
| Grok | inputTokens | outputTokens | reasoningTokens |

presence keeps its three existing pricing rules and only switches the tokens to the new convention: (1) a cost reported by the record itself (`costSource: 'agent'`, such as Pi's cost or Grok's `costUsdTicks`) wins; (2) otherwise compute by bucket: noCacheInputTokens × input price + cacheRead × cache read price + (cacheWrite − cacheWrite1h) × 5-minute cache write price + cacheWrite1h × 1-hour cache write price (falling back to the 5-minute price when missing) + output × output price; (3) multiply the result by `pricingMultiplier`. The signature numbers stay the same, and verification compares both tokens and cost.

Event model: the trace viewer's existing ten kinds already cover the union of OTel, AI SDK, ACP, the Claude Agent SDK and the OpenAI Agents SDK. Two names change to align with the community (confirmed 2026-10-06): `thinking` → `reasoning` (only Anthropic says thinking), and `stopReason` in `request` → `finishReason` (matching `gen_ai.response.finish_reasons` and AI SDK). `tool_result` keeps its name and is mapped on export. The trace viewer's per-agent info (`id`, `parentId`, `spawnEventId`) already matches OTel's `invoke_agent` parent-child relation and ACP's subagent proposal.

Decided in P1: until `/transcript/usage` ships, usage reaches consumers on `request` events. A `request` payload carries `usage` plus the optional UsageRecord fields `granularity`, `modelCalls` and `usageByModel`, so Grok's turn aggregate is one `request` event with `granularity: 'turn'` rather than invented per-request events. A lane's `spawnEventId` names the event on the parent lane that started the subagent: a `tool_call`, or a `system` event when that is what the agent's log records. The conformance suite checks that every `spawnEventId` resolves to such an event.

Decided in P2a: `decodeUsage` decodes one source (a file, a session directory or opencode's database) and shares each agent's rules with its translator. Its stream exposes a JSON `cursor` (byte offset, line, the state the agent's rules carry, records not yet taken) that `from` continues; a file decoded in steps while it grows gives the records one decode gives, and those sum to the transcript's request usage. Records that may still change where a source ends wait in the cursor until `final: true` (Claude Code keeps up to four open requests per lane; a Codex fork's first usage record waits for the replay rule; opencode's running messages wait to finish and, with `final`, count at their creation time). opencode is read by update time and id, not by row id, which SQLite reuses after a revert deletes rows. `scanUsage` walks `listUsageSources` and keeps, in a JSON state that needs `since`, a cursor per source keyed by an identity the agent keeps when it moves the file (a Codex rollout's file name survives archiving), and a 54-bit hash of every request counted from `since` on (its response id, else its session and request id), grouped by day: a request counts once in the window, whether a Claude Code subagent file copies it, Gemini CLI migrates its chat, or a rewritten source is read again; records without an id are read again after the latest one by time and count. A source is dropped only when a complete listing of its agent no longer finds it. A source is decoded with `final` when its own modification time, read by the decode, is 30 minutes old, the reporting lag of a running session's last requests. opencode is read by row id the first time and by update time and id afterwards. Facts settled while porting presence's scanners: a Claude Code request is keyed by `requestId`, else by the message id (gateways send no request id), and keeps the largest usage among its records; a synthetic message without a request id is no request; Codex's priority multiplier comes from the rollout's `thread_settings_applied` service tier; the Codex fork rule is decided while reading (the turn-id rule when a UUIDv7 turn start comes before the first usage record, else the same-second rule); Gemini CLI's tool-use prompt tokens are input; Pi reports `reasoning` and `cacheWrite1h` subsets, and a forked or branched Pi session's copied entries are skipped; Grok's `costUsdTicks` are 10^10 per USD (Grok CLI user guide).

Decided in P2b: `/cost` is the private `@rivus/agent-kit-cost` package with only a `domain/pricing` layer. It takes nothing but types from sessions (`UsageRecord`, `Usage`, `CostSource`, so there is no `cost-source.ts`; the manifest's `typesOnly` holds every file of the package to that), states `noCacheInputTokens` and `addUsage` again for itself, and its built entry imports nothing (check-dist's zero-dependency list). `createPricing(table, { overrides, fallback })` keeps presence's lookup: keys match regardless of case; an override key that matches wins, else a table or fallback key (the table wins for the same key; the fallback holds presence's family aliases); among each, the model's own id, then the longest key the id contains; a partial override fills in from the same key's entry, and one without that entry prices nothing; lookups are cached per model id. `costOf` returns `{ costUsd, costSource }` under the record's own field names, so `{ ...record, ...cost }` is the priced record. The multiplier applies to computed cost only: an amount the agent logged is what it billed, presence does not multiply it either, and no agent today logs both a cost and a multiplier (S29 was corrected accordingly). `costOf` and `summarize` charge a record through the same portions: a record split by model is charged per model, and the models' amounts win over an amount the agent logged for the whole record; it stays whole only when the agent logged an amount for it that the split does not divide among every model, while an amount from a price table, as a spread of `costOf` leaves it, does not keep it whole. `priceUsage` keeps presence's terms and their order, so the dollars are equal to the last bit, not only to rounding. presence's windows are the last N calendar days (`usage_1d`, `usage_7d`, `--days N`), with no week start or month, so `calendarWindow(days, { now, timeZone })` takes a day count; its start is the midnight `days − 1` days back in the time zone (the earlier one when the clocks turned back over midnight), where presence subtracts multiples of 24 hours from today's midnight, which differs by the clock change for a window that spans a daylight saving change. `summarize` keeps presence's totals: entries, tokens and the sum of known costs, with the cost absent when nothing in the group was priced, and a total that adds up the groups as presence's `combineTotals` does; groups are by agent and model unless `groupBy` names one or none. `fromLiteLLM` is presence's snapshot script's conversion, per-million rounding included. presence's numbers come from a `Usage` as four buckets, `noCacheInputTokens`, `cacheReadTokens`, `cacheWriteTokens` (with `cacheWrite1hTokens`) and `outputTokens`, and its token count is `inputTokens + outputTokens`; no converter is needed.

The boundary between the kit and the trace viewer: the kit outputs a flat list of events, which reference each other through `agentId`, `parentId`, `requestId`, `callId`, `shadowedBy` and the session-level `agents[]` (a subagent's `parentId`, `spawnEventId`). Deciding these references requires understanding each agent's log format, so they are set correctly at translation time and guaranteed by the conformance tests. Assembling the references into a turn tree, timeline or context reconstruction, and UI fields such as truncated long text, prompt deduplication and source file numbering, only need the event model and are used only by the trace viewer. They stay in the trace viewer as its view types on top of TranscriptEvent and do not enter the kit's types. When a second consumer needs a turn view, the turn projection moves into `/transcript`.

The live event stream of `/acp`: ACP pushes chunks (`agent_message_chunk`, `agent_thought_chunk`, status changes in `tool_call_update`), while on-disk logs hold complete records. The event stream of `prompt()` yields both deltas and completed events. Deltas are named after AI SDK's stream events (`text-delta`, `reasoning-delta`, `tool-input-*`, `finish`); completed events are the TranscriptEvents above. A utility function folds deltas into completed events.

### 3.12 Dependencies

Confirmed 2026-10-06. Versions are the latest on the official npm registry that day; anything Node 22 provides built in is not installed as a package. Runtime dependencies are declared with caret ranges from these versions; the `effect` peer and all devDependencies are exact (2.3).

| Runtime dependency | Version | Used in | Notes |
| --- | --- | --- | --- |
| `effect` | 4.0.1 | harness execution, `/acp`, lease, lanes | Optional peer of both packages, exact version, external (3.7) |
| `zod` (only `zod/mini`) | 4.6.5 | Validating external data: agent log lines, agent configuration, ledger files, session bindings, lease records | The only validation library in the repository; the Effect parts use it too (`Effect.try` converts to typed errors) instead of `effect/Schema`: plain TS entries cannot reference effect, and one repository keeps one way of writing it. Bidirectional conversion and per-version migration use `z.codec` (tested). The ACP SDK itself declares zod as a peer. Exception: `/harness/events` must be zero-dependency and synchronous and reads only a few fields, so it uses `typeof` checks and states the reason in the code |
| `es-toolkit` | 1.52.0 | Utility functions that are actually needed (such as `isPlainObject`) | Instead of lodash-es: ships its own types, per-function imports, smaller bundles; actively maintained (by Toss, monthly releases, weekly downloads above lodash-es). The lodash-es imports in code ported from the trace viewer are replaced at the same time; `groupBy`, sorting and deep copy use the built-in `Object.groupBy`, `toSorted` and `structuredClone` |
| `jsonc-parser` | 3.3.1 | harness edits of JSON / JSONC configuration | Preserves formatting and comments (`modify` / `applyEdits`) |
| `@decimalturn/toml-patch` | 3.3.0 | harness edits of Codex's `config.toml` | Chosen over `@shopify/toml-patch`, which is still at 0.3 and has not been updated for half a year. P3 verifies that comments survive |
| `@agentclientprotocol/sdk` | 1.7.0 | `/acp` | Internal dependency, not exposed |
| `yaml` | 2.9.1 | Editing YAML configuration (Document API) | Added when an agent with YAML configuration enters harness |

Packages replaced by built-in capabilities: `node:sqlite` (not better-sqlite3), `crypto.randomUUID()` (not uuid), `AbortSignal.timeout` / `any` (not p-timeout), `Platform.spawn` wrapping `node:child_process` (not execa), Effect's Semaphore / Queue (not p-limit). semver is added when agent versions need comparing.

Development and build: the template brings Rush, TypeScript, `@perfectpan/lint-config`, oxlint, oxfmt, oxlint-tsgolint and vitest. The shell builds with tsdown and its Oxc declaration generator instead of the template's `@rslib/core` (2.3), and checks its output with `publint` 0.3.25 and `@arethetypeswrong/cli` 0.18.5 (package format and type declarations), `size-limit` 14.1.0 (per-entry size budgets), and rolldown plus oxc-parser for the dist check (no internal-package imports, browser entries without Node built-ins). `@effect/vitest` 4.0.1 (testing Effect code) came with the first Effect entries in P3b-1. `@effect/language-service` (0.87.4 by then) was left out: it is a plugin for TypeScript's JavaScript language service, which TypeScript 7 no longer ships, and its README sends TypeScript 7 projects to `@effect/tsgo`, a patched tsgo binary. Whether the Effect packages' lint runs `@effect/tsgo` is unconfirmed and decided with P3b-3; until then the consumer smoke test's single-copy check covers duplicate Effect copies.

## 4. Release and rollback

- Keep the Rush flow: change files → a Version Packages pull request that every push to `main` opens or updates → merging it tags the release, creates the GitHub Release and publishes with OIDC in the same push (decided 2026-10-07, replacing the manual Version Packages run and hand-made GitHub Release). `@rivus/agent-kit` and `@rivus/agent-kit-collab` are published in one lockstep version policy, `main`: one version, one tag `v<version>`, one release PR and one publish run for both (decided 2026-10-08 in P5, replacing "each with its own version policy"). Reasons: collab's peer range on agent-kit (`workspace:^`, published as `^<version>`) then always names the version released with it; one maintainer releases one set; the release automation (`release-state.ts`, one tag) stays single-policy. Cost: a release of either bumps both, so collab can publish a version without changes of its own. `rush publish` goes through the policy in `rush.json` order, agent-kit before collab, so the peer is on npm first; each package has its own npm trusted publisher (docs/development/release.md). 0.1.0 and 0.2.0 publish `@rivus/agent-kit` only; `@rivus/agent-kit-collab` ships with the release after 0.2.0.
- Package format: ESM only, `sideEffects: false`, published `engines.node >=22.13` (`node:sqlite` without a flag, `require(esm)` available); development and CI use Node 24; MIT. `effect` is an optional peer of both packages (exactly 4.0.1 in the first release) and a devDependency, external at build time (3.7).
- Rush pitfall: when only a private internal package changes, `rush change` does not ask for a change file for the shell package, so a version bump can be missed. Since P0, CI runs `scripts/release-intent.ts check`: a change to shipped files of a bundled internal package must come with a change file for `@rivus/agent-kit`, and `release-intent.ts add` writes one. Switch to changesets only if this check proves awkward in practice.
- Cross-repository integration uses snapshot preview releases (or pkg.pr.new), not `link:`.
- Rollback: the application reverts its adoption pull request first; the kit's additive changes can stay, or the affected version can be deprecated.

## 5. Verification

- Conformance tests: each agent uses scrubbed real logs as samples and runs the trace viewer's existing 13 checks (discovery reads at most 128 KB per file, ids are stable and unique, every record ends up somewhere, tool results are paired, compaction shadowing relations hold, source pointers can be read back, declared capabilities match the output, no `node:*` import, and so on).
- Usage comparison: presence's ccusage alignment tests still pass; run the old and new implementations on real local logs and compare token totals per agent.
- Shell package checks (CI): per-entry size and dependency budgets (`/harness/events` has zero dependencies); general-purpose entries are bundled for a browser target, and any `node:*` fails the check; publint and attw; architecture boundary tests.
- Injection: everything runs plan / apply / verify / uninstall under a temporary `HOME` and compares file contents before and after with the ledger; the real `~/.claude` and `~/.codex` are never touched.

## 6. Execution plan

### 6.1 Preconditions

- All decisions in section 7 are confirmed. The license and the agent-finder rewrite are settled.
- Two technical checks pass: bundling type declarations and the release reminder check under Rush. Both passed in P0: declarations through tsdown's Oxc generator after rslib `dts.bundle` failed under TypeScript 7 (2.3), and the reminder through `scripts/release-intent.ts` (4).

### 6.2 Completion contract

- presence, the trace viewer, agent-task-loop and the editor plugin no longer carry the duplicate implementations listed in 1.2; each one's tests pass and its external behavior is unchanged.
- Agent facts such as agent-presence #85 and #86 exist in one place only, the kit's harness (HookDialect), and are covered by tests.
- The kit's CI checks are all green, and at least one stable version is released and used by every application.

### 6.3 Phases and tasks

The order follows "the application whose code is moved adopts first", which has the lowest risk. In each phase the kit releases first, then each application opens one pull request.

#### P0: Start

| Item | Content |
| --- | --- |
| Content | Confirm the decisions; generate the repository from project-template-rush; write the Spec, this Markdown plan, the `CONTEXT.md` glossary and `docs/architecture/authoring.md` (DDD conventions, in a plain TS part and an Effect part); write `infra/architecture/boundaries.ts` and the boundary tests (including the Effect allowlist from 3.3); verify pure-entry isolation through the boundary test, and prepare the optional peer and Effect version resolution checks (3.7), which start running in P3 (2.3); set up the skeleton of the internal packages that 0.1.0 needs, the shell package build and the four CI checks (5); run the two technical checks |
| Exit condition | With an empty skeleton, the shell package builds every entry, shared chunks are correct, bundled type declarations are correct and CI is green; deliberately adding a violating import makes the boundary test fail |
| Status | Implemented. All exit conditions met: tsdown builds one entry per subpath with shared chunks; attw and publint accept the bundled declarations; `check:package` adds size budgets and the dist check; the boundary test runs positive and negative fixtures (package dependencies, layer rules, exact npm specifiers, `node:*` only in platform-node, the Effect allowlist); CI is green on `main`. Not done in P0, on purpose: the optional `effect` peer and resolved-version checks moved to P3, because no 0.1.0 entry imports `effect` (2.3); they run since P3b-1 |

#### P1: catalog, platform, sessions / transcript (Claude, Codex, Grok)

| Item | Content |
| --- | --- |
| Sources | The reading part of the trace viewer's kernel (session discovery, head/tail preview, directory walking, JSONL reading, usage, session assembly), its per-agent host parsers and its conformance suite; presence's path rules (adding `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and archived sessions) |
| Adoption | The trace viewer adopts first and deletes its own host packages and reading code (reconstruction and view projection stay in the trace viewer) |
| Exit condition | The trace viewer's tests and the conformance tests pass; the session list matches main |
| Status | Kit side implemented: `/catalog` (six agent identities and home rules), `/platform`, `/node` (`createNodePlatform`), `/sessions` and `/transcript` with built-in adapters for Claude Code, Codex and Grok, and `/testing` (`createMemoryPlatform`, `sessionAdapterConformance`). Met: every built-in adapter passes the conformance suite on the memory platform and in a real temporary directory, and `npm run check` passes. Open until adoption, which follows the release: the trace viewer's tests on the kit and the comparison of its session list with main |

0.1.0 is released at the end of P1 (2.3).

#### P2: usage decoding and cost

| Item | Content |
| --- | --- |
| Sources | The rules of presence's 6 scanners (deduplication, replay skipping, cache splitting, reasoning folding), pricing, windows; the unified convention |
| Adoption | presence (the price snapshot and the weekly workflow stay in presence and are injected into `/cost`); the editor plugin switches to bundling the kit's zero-dependency entry |
| Exit condition | The ccusage alignment tests pass; on real logs, old and new token totals and cost totals are equal per agent (covering self-reported cost, the 1-hour cache and the pricing multiplier); after the trace viewer's session list switches to streaming summaries, its memory no longer grows with session size |
| Status | Kit side implemented: `/transcript/usage` (P2a: `decodeUsage`, `scanUsage` and `listUsageSources` for Claude Code, Codex, Gemini CLI, Grok, opencode and Pi) and `/cost` (P2b: `createPricing`, `costOf`, `calendarWindow`, `summarize`, `fromLiteLLM`), both zero-dependency entries. Met: the ccusage bucket alignment tests; presence's pricing, cost, ccusage parity and window summary tests, ported; every decoded usage fixture costs what presence's formula gives on the same buckets, covering self-reported cost, the 1-hour cache and the Codex priority multiplier; the consumer smoke test prices a decoded session per seeded agent. A read-only run on one machine's logs (Claude Code, Codex and opencode over 1, 7 and 30 days) found `costOf` equal to presence's formula on every record. Open until adoption: presence's tests on the kit and the per-agent totals of old and new on real logs, which differ where P2a changed decoding rules (in that run, Claude Code within 0.2% of tokens once running sessions count as complete, Codex 2–6% fewer tokens, and Codex's priority multiplier taken from each rollout's thread settings instead of the current `config.toml`); the editor plugin's switch to the zero-dependency entry; the trace viewer's streaming summaries |

#### P3: harness: hook events and injection

| Item | Content |
| --- | --- |
| Sources | presence's hooks, sources and installers, rewritten under 3.8; fix the timeout units and the Gemini event names; Claude switches to the skills-dir plugin |
| Effect | harness's apply / verify / uninstall and LedgerLock are orchestrated with Effect; following the execution rules in 3.9, add tests for failure, cancellation and pending recovery at each write stage. With this first Effect entry, the optional `effect` peer and the resolved-version check (3.7) start running (moved from P0, 2.3) |
| Adoption | presence's hook entry switches to `/harness/events`, and its setup switches to `planInstall` / `applyInstall`, run once in the CLI with `Effect.runPromiseExit`. presence first separates the build outputs of hook and setup (today tsc compiles without bundling and the CLI imports setup statically), so that the hook process does not load Effect |
| Exit condition | Install, verify and uninstall all pass under a temporary `HOME`; old hooks are replaced correctly; after installing the new version and downgrading to the old one, each event fires once (6.5); Codex no longer asks for trust again after an upgrade; agent-presence #89 is verified and handled (3.8) |
| Status | P3a (hook dialects and lifecycle events) implemented: the private `@rivus/agent-kit-harness` package with `domain/lifecycle` and `agents/<agent>/hook-dialect.ts` for Claude Code, Codex, Cursor, Gemini CLI, Grok, opencode and Pi (each fact cites the agent's docs or source; unconfirmed facts carry an `unverified` note), the `/harness/events` entry (`readHookEvent`, `reduceLifecycle`, `lifecycleStatus`, `heartbeatSignal`, `builtinHookDialects`), Cursor's identity in catalog, and `hookDialectConformance` in `/testing` with scrubbed samples for every event. The dist check fails if the entry's files or chunks import anything; the consumer smoke test measures its cold start in a fresh process (about 2 ms for import plus one read, against about 7 ms for presence's hook-context module and 23 ms for its hook command module). Regression tests cover agent-presence #85 (timeout units), #86 (Gemini event names) and the Cursor gate facts behind #89; #89 itself stays open until it is checked in a real Cursor. Left for P3b: injection (`planInstall` / `applyInstall`, ledger, LedgerLock, Effect), which generates hook registrations from the dialects (event names, timeout unit, `passThrough`, `runsHooksOf`). P3b-1 (Effect infrastructure) implemented: `effect` 4.0.1 is an exact optional peer and a devDependency of the shell, platform and platform-node, and stays external; `/platform/effect` (`PlatformService`) and `/node/effect` (`NodePlatformLive`) are the first Effect entries (2.3); the dist check classifies every entry as Effect or plain and fails when a plain entry's code or declarations reach `effect`, when an Effect entry imports no effect module, or when any built file inlines a module from `node_modules` (read from the bundler's `//#region` source comments); the consumer smoke test installs the tarball once without `effect` (npm must not install it) and once with `effect` 4.0.1 (one copy, the same one for host and kit, a program run with `Effect.runPromiseExit`); the boundary test allows Effect in the two `src/effect.ts` files and treats a sibling's `<package>/effect` import, and a relative import of `src/effect.ts` from a plain file, as an Effect import P3b-2 (injection domain, plain TS, not yet public) implemented: `domain/bundle` (Bundle with legacy markers, `hookRegistrations` in each dialect's event names and timeout unit, refusing observers on gates where silence blocks), `domain/install-plan` (the InstallPlan aggregate, `buildInstallPlan`, conflict detection with the force / adopt / backup table, step ordering, strategy preference) and `domain/ledger` (the Ledger aggregate with pending operations, recovery by probing, ownership and release across owners and agents, three-way verify, `checkLedgerVersion`); the ledger fixture builder and the property-style invariant tests are in the testing package. Every Ledger change advances the revision by one, so an apply advances it at least twice (pending recorded, outcomes recorded) |

#### P4: discovery and agent-task-loop adoption

| Item | Content |
| --- | --- |
| Sources | agent-finder's catalog of 26 agents and its detection logic (rewritten from MoonBit in TS, keeping its test samples as a reference), agent-orchestration's login state checks |
| Adoption | agent-task-loop's `init`, session discovery and preview switch to the kit; agent-finder-cli switches to calling `/discovery`; delete agent-sessions, the MoonBit source of `packages/agent-finder`, and the duplicated session root directories and resume commands in the TUI |
| Exit condition | For the same set of probe inputs, the rewrite produces the same report as the MoonBit version; agent-task-loop's tests pass; Codex preview no longer double-counts turns; agent-task-loop's CI no longer needs the MoonBit toolchain |
| Wrap-up | After confirmation, deprecate `@rivus/agent-finder-core` on npm and stop updating the mooncakes module |
| Status | Kit side implemented: `/discovery` (`detectAgents`, `builtinProbeRecipes` for agent-finder's 26 agents plus Grok, `classifyInstallation`, `resolveAuthState`), catalog identities for the 21 agents it did not know (home rules for the nine whose source or documentation names the directory and its override; `resolveHome` takes `CodingAgentIdWithHome`), and in `/testing` `probeRecipeConformance` and scripted commands for `createMemoryPlatform`. Met: given agent-finder's own provider facts, `detectAgents` reports what the MoonBit scanner reported for agent-finder's test probes and one synthetic probe; every built-in recipe passes the conformance suite. Decisions: `detectAgents` resolves to `Installation[]` rather than a `Result`, because a failed check is a per-agent `problem` and there is no call-level expected failure; probing is concurrent with a per-command time limit, so a Promise is enough. Login state is read-only and offline by default (`authProbe: 'files'`: credential files and variables, non-secret fields only); agents' status commands run only with `authProbe: 'commands'`; version probes run by default (they make an agent `runnable`) and `versionProbe: false` turns them off; each recipe lists the known side effects of both; the ACP login probe stays with `/acp`. The built-in recipes correct the agent-finder facts that upstream sources contradict and name the facts still unverified in `warnings`; the parity test lists which recipes changed. Open until adoption: agent-task-loop's `init` and agent-finder-cli switching to `/discovery` (the CLI's report will show the corrected facts), removing the MoonBit source, and the wrap-up |

#### P5: collab first release (lease, process lock); agent-kit adds redact

| Item | Content |
| --- | --- |
| Sources | lease is rewritten under 3.9 following agent-orchestration's interface (SQLite store first, file store as fallback), and `@rivus/agent-kit-collab` publishes `/lease` and `/process-lock`; redact comes from the trace viewer and goes into agent-kit |
| Effect | lease uses Effect to manage heartbeats and abort on loss; process-lock stays plain TS; the existing CAS, ABA and reclaim race tests are kept |
| Adoption | agent-task-loop and room-web switch to collab's lease (room-web's SQLite store can be replaced directly); the hand-written heartbeat, AbortController and `finally` release in agent-task-loop's TaskOccupancyService move to the kit's supervised lease use case; the host application adds its single-instance lock with `acquireProcessLock`; presence replaces its mkdir lock; the trace viewer's and the host application's redaction are unified |
| Exit condition | All race tests pass: two reclaimers reclaiming at once, ABA, generation still monotonic after release and re-creation, pid reuse, fenced operation aborted on lease loss; a second daemon of the host application is refused at startup |
| Status | Kit side done (2026-10-08): `/redact` in agent-kit (`packages/redact`), `@rivus/agent-kit-collab` with `/lease` and `/process-lock`, in the `main` lockstep policy; the race tests above pass with real child processes (Spec S37, S38, S60–S66). Adoption by the applications is open |

Implementation decisions (P5):

- Lease expiry follows client-go: each observer times the current revision from the moment it first read it, with its own monotonic clock, so a new observer waits a full TTL before taking over a holder it cannot judge. A holder on the same host is judged directly: an earlier boot, a missing pid or a reused pid (start time differs) is dead and taken over at once. `renewedAt` is wall-clock time for diagnostics only.
- `LeaseStore` is `read`, `compareAndSet(key, expectedRevision, next)` and `fence(key)` (a scoped per-key guard across processes). The manager owns the Lease rules; stores only compare revisions. `runFenced` takes the fence (the wait itself raced against the loss signal), re-reads the record, and races the work against the heartbeat's loss signal. `Effect.raceFirst` waits for the losing fiber to end, so the fence is held until the work's fiber has ended; a Promise an interrupted fiber started keeps running, so non-cancellable writes go in `Effect.uninterruptible` (review of the first P5 commit, which showed a 600 ms `tryPromise` write landing after the successor's).
- The fences, and the file store's per-key CAS guard, are process locks: an exclusive SQLite database when the platform has SQLite, otherwise a lock file with npm/lockfile-style serialized reclaim (`<path>.stale`, re-checked under that guard, recursive up to three levels). Both lease adapters and the process lock share this one implementation; the lease folder's domain owns the holder rule (`holderLiveness`) that the lock-file fallback uses.
- SQLite exclusive locks keep their journal in memory and use a 10 ms busy timeout plus a few jittered retries: a killed holder otherwise leaves a hot journal that makes every next contender report busy, and contenders that start together otherwise all back off (found by the four-process reclaim test). The rule is recorded in `docs/architecture/authoring.md` for harness's LedgerLock too.
- The manager is created with `createLeaseManager(config)` and acquires with `manager.acquire(key)`; there is no separate `acquireLease` function, which would only forward to it. Store Layers that take options are factories (`sqliteLeaseStore({ path })`), not `<Variant><Port>Live` constants.
- The store conformance cases (CAS, generation monotonic across release and reopening, per-key fences) run inside collab's tests for every store; exporting them for third-party stores (a collab `/testing` entry) waits for a consumer that writes its own store.
- `/redact` follows the trace viewer's implementation and adds Windows and MSYS spellings, URL-encoded file URLs, `~<user>`, and more token families; a secret prefix inside a longer word is no longer redacted. It caches the patterns of the last home it saw.

#### P6: agent-kit's `/acp`; collab's `/lanes` (built in-house)

| Item | Content |
| --- | --- |
| `/acp` sources | Rewritten in Effect, with separate Scopes for the connection and for turns. Draws on agent-orchestration's AcpConnector (Promise based) and the host application's ACP loop (Effect outside, async generator inside), merging the pitfalls both fixed: explicit environment variables, permissions denied by default, invalidating the session binding when a cancel does not settle, `session/load` and `session/resume`. Policies that differ between the two (where environment variables come from, handshake timeout, whether client file reads and writes are offered) become parameters. Per-agent connection details (claude-agent-acp's `_meta.systemPrompt` and `_meta.claudeCode.options`, codex-acp taking the system prompt as the first block, Grok's `_meta.rules`, and so on) go into acp's `agents/` (each agent's AcpProfile, consistent with the ownership in 3.1). The translation from ACP updates to the event model is shared with the trace viewer's Grok parser for `updates.jsonl` |
| `/lanes` sources | The coalesced wake-up from agent-orchestration's AgentRuntime (without room-shaped keys) plus the global concurrency limit and bounded queue of the host application's session scheduler |
| Design reference | Vercel AI SDK HarnessV1: interfaces carry version literals; session "resume" and turn "continue" are separate; lifecycle state is serializable and schema-validated; sessions and turns have separate state machines |
| Adoption | room-web adopts first (ACP and lanes replaced; ToolServer stays in agent-orchestration for now); agent-task-loop's agent-orchestration keeps only the room-specific parts and ToolServer; the host application may replace its ACP loop with `/acp` and compose the kit's Layers directly; room-web holds a `ManagedRuntime` in RoomLabHost, and its wake / cancel callbacks must run Effects explicitly and observe failures |
| Exit condition | Both sides' existing ACP tests pass on the new implementation; local smoke tests cover claude-agent-acp, codex-acp, opencode, Gemini and Grok; with a global limit set, room-web no longer starts ACP processes without bound; the ACP cancel deadline covers "send cancel + wait for the turn to end", after which the binding is invalidated and the process closed, and force-killing a shared connection invalidates the other sessions on it |
| Status | `/lanes` done (2026-10-08): `createLanes` in `@rivus/agent-kit-collab/lanes` (Spec S40, S100–S108), with the coalescing, cancel, close and timeout tests of agent-orchestration's AgentRuntime and the capacity, queue-bound and fairness tests of the host application's scheduler restated on Effect's test clock. Adoption by room-web and the host application is open |

Implementation decisions (P6, `/lanes`):

- The Lane states are idle, queued and running, plus `pending`: a wake no started activation has served. Wakes of a queued lane change nothing and a running lane owes at most one more activation, so the queue holds each key at most once. Only an idle lane is admitted (`admit`: start while a slot is free and nobody waits, otherwise queue while there is room, otherwise `LaneQueueFull`); a coalesced wake is never refused. A running lane that owes an activation re-enters at the end of the queue when its activation ends and the freed slot goes to the head first, which keeps the queue within its bound and gives the host scheduler's fairness: a key woken again while it ran does not pass keys that waited. `maxQueued` is optional; without it the queue is bounded by the number of keys.
- Interruption is signalled, not delivered to fibers: each started activation gets a `stop` Deferred and an `ended` Deferred in the same synchronous step that records it, its work races `stop`, and `cancel`, `close` and the turn timer complete `stop` and `cancel` and `close` wait on `ended`; a Deferred keeps its first value, so the first of them names the reason even when the cleanup it starts outlasts the deadline. `stop` comes first in the race, which forks its contenders in order and stops at the first that has ended, so an activation stopped before its fiber ran never calls `activate`. The work loses the race only once its Scope has closed, so the exit `activate` reached is recorded inside the Scope: a success or failure that a cancel, close or timeout meets during the cleanup is reported as it is (keeping a defect the cleanup adds, dropping the interruption), and `ActivationInterrupted` only when the body itself was cut short (review of the first `/lanes` commit, whose probes reported a 90 ms success with 30 ms cleanup under a 100 ms timeout as a timeout, and called `activate` after `close`). The activation fiber is forked detached and uninterruptible, so it always reaches the step that frees its slot, even when `cancel` or `close` come before it has started. Every state change is one synchronous step (JavaScript runs one fiber at a time), so no lock is needed; `wake` is uninterruptible so that an activation recorded as started always gets its fiber. A Deferred resumes its waiters synchronously, so `ended` is completed after the slot has passed on (found by a test with asynchronous finalizers).
- Each activation runs in a Scope of its own and the lanes capture the context `createLanes` ran in. `onExit` reports how each activation ended (succeeded, failed with its cause, or interrupted by cancel, close or timeout) before the lane can start again, and a defect it raises is logged with `Effect.logWarning`, because agent-orchestration's afterTurn needs the timeout distinguished and must finish before the next activation; the lease, the agent connection and the prompt stay in the caller's `activate`, which keeps lanes free of ACP and of any store.

### 6.4 Validation ledger

| Batch | Command or evidence | Expected result |
| --- | --- | --- |
| Every batch (kit) | `rush build`, `rush test`, lint, per-entry size and browser bundle checks, publint, attw | All green |
| P1 | The trace viewer's `rush test` plus the conformance tests; compare the session list with main | Pass, identical |
| P2 | presence `pnpm test` (including ccusage alignment); per-agent token and cost totals of the old and new implementations on local logs | Pass, equal per agent |
| P3 | plan / apply / verify / uninstall under a temporary `HOME`; hook entry cold start time | Files match the ledger; not slower than today |
| P4 | agent-task-loop `pnpm test`, `init` smoke test | Pass |
| P5 | Multi-process lock contention tests; starting the host application twice | Only one holder; the second is refused |

### 6.5 Rollback per batch

The smallest reversible unit is one adoption pull request of one application: revert the application side first; the kit's additive versions do not affect applications that have not adopted them. P3 touches configuration on users' machines: old versions of presence do not recognize the skills-dir plugin installed by the new version, so rerunning the old setup directly would make the restored global hooks and the plugin's hooks fire twice. The rollback order is therefore: first use the new version to uninstall according to the ledger and verify that it is clean, then install the old version and run the old setup. P3's acceptance adds "downgrade after installing the new version": under a temporary `HOME`, install the new version → uninstall → install the old version, and confirm that each event fires only once.

## 7. Risks and open questions

| Item | Type | Impact | Next step |
| --- | --- | --- | --- |
| License and authorship | Decided | The kit uses MIT; the author of code moved from the trace viewer, agent-orchestration and the host application is treated as PerfectPan, so it can be published under MIT | Confirmed 2026-10-05 |
| Whether agent-finder is rewritten from MoonBit in TS | Decided | Rewrite; the published core package and the mooncakes module are handled in the P4 wrap-up | Confirmed 2026-10-05 |
| Usage convention | Decided | Affects UsageRecord and presence's conversion | Confirmed 2026-10-06 to follow community practice, OTel GenAI and AI SDK 7: inputTokens includes cache, outputTokens includes reasoning, and cacheReadTokens, cacheWriteTokens and reasoningTokens are subsets (field names match AI SDK's inputTokenDetails / outputTokenDetails). Community comparison: OTel, AI SDK 7, OpenAI and LangSmith use this convention; Anthropic / the Claude Agent SDK, ccusage and Langfuse exclude cache from input, so cache is added back to input when importing Claude logs and subtracted again when exporting to Langfuse / ccusage |
| Event model renames: `thinking` → `reasoning`, `stopReason` → `finishReason` | Decided | Aligns with OTel, AI SDK and OpenAI; affects the trace viewer's schema and web UI | Confirmed 2026-10-06; done together with moving the trace viewer's parsers in P1 |
| Naming: package names `@rivus/agent-kit` and `@rivus/agent-kit-collab` | Decided | Entry names | Confirmed 2026-10-06 to keep the `@rivus` scope; the injection context is `harness`; the default term for third-party agents is CodingAgent |
| Scope of Effect | Decided | Affects 3.3, 3.4, 3.5, 3.7, 3.9 and P0, P3, P5, P6 | Confirmed 2026-10-06: split by side-effect weight, only Effect-native entries, optional peer exactly 4.0.1 (3.7) |
| Effect version alignment | Risk | When the host and the kit resolve different Effect versions, the runtime may fail internally (mixing rc.108 and 4.0.1 failed in tests), and v4 has no version check | Exact peer plus a CI check of the resolved version; the host application aligns its lockfile to 4.0.1 before adoption |
| The boundary between plain TS and Effect calling styles | Risk | Locks released early, long-lived handles closed by a short Scope, cancellation causes overwritten | The execution rules in 3.9; no Promise facade; tested examples for the three kinds of integration |
| Collaboration runtime: build our own or use the AI SDK harness | Decided | Build our own: ACP goes into agent-kit's `/acp`, lanes into collab; the MCP tool server stays out for now; AI SDK is only a design reference | Confirmed 2026-10-05 |
| Bundling type declarations, Rush release reminder | Decided | Whether P0 can finish | Verified in P0: tsdown with the Oxc declaration generator and `isolatedDeclarations` in internal packages (2.3); `scripts/release-intent.ts check` in CI (4) |
| ABA, reclaim race and pid reuse in agent-orchestration's current lease (in use by agent-task-loop and room-web) | Risk | In extreme cases two processes hold the same task's lease at once, or a successor is stuck forever | P5 rewrites it under 3.9 and adds race tests; if symptoms appear before P5, add a generation in agent-orchestration first |
| Whether the in-session MCP tool server enters the kit | Follow-up | Only room-web uses agent-orchestration's ToolServer today; the host application has its own MCP bridge for background sessions | When the host application decides to switch, or a second consumer appears, move it from agent-orchestration into agent-kit's `/mcp` |
| Frequent changes in upstream agent formats | Risk | The kit must release first and applications upgrade after it, one step behind | Fact corrections are patches, which applications' caret ranges pick up automatically |
| presence's signature numbers change after unifying the convention | Risk | User-visible | Covered by the old/new comparison tests in P2 |

## Appendix

### A.1 Source inventory

The line-count inventory of the source code was used to size the phases. It describes private repositories and is not reproduced in this public document.

### A.2 Reference implementations

- effect v4: one package with subpaths, with platform implementations in separate packages; the migration guide says that independently versioned v3 packages were "making compatibility between packages difficult to track". [MIGRATION.md](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)
- vitest 5: internal subpackages are devDependencies, and the rollup build pins stateful modules into one shared chunk. [rollup.config.js](https://github.com/vitest-dev/vitest/blob/main/packages/vitest/rollup.config.js)
- MCP TypeScript SDK v2: the private core-internal package is inlined with tsdown `noExternal`; schemas that need identity live in the published core package. [tsdown.config.ts](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/tsdown.config.ts)
- Vercel AI SDK: specification (`@ai-sdk/provider`, with LanguageModelV2/V3/V4 side by side) → public functions (`ai`) → per-provider implementations; the new `@ai-sdk/harness` (HarnessV1 plus adapters for 9 coding agents). [provider-abstraction](https://github.com/vercel/ai/blob/main/architecture/provider-abstraction.md), [harness-abstraction](https://github.com/vercel/ai/blob/main/architecture/harness-abstraction.md)
- ECMA-429 Minimum Common Web API (WinterTC / Ecma TC55, first edition December 2025). [ECMA-429](https://ecma-international.org/publications-and-standards/standards/ecma-429/), [editor's draft](https://min-common-api.proposal.wintertc.org/)
- Claude Code plugins: [plugin init (skills-dir)](https://code.claude.com/docs/en/plugins/cli-reference), [hooks](https://code.claude.com/docs/en/hooks); Gemini CLI [hooks reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md); [Agent Skills](https://agentskills.io).

### A.3 Experiment records

| Experiment | Result |
| --- | --- |
| Whether multi-entry bundling splits out shared modules (two entries sharing one file with module-level state) | rslib 1.0.3 split out `v.js` and tsdown 0.23 split out `catalog-<hash>.mjs`; in both, the registry went 1 → 2, one module instance |
| Effect 4.0.1 cold start (Node 24.18, dynamic import) | `effect` about 90 ms, `effect/Effect` about 23 ms, `effect/Schema` about 53 ms |
| Several Effect versions side by side | Same version: 14/14 pass; 4.0.1 ← rc.108: 12/14; rc.108 ← 4.0.1: 4/14; v3 and v4 do not interoperate |
| Domain-layer dependencies of the host application | Its domain layers do not import `effect` |

### A.4 Community comparison research

- Done: lease and plan / ledger, with conclusions merged into 3.9. Main references: [k8s Lease](https://github.com/kubernetes/api/blob/master/coordination/v1/types.go), [etcd Mutex](https://github.com/etcd-io/etcd/blob/main/client/v3/concurrency/mutex.go), [pg-boss](https://github.com/timgit/pg-boss/blob/master/src/plans.ts), [npm/lockfile](https://github.com/npm/lockfile/blob/master/lockfile.js), [Kleppmann's critique of Redlock](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html); [apm DeploymentLedger](https://github.com/microsoft/apm/blob/main/src/apm_cli/core/deployment_ledger.py), [dotagents mcp-writer](https://github.com/getsentry/dotagents/blob/main/packages/dotagents/src/targets/mcp-writer.ts), [chezmoi entryState](https://github.com/twpayne/chezmoi/blob/master/internal/chezmoi/entrystate.go), [OpenTofu state](https://github.com/opentofu/opentofu/blob/main/internal/states/statefile/version4.go), [Pulumi checkpoint](https://github.com/pulumi/pulumi/blob/master/sdk/go/common/apitype/core.go), [home-manager files.nix](https://github.com/nix-community/home-manager/blob/master/modules/files.nix).
- Done: lifecycle events and the transcript event model, with conclusions merged into 3.8 and 3.11. Main references: herdr, cmux, Superset, agent-deck, ccmanager; [OTel GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai), AI SDK 7's LanguageModelUsage, ACP, the Claude Agent SDK, the OpenAI Agents SDK, ccusage, Langfuse, LangSmith.

### A.5 Review record

- 2026-10-06, codex round 1: 12 findings on this plan (9 major, 3 minor), plus 1 at the boundary between this plan and the DDD conventions plan (where seedwork goes). Each was checked against the source and the research material, all held, and all were fixed: Platform gained `spawn`, `realpath` and a `stat` that does not follow links (3.2); ledger mutual exclusion became an application-injectable LedgerLock and no longer depends on collab (3.1, 3.9); the plan states that the re-check before `rename` is not an atomic CAS (3.9); the complete list of Cursor permission hooks, Codex plugin hooks and hook output semantics (3.8); UsageRecord gained a granularity, and pricing keeps self-reported cost, the 1-hour cache and the multiplier (3.11, 6.3, 6.4); `Result` must be unwrapped before entering Effect (3.5, 3.7); `Result` moved into the shared kernel catalog (3.1, 3.3, 3.4); P6's ACP connection details belong to acp (6.3); rollback order and downgrade acceptance (6.3, 6.5).
- 2026-10-06, codex round 2: 19 of round 1's 20 findings confirmed resolved; 1 still open and 3 new, all checked, held and fixed: the plan states that an overwritten external change cannot be detected afterwards, and the comments on `plan.apply()` and `precondition` no longer promise CAS (3.4, 3.9); ledger mutual exclusion became "the lock spans the whole modification", and `lastFence` was removed (3.1, 3.9); `usageByModel` keeps per-model call counts and cost (3.11).
- 2026-10-06, codex round 3: 2 of the previous round's 4 findings confirmed resolved; the ledger lock's reclaim race and "crash after creating the lock and before writing the identity" were still open, checked and held. The default lock became an SQLite exclusive lock (released by the kernel when the process exits, no reclaim step), and when sqlite is unavailable and no lock is injected, ledger modification is refused (3.1, 3.9).
- 2026-10-06, codex round 4: both findings of the previous round confirmed resolved; 1 new minor (the holder identity inside the db cannot be read while it is held exclusively), fixed by writing it to an adjacent reference file. The review converged.
- 2026-10-06, discussion with codex about the scope of Effect (two rounds): in the first round both sides chose "split by side-effect weight"; codex added measurements of Scope and supervision and the harness execution rules, and corrected the assumption that presence was bundled. In the second round the owner questioned the Promise facade plus native dual API; after reading presence setup, agent-task-loop's TaskOccupancyService and room-web's RoomLabHost, codex changed to recommending native entries only. The conclusion is in 3.7.
- 2026-10-07, P0 and P1 implementation: decisions made while building were recorded here. 2.3 gained rows for the shell build (tsdown with the Oxc declaration generator, `isolatedDeclarations` in internal packages), dependency ranges (caret runtime dependencies, exact devDependencies and `effect` peer), the session adapter layout (pure translation in `agents/`, IO assembly and `builtinSessionAdapters` in `application/session-adapters/`) and leaving `streamEvents` out of 0.1.0. The 0.1.0 error tags, abort and throw rules are in 3.5; the public surface limit is in 3.6; usage fields on `request` events and the targets of `spawnEventId` are in 3.11; the verified home rules are in 3.1; 6.3 marks P0 and P1 implemented. codex reviewed each slice before it merged (scaffold: 6 findings; Node platform: 2; sessions core: 8; Codex adapter: 5 plus 1 follow-up; all fixed), and the Grok adapter went through the same review.

This plan was compiled from four inventories and four research threads. After the decisions in section 7 were confirmed, it was converted into this Markdown version.
