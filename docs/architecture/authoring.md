# Authoring Conventions

Use this guide when adding or changing code in an agent-kit context. It defines where code goes, how aggregates and use cases are shaped, and which rules apply to plain TS contexts and to Effect contexts. [CONTEXT.md](../../CONTEXT.md) defines the terms. The architecture manifest `infra/architecture/boundaries.ts` and the boundary rules generated from it enforce the dependency rules below (see [Verify At The Owner](#verify-at-the-owner)).

## Choose The Owner

Start from the knowledge and the invariants, not from the file you want to write. Each kind of agent knowledge has one owner:

| Context | Package | Kind | Owns |
| --- | --- | --- | --- |
| catalog | `@rivus/agent-kit-catalog` | Shared kernel | Identity and home-rule models, `Result`, service tables and lookups |
| discovery | `@rivus/agent-kit-discovery` | Supporting | Installation detection and probe recipe interfaces |
| sessions | `@rivus/agent-kit-sessions` | Core | Session, transcript and usage models; reading and decoding use cases |
| cost | `@rivus/agent-kit-cost` | Supporting | Pricing formulas and summaries over injected price tables; the LiteLLM price snapshot |
| harness | `@rivus/agent-kit-harness` | Core | Extension strategies, hook and install interfaces, plans and the ledger |
| acp | `@rivus/agent-kit-acp` | Supporting | ACP profile interfaces, sessions and bindings |
| lease, lanes | `@rivus/agent-kit-collab` | Generic | Mutual exclusion and scheduling between agents |
| redact | `@rivus/agent-kit-redact` | Utility module | Pure redaction functions; no domain model |

Providers own their agent's identity, probe recipes, hook dialects, install adapters, log layouts and decoding,
and ACP launch details. Built-in agents live in private packages under `packages/providers/`.
Providers implement context SPI interfaces; contexts own the service models, shared helpers and use cases.
The shell assembles the built-in service tables and derives its built-in id union from the provider identities.
Contexts contain no agent knowledge or built-in tables; they read the service tables supplied by their callers.

- Agent-specific code belongs to its provider; shared format rules and helpers belong to the context that uses them. catalog stays small because every context must coordinate when it changes.
- Code that changes because of the same upstream change belongs together. An agent's installer and hook parser share its HookDialect in the provider.
- A package is not a new bounded context, and a pure re-export is not a second owner. The shell packages own nothing; Platform is a technical port, not a context.
- A revision counter, a JSON file, a state machine or a validator does not by itself establish an owner. Find the context whose invariants the code protects.
- An abstraction needs at least two real consumers. Code with a single consumer stays in that application until a second consumer appears.
- Adding an agent: create its provider package with one subpath per supported service, declare its SPI dependencies and services in `boundaries.ts`, and register it in the shell's service tables. Run the services' conformance suites from testing. Record unsupported services, update the README support matrix, and declare the provider's facts path in the boundary manifest.

## Lay Out A Context Package

Every context package uses the same layout, creating only the directories it needs:

```text
<context>/src/
  domain/<concept>/
    aggregates/  entities/  value-objects/  factories/  errors/  events/  services/
    adapters/           shared format readers and renderers for this concept's model
    spi/                pure provider interfaces and their parts
  application/
    use-cases/          the public use cases, a file per use case; closely related operations may share one
                        (harness keeps `inventory` and `discardPlan` together)
    services/           coordination code shared by use cases; may call ports, holds no business rules
    spi.ts              provider interfaces that read files, with their input and result types
    ports.ts            context-owned infrastructure ports and injection tags
    platform.ts         the use cases' Platform requirements, where separate from the provider SPI
  infra/
    repository/         persistence implementations: aggregate repositories (ledger, leases)
                        and key-value stores such as acp's session bindings
    models/             stored formats and their codecs
    adapters/           other port implementations (editors, CLI runners, fences)
    factories/          Layer compositions
    services/           helpers shared by infra files
  lib/                  pure utilities with no domain or IO dependencies
  public.ts             use cases, the types their signatures name and the names siblings import,
                        selected by the shell package
  spi.ts                provider interfaces and the context helpers their implementations need
```

Agent-specific code lives in providers. A domain `adapters/` folder holds only shared external-format readers
and renderers. The five such folders are harness lifecycle (hook payloads), sessions transcript (ACP updates),
sessions usage (usage lines), cost pricing (LiteLLM price lists) and discovery installation (version output).
They are pure. The `layer` rule prevents the model layer from importing them. They are the only domain layer allowed schema dependencies such as `zod/mini`.

| Layer | Responsibility | Boundary enforcement |
| --- | --- | --- |
| `domain/` | Pure model rules, aggregates, entities, values and services; no IO or Platform | `layer`, `types-only`, `external-dependency`, `effect` |
| `domain/<concept>/adapters/` | Shared external-format readers and renderers; no agent-specific rules or IO | Separate `adapters` layer in `boundaries.layers`; `external-dependency`, `effect` |
| `application/` | Use cases and shared coordination through service tables and ports | `layer`, `package-dependency`, `effect` |
| `infra/` | Port implementations, stored formats and Layer compositions; outside access through Platform | `layer`, `node-builtin`, `effect` |
| `lib/` | Pure helpers with no domain meaning or Node capability | `layer`; `external-dependency` permits only package-declared `zod/mini` |

The exact import matrix and npm specifiers live in `boundaries.ts`, not a second allowlist here. See
[Boundary Rules](#boundary-rules) for the checks and their fixtures.

`@rivus/agent-kit-collab` is a published package that keeps its own code, so it nests this layout under each public entry: `src/lease/domain/lease/`, `src/lease/application/`, `src/lease/infra/`, `src/process-lock/application/`, each entry's file being `src/<entry>/public.ts` (`entries` in `boundaries.ts`). The layer rules apply across the entry folders as within one context: the plain process lock judges holders with lease's domain rules, and lease's infra uses the process lock for its fences. collab reaches agent-kit only through the public entries listed under `publicImports` (`/catalog`, `/platform`, `/platform/effect`), which the boundary rules treat as the shared kernel, the Platform port and its Effect entry; agent-kit is a peer, so a process holds one copy of each.

- Cross-package imports go through the target package's `public.ts`, or its `spi.ts` when the importer's `spiImports` explicitly lists that dependency; never into its `domain/` (including the `adapters/` folders) or `infra/`. Dependencies are declared in `package.json`; pnpm's isolated `node_modules` gives a package only what it declares, so an undeclared import does not resolve. A package whose tests need a workspace package that its sources may not use, such as acp's tests starting a fake agent through platform-node, declares it as a devDependency and lists it under `testsOnly` in the manifest.
- Sibling access requires the importer's `dependsOn` and the target's explicit `siblingEntries` in `boundaries.ts`. Each listed entry must exist in the target's `exports`; adding an export alone grants no sibling access. Lists contain only entries used by siblings: harness lists `public/events`, never its aggregate `public` entry. Bare package imports must name an explicit entry; `public/effect` stays shell-only, and siblings use the declared `effect` entry. SPI access remains governed separately by `spiImports`.
- `public.ts` lists the context's use cases, the types their signatures name and the names siblings import. A pure context such as catalog or cost has no `application/`: its use cases are domain services or factories designed as operations for callers, such as cost's `createPricing`, `summarize` and `priceRecord`, and callers call them directly. The building blocks of a use case stay internal even when a caller could use them: cost exports `priceRecord`, which prices one record by model and on which `summarize` is built, not the token formula and the per-model split inside it. Shared format parsing stays in domain `adapters/`; agent-specific translation lives in providers.
- A concept's `adapters/` folder and `infra/` are different things. A shared format adapter translates a format we do not control into our model. A port adapter implements an interface we declared. A port implementation never goes under a concept's `adapters/`, and a format translation never goes under `infra/`.
- A use case is an operation the package exports for applications: `listSessions`, `planInstall`, `acquireProcessLock`. In a context with `application/`, its file lives in `application/use-cases/`. Code the use cases share — building a ledger scope, decoding one file's records, walking session directories — lives in `application/services/`; it may call ports but owns no business rules. `errors.ts` and `ports.ts` stay at the `application/` root.

## Provider Packages

A provider is a private `@rivus/agent-kit-provider-<agent>` package bundled into the shell. It creates only the
service files it supports:

```text
packages/providers/<agent>/
  src/
    facts.ts       identity, home rules, paths, commands, environment names and agentMarkers
    layout.ts      storage layout shared by discovery, sessions and usage, when needed
    records.ts     shared record parsing; records/ may hold several related modules
    identity.ts    CodingAgent
    discovery.ts   ProbeRecipe
    hooks.ts       HookDialect
    install.ts     InstallAdapter
    sessions.ts    SessionAdapter; sessions/ holds listing and transcript implementation
    usage.ts       UsageDecoder
    acp.ts         AcpProfile
  test/            agent-specific fixtures, behavior and service conformance tests
```

`providerServices` in the boundary manifest declares each service subpath. The manifest test
`requires provider service exports and refuses a barrel` checks the package exports. The
`package-dependency`, `spi-import` and `relative-escape` rules enforce the provider-to-context direction:
providers use context SPI entries, without importing the shell, another provider or a context's implementation.
Contexts and testing source do not import providers; integration tests use declared `testsOnly` access.
Provider interfaces supply Platform slices through the context SPI, so provider code needs no direct Platform import.

The `provider-entry` rule keeps hooks and usage, including their transitive local helpers, within their slim import
sets. Its lists live in `infra/architecture/lint.ts`, with allowed and rejected cases in `provider-cases.ts` and
its agent-specific case files. Keep parsing shared by sessions and usage in `records.ts` or `records/`, not in
`sessions/`; `facts.ts` must satisfy both slim paths. These restrictions do not grant otherwise undeclared SPI or
npm access. The `shell-entry` rule binds each service subpath only from its matching shell table module.

Relations between agents are data: a HookDialect names `foreignHooks` by agent id rather than importing another
provider. Formats used by several agents belong to their context's SPI: ACP update translation in sessions,
command-hook configuration and shared skills-directory rendering in harness, and base ACP environment rules in acp.
Add an SPI helper only when a provider imports it. Agent layouts, records and translators stay in the provider;
cost has no provider consumer and no SPI entry.

Unsupported services and the README support matrix are checked by `packages/agent-kit/test/provider-tables.test.ts`.
Every built-in agent/service pair has either an implementation or a reason in `src/providers/unsupported.ts`.
Cross-agent conformance stays in testing and harness with complete test tables; provider-local suites use their own
services. Generic helpers under `testing/test/` may be imported by relative path from provider tests and are not
production API. Development dependency cycles are permitted by `ignoreWorkspaceCycles`; `testsOnly` dependencies
and the acyclic production graph are enforced by `manifest.test.ts`.

## Service Tables And Routing

The shell owns the `Provider` descriptor: an id and optional implementations of identity, discovery, hooks,
install, sessions, usage and ACP. Each `src/providers/<service>.ts` assembles one built-in service table; the
separate `builtin.ts` assembles complete descriptors. Providers implement context interfaces without importing
this shell type. Catalog owns `ServiceTable<T>`, a read-only partial record keyed by agent id.

Context use cases require exactly the service tables they read, including identity when resolving aliases or
homes. Routed shell calls accept `providers?: readonly Provider[]`. Each supplied service replaces that service
for the same id; omitted services and other agents keep their defaults. Later descriptors win when they supply
the same service for the same id. There is no global registry. `provider-bindings.test.ts` covers the bindings and
`provider-tables.test.ts` covers repeated descriptors and the built-in tables.

Every capability lookup uses catalog's `lookupService(agent, table)` or `requireService(agent, table, reason?)`.
The first returns `Result<T, CapabilityUnsupported>` when data names an unsupported agent; the second throws
`AgentKitError` with code `capability-unsupported` when the caller explicitly requests one. Only own, non-null
entries count. `service-table.test.ts` covers these cases. A supplied service's agent id must match its descriptor.

Identity queries take the table explicitly. `parseCodingAgentId(input, identities)` resolves aliases;
`homeRuleOf(agent, identities, own?)` prefers the service's own rule to the identity fallback, and `homeFromRule`
resolves it with supplied home and environment values. `identity.test.ts` covers canonical ids before aliases,
key/id mismatches and name conflicts; the shell validates merged identities. Providers carry their home rules
from `facts.ts`, while third-party adapters may use the identity fallback. Catalog's id type is a string; the
shell's `BuiltinCodingAgentId` and membership guard derive from its identity table, and its public `CodingAgentId`
retains completion for built-ins while accepting third-party ids.

### Host Markers

A HookDialect's `hostMarkers` declares top-level payload fields and environment variables that identify the agent
actually running a hook. `sniffSource` checks all payload markers before any environment marker, in hooks-table
order within each kind. An environment marker is inherited by every child process the agent starts, so it names a
host only where no payload evidence exists and the variable cannot reach the other agent's processes; it applies
only when the declared agent is listed in that dialect's `foreignHooks`. The shell puts Grok before Cursor, covered
by `provider-tables.test.ts`; cross-agent samples run in `testing/test/hook-dialects.conformance.test.ts`. Terminal
identity is separate from coding-agent identity and belongs to harness lifecycle services.

## Read-Side Services And Utilities

Catalog home resolution, discovery classification, harness lifecycle and session/transcript/usage rules live in
`services/`; their read models remain plain data. Context `lib/` folders hold time conversion, own-property lookup,
JSON formatting (with its `JsonValue` type), bounded key retention and the short hash. Schema helpers use
only `zod/mini`. The shared `@perfectpan/lint-config` (v0.6.1) disables `promise/valid-params`: TypeScript
checks Promise method arity, while that rule misreads `z.catch(schema, fallback)` as a Promise method. Source files
keep the direct schema call without local disable comments. Keep lenient parsing local to each context: sessions
wraps an optional schema and falls back to absence, while cost, discovery and harness take an explicit fallback. Sharing them would add cross-context parsing
dependencies or expand catalog beyond its shared identity model.

Sessions' path helpers deliberately preserve spelling. Homes, session refs and POSIX filenames may contain
backslashes, repeated separators or dot segments, and usage ids depend on those exact strings. `pathe` normalizes
these inputs, so it cannot replace these helpers for their accepted input domain. Providers access these helpers through the sessions SPI.
`deepFreeze` freezes its argument; value factories copy retained data first, while `Ledger.restore` freezes the supplied snapshot in place.

## Aggregate Or Value Object

Use the lifecycle as the criterion. A concept is an aggregate when it keeps one identity across state changes and invariants must hold across those changes: transitions can be legal or illegal depending on the current state. A concept that is created once and then only read, compared or recomputed is a value object, however large it is.

| Aggregate | Lifecycle that makes it one |
| --- | --- |
| InstallPlan (harness) | Its content is immutable, but it has an identity and a lifecycle: built against one ledger revision, then applied once or discarded, and refused once the ledger has moved on |
| Ledger (harness) | Revisions strictly increase; every entry has an owner; modifications happen only under the LedgerLock; an unknown version is never cleared |
| AcpSession (acp) | A state machine (starting, ready, turn in progress or awaiting permission, cancelling, closed) with one turn at a time and nothing allowed after close |
| Lease (collab) | One holder at a time; the generation never decreases, including across release and takeover |
| Lane (collab) | An in-memory state machine (idle, queued, running, with a pending activation while queued or woken again while running) with at most one activation per key |

Read-only contexts have no aggregates. sessions, discovery, cost and catalog only project data that agents wrote; their models are plain value objects and domain services such as `foldTranscript`. Do not invent an aggregate to make a read-only context look like the others.

## Model Boundaries

| Side | Scope | Value objects | Boundary data |
| --- | --- | --- | --- |
| Write | harness bundle, install-plan and ledger; acp; collab lease and lanes | Immutable classes with value-owned rules | Plain snapshots through `toSnapshot()` and `restore()` where values cross a boundary |
| Read | sessions, discovery, cost, catalog and harness lifecycle | Plain data, with behavior in domain services | The data itself |

Keep aggregate snapshot types beside their aggregate, and provider interfaces in `spi/` or `application/spi.ts`,
not among value objects. A separate DTO is needed only when the public shape must differ from a snapshot. Plain
request and response data with no value-owned rule stays plain; the write-side sections below identify those cases.
Sessions are read-side values: `SessionRef` identifies an agent's conversation, while `SessionHead` and
`SessionSummary` describe moments of it. The kit does not maintain their lifecycle or its own session index.

A rule about one value belongs to that value, a rule spanning objects belongs in `services/`, and a pure helper
without domain meaning belongs in `lib/`. The manifest test `forbids policies folders throughout the repository`
enforces the directory rule. Code needing a Node capability belongs in application services or infra, accessed
through Platform; add a missing port capability with both platform-node and memory-platform implementations.

## Aggregate Shape

- An aggregate is a frozen class with a private constructor. The only ways to obtain one are `create` (new identity from validated input) and `restore` (a validated snapshot entering the model). Files under `factories/` prepare their input, for example `buildInstallPlan` turns a Bundle, a Ledger snapshot and the observed files into a plan.
- A transition is a method that returns `{ state, events }`: the next frozen instance and the domain events it produced. The previous instance does not change. The transition type is one line declared next to its aggregate; there is no shared base type.
- A transition that the invariants reject returns a `_tag` error as a `Result` value; only a defect throws.
- Validators and transition helpers inside the domain support the aggregate and do not become a second way to change its state.
- An aggregate never receives a repository, a port or a Platform. Use cases load it, call a transition and save the result.

```ts
// Illustrative shape; harness's Ledger and InstallPlan follow it.
type AcpSessionTransition = { readonly state: AcpSession; readonly events: readonly AcpSessionEvent[] }

export class AcpSession {
  static create(input: CreateAcpSessionInput): Result<AcpSession, AcpSessionError>
  static restore(snapshot: AcpSessionSnapshot): Result<AcpSession, AcpSessionError>

  // A declared field, not a constructor parameter property: the shell package type-checks the bundled sources with
  // `erasableSyntaxOnly`.
  private readonly snapshot: AcpSessionSnapshot

  private constructor(snapshot: AcpSessionSnapshot) {
    this.snapshot = snapshot
    Object.freeze(this)
  }

  startTurn(turn: TurnInput): Result<AcpSessionTransition, TurnInProgress | SessionClosed>
  toSnapshot(): AcpSessionSnapshot
}
```

## Entities

An entity is a child of one aggregate: it has a local identity inside that aggregate, but no identity outside it. It is a read-only record in the root's snapshot, it is read only through the root's methods, and it is created and changed only by the root's transitions. It has no store and no lock of its own. An entity with its own lifecycle and its own store is an aggregate; promote it rather than giving it a repository. Harness's Ledger keeps its entries, pending operations and kept artifacts as immutable classes under `domain/ledger/entities/`. The root alone restores these children and replaces them through its transitions; each child validates its own fields, while the Ledger checks locator keys, revisions and uniqueness. Ownership and release are entry methods, and pending operations resolve crash probes. Child snapshots retain the stored record shape; inventory, pending-operation errors and the testing SPI expose those plain snapshots. A save writes the entire Ledger snapshot.

## Harness Write-Side Values

Install-plan and bundle keep their own rules on immutable classes: `ArtifactLocator`, `PlanStep`, `Precondition`,
`Conflict`, `InstallTarget`, `PlanBasis`, `Bundle`, `ArtifactSpec`, `Owner` and `RegistrationState`. Construction keeps
caller input untouched, including rejected input. ArtifactSpec copies each spec once; Bundle copies its metadata and
retains the validated spec snapshots. RegistrationState copies its record and installed-copy inputs; ordinary file
and directory observations keep the read content until a value object retains it. Values and aggregates share the
pure `lib/deep-freeze.ts` helper. A `PlanStep` owns its field invariants, disk-write decision, precondition checks and
resulting content. `InstallPlan` checks cross-step and ledger evidence, then stores validated steps; it orders installation before reverse-order
removal. The install-plan aggregate owns root containment and ledger-basis comparisons; its tests cover rejection reasons and ordering.

Public and persisted data stay plain. Explicit `Snapshot` types name those shapes internally; public and testing
SPI exports expose the plain shapes. Provider render requests (`HookSpec`, `SkillSpec`, `McpServerSpec`,
`InstructionSpec`), rendered `DesiredArtifact`, observed `ObservedArtifact`, `TrustPrompt`, a step's `contentAfter`
result and the provider's `Strategy` literal union remain boundary data. The install-plan SPI directory holds the
rendered/observed records and `TrustPromptKind`; `TrustPrompt` belongs to the plan snapshot in `value-objects/`, and
the `contentAfter` result — declared by `PlanStep.contentAfter`; planning resolves it — lives in planning
(`plan-install.ts`). `Strategy` lives with the bundle SPI. Registration
observations are transient and need no additional snapshot type. Every aggregate-to-port or public boundary uses
plain snapshots.

Cross-object conflict choices, legacy ownership, registration commands and strategy choice live in `services/`; step construction belongs to the install-plan factory. Shared
install-file rendering also lives in bundle `services/`, retaining its provider SPI exports. Legacy command content
is parsed with `zod/mini` in the application layer before the domain receives text evidence keyed by each observation;
locator-based planning selects the last observation, while preserved hooks use their own text. Marker matching
itself stays a domain rule. The testing SPI applies the same boundary validation to plain fixtures.

## ACP Write-Side Values

`AbsolutePath` parses an absolute spelling, formats it and checks containment by path parts. It preserves `..`
until the Platform resolves links; rejecting relative input still returns `undefined`. Prefix and append operations
return immutable paths. The value stays inside the application and domain, so it needs no snapshot type.
`SessionBinding` copies its typed input and selects the agent that owns it, without adding field validation.
`SessionBindingSnapshot` retains the plain store and public shape; application writes explicitly call `toSnapshot()`.
The file store validates and serializes the persisted shape.

`McpServerConfig`, `NameValue` and `PromptBlock` remain plain ACP request data in `value-objects/`; SDK conversion
belongs to the wire adapter. Session setup, permission selection, client-path verdicts and environment filtering
span several inputs and live in `services/`. `spi/` holds provider interfaces and their parts; the provider environment
defaults live beside the ACP profile there. ACP has no shared external-format domain adapter.

## Collab Write-Side Values

Lease and lane rules live on immutable classes. `FencingToken` validates its key and generation, advances the
fencing generation through Results and checks a resource's highest accepted token. Generation exhaustion returns
`LeaseRecordInvalid`, mapped to the manager's `invalid-record` failure before saving. `Holder` copies a typed process
identity and judges liveness without rejecting nonfinite numbers; repository codecs validate persisted identities.
`LeaseTiming` validates durations and judges the holder's renewal deadline. `LaneLimits` validates capacity and timeouts and owns admission and FIFO
selection. Lease owns observation, freshness, acquisition and loss; Lane derives wake results from its events.

`HolderSnapshot` and `FencingTokenSnapshot` name boundary data internally; the public `Holder` export remains the
plain identity shape. Lease snapshots, held errors and handle tokens contain plain data, with explicit conversion
from values. Lease copies its retained holder before freezing the snapshot, and Lane freezes its own snapshot;
caller inputs stay untouched. Timing and limits stay inside the application/domain and need no snapshot type.
Record restoration keeps the key, generation, revision, holder/id and renewal-time validation order.
Loss classification accepts a raw snapshot to report missing records and inconsistent holder/id pairs. Repository read failures are mapped in the application.

## Aggregates, Entities And Repositories

- `application/ports.ts` declares a port, `infra/` implements it, and the assembly injects the implementation. Neither the aggregate nor its entities ever hold a repository, a port or a Platform.
- A use case loads the aggregate (or reads data) through ports, calls the aggregate root's method, and saves the result. A save writes the whole aggregate atomically, guarded by the version on the root, so a concurrent writer is refused instead of interleaved.
- Domain services never call ports. The use case loads the data a domain service needs first and passes it in as plain values.
- Port interfaces live in `application/` because only application code calls them (use cases and application services). types-ddd puts them in the domain because its domain services call repositories; this kit has no domain services that call ports.

## Repository Shape

An aggregate's repository port — `LedgerRepository`, `LeaseRepository` — offers:

- `load(id)` -> the stored snapshot, or `undefined` when there is none;
- `save(id, snapshot, expectedRevision: number | undefined)` -> `void`; a revision mismatch is a typed error
  `{ _tag: "RevisionConflict", ... }` in the error channel. Expected outcomes are `_tag` errors, never booleans.
- aggregate-specific operations only where the aggregate needs them: Ledger's pre-image blobs, Lease's `fence`.

Each context declares its own `RevisionConflict` next to its port; the type is not shared across contexts. Its
fields are named alike in every context — the context's id field (`scope` for the ledger, `key` for the lease),
plus `expectedRevision` and `storedRevision`.
`SessionBindingStore` (acp) stores value objects as a key-value store. `LedgerLock` supplies mutual exclusion as
a separate port beside the repository.

The generic conformance cases for this shape (`load` of a missing id, the first `save`, a stale revision refused
with `RevisionConflict` and nothing changed, strictly increasing revisions, an unknown `schemaVersion` refused and
kept, and reopening for persistent implementations) live in the testing package's Effect entry
(`/testing/effect`), so an implementation — built-in or third-party — runs them from its fixtures.

## Coordinate Through Application Ports

- A use case loads an aggregate or reads data through ports, applies domain rules, saves the result, and coordinates external work through ports. It never constructs a concrete adapter.
- Each use case declares only the ports it uses. In a plain TS context the platform part is the first parameter, typed as a `Pick`, for example `listSessions(deps: Pick<Platform, 'fs' | 'env' | 'home'>, opts)`. In an Effect context the use case takes its ports from `Context.Service` (see [Effect Rules](#effect-rules)).
- Harness validates the containers returned by `LedgerRepository.load` in `loadLedger` before restoring the domain model. A stored snapshot and its `entries` must be plain objects, and `pending` must be an array; invalid containers fail with `InvalidLedger`. This also rejects array-valued `entries` from external repositories, as the file repository's schema already does.
- The application layer holds no policy: trigger timing, fail-open behavior, retries, which agents to count and where to store results belong to the consuming application.
- Do not add an export, a deep import or a facade to make a caller compile. Derive option and result types from the retained signatures (`Parameters`, `ReturnType`) instead.

## Make Persistence And Partial Failure Explicit

- Write a repository's preconditions into its calling convention. Promise CAS only when the repository can check atomically (the SQLite lease repository compares inside a transaction) or when every writer goes through the same lock (the file lease repository's guard, the LedgerLock).
- Shared configuration files that agents and other tools also write are not under a common lock. Do not promise CAS for them: re-checking a precondition before `rename` narrows the window but does not close it, and an overwritten external change cannot be detected afterwards. Prefer the agent's command line or native plugin for files the agent is using.
- Every ledger modification happens within one lock holding period: read the ledger, write pending, change the target files, write the ledger, clear pending. The lock is held until the last step.
- Multi-step writes are not transactions. Failures stay visible to the caller; pending operations are written before acting and probed (not replayed blindly) at the next lock acquisition; pre-images allow restoring what was there.
- A stored file with an unknown `schemaVersion` is refused or kept whole, never cleared.
- Locks and stores support local directories only; fcntl locks are unreliable on NFS.
- A lock held as an exclusive SQLite database (`locking_mode=EXCLUSIVE`, `BEGIN EXCLUSIVE`), such as the process lock and the LedgerLock, sets `journal_mode=MEMORY` and a busy timeout of a few milliseconds. A holder killed with an on-disk journal leaves a hot journal, and contenders that start together then all report busy although nobody holds the lock; without a busy timeout, simultaneous contenders also all back off. The wait blocks the thread, so a caller that waits for a holder retries instead of raising the timeout. `node:sqlite` refuses `journal_mode=OFF`.

## Expose A Small Public Surface

- Stateless operations are functions over plain data. Stateful parts are created by factory functions. The public error class `AgentKitError` (`code` + `cause`) is recognized through a `Symbol.for` brand.
- Aggregates are exposed as handle interfaces plus read-only snapshot types, obtained only through use cases. Their classes never appear in `public.ts`.
- `spi.ts` lists the provider interfaces and shared helpers used by providers. Pure interfaces and their parts live in `domain/<concept>/spi/`; file-reading interfaces and their Platform slices live in `application/spi.ts`. `application/ports.ts` holds ports implemented by the kit's own infra. Shared helpers stay internal until a third-party provider needs them; SPI interface types are public through their service's shell entry. `spi: true` declares the entry in the boundary manifest; `spiImports` grants SPI access independently of `dependsOn` public entry access, subject to the existing layer and type-only rules. Testing imports harness's plain SPI for ledger fixtures; its hook conformance uses `public/events` to avoid the aggregate Effect entry.
- `public.ts` lists every exported name. The shell re-exports unchanged names one by one and binds routed functions to the per-service modules under `src/providers/`. Each entry imports only the services it binds; `/harness/events` reads only the hooks table. `builtinProviders` is assembled for consumers that need all services and shares the ordinary pack, so its service objects are the ones those use cases bind. `/cost`, `/cost/prices`, `/harness/events` and `/transcript/usage` stay isolated; hooks retain their own `builtinHookDialects` export and separate objects. The `shell-entry` rule enforces `boundaries.shellImports` and named exports. Internal `public.ts` names do not become shell exports automatically. Within a package, import the defining file directly; `manifest.test.ts` rejects sibling and concept `index.ts` barrels, and `public-entry` checks entry access.
- A published name needs an application, provider SPI or testing consumer. Unconsumed option/result types stay in signatures without named exports; derive them with `Parameters`, `ReturnType`, indexed access or Effect success/error types. `/catalog` retains `AgentKitError` and `isAgentKitError` for recognizing shell errors. Individual built-in tables other than `builtinHookDialects`, per-agent transcript exports and unbound `parseCodingAgentId` are not shell API.
- Descriptor types use the narrow `acp/public/profiles` and `harness/public/install` entries so declaration bundling does not pull aggregate Effect dependencies into plain entries. A sibling entry is not automatically a published entry: keep only names imported by sibling source or tests.
- An entry whose runtime profile differs from the rest of its context, such as the hook path `/harness/events`, gets its own file next to `public.ts` (harness's `src/events.ts`, cost's `src/prices.ts` for the price snapshot), exported as `<package>/public/<name>`. It imports only the layers that path needs, so its module graph does not depend on tree-shaking, and the shell entry imports its context function from that entry to bind the needed service tables.
- Adapter interfaces carry a version literal (`specificationVersion: 'sessions-v1'`, `'harness-v1'`), so a later version can coexist with the current one.
- Versioning: correcting an agent fact is a patch; a new agent, event type or capability is a minor; dropping a Node LTS is a major. Unstable APIs go under `/experimental/*`.

## Plain TS Rules

These rules apply to every domain layer and to the contexts that do not use Effect: catalog, discovery, sessions and transcript, `/transcript/usage`, cost, redact, `/harness/events` and the process lock.

- Async shapes: a single result is a `Promise`; sessions, events and usage are `AsyncIterable`, and leaving the loop cancels the work; every IO function accepts `{ signal?: AbortSignal }`; functions on the hook path are synchronous and do no IO.
- Errors: expected outcomes are `Result` values whose `error` carries a `_tag`; only defects throw. A line that cannot be parsed is recorded as skipped; only an unrecognized format generation is an error.
- Dependencies: the platform, or the part of it the function uses, is the first parameter. There is no kit object bound to a platform.
- Validation of external data uses `zod/mini`; it is the only validation library. The built files of the zero-dependency entries (`/transcript/usage`, `/harness/events`, `/cost`, `/cost/prices`) import nothing, so a host that cannot install dependencies loads them on their own: `vp pack` bundles `zod/mini` into the first three, and `/cost/prices` uses none. It also bundles `zod/mini` into the code `/node`, `/node/effect` and `@rivus/agent-kit-collab/process-lock` load, so loading those entries does not load the zod package. Every other entry imports `zod/mini`, and zod stays a dependency of both published packages. The hook path stays synchronous and parses its payloads through schemas too.
- Prefer existing libraries and built-ins over hand-written equivalents: `es-toolkit` instead of lodash-es; `Object.groupBy`, `toSorted`, `structuredClone`, `crypto.randomUUID()`, `AbortSignal.timeout` and `AbortSignal.any` where they suffice.
- A plain TS context must not import `effect`, and the module graph and published `.d.ts` graph of a plain entry must not reach it. The boundary lint checks each file's imports; the shell's dist check follows the graph of every built entry.
- A plain context moves its reading layer to Effect only when it gains live following, file watching, background index refresh or concurrent scanning with backpressure. Its translation functions stay plain.

## Do Not Hand-Write Shape Guards

- Validate unknown data with a `zod/mini` schema at the boundary instead of hand-written shape readers or guards. For a non-null, non-array object check that must preserve the value without copying it or reading getters, use `z.custom(z.util.isObject)`; it accepts custom prototypes, class instances and built-in objects.
- Use es-toolkit's `isPlainObject` where the package already depends on es-toolkit and the decision needs its prototype check, including container decisions on `JSON.parse` output.
- The allowed exceptions each carry their reason in a comment at the site: brand-symbol guards, deep-freeze helpers, narrowing a known union, and object checks used only for `WeakSet`/`WeakMap` bookkeeping. Review enforces this rule.

## Effect Rules

These rules apply to the use cases and port adapters of harness execution (apply, verify, uninstall, the LedgerLock), acp, collab's lease and lanes, and to the Platform service.

- Only `application/` and `infra/` of these contexts, and the `src/effect.ts` files of the next rule, may import `effect`. Their `domain/`, the `adapters/` folders included, stays plain TS, like every other domain layer.
- A package whose entries must stay plain keeps its Effect counterpart in `src/effect.ts`, exported to the shell as `<package>/public/effect` and, when siblings need it, to them as `<package>/effect`. platform exports `PlatformService` both ways (published as `/platform/effect`); platform-node exports `NodePlatformLive` only to the shell (`/node/effect`), because only applications provide the platform. The boundary lint counts an import of `<package>/effect`, or a relative import of `src/effect.ts` from a file outside the Effect allowlist, as an Effect import. Every published Effect entry is listed in `EFFECT_ENTRIES` of the shell's `scripts/check-dist.ts` and `scripts/smoke-consumer.ts`; every other entry is checked as plain.
- A port is a class-style `Context.Service` named after the port and keyed `@rivus/agent-kit/<context>/<Port>/v1`, for example `LedgerLock` keyed `@rivus/agent-kit/harness/LedgerLock/v1`; collab's ports carry its own package name, such as `LeaseRepository` keyed `@rivus/agent-kit-collab/lease/LeaseRepository/v1`. When a plain interface already has the port's name, the service adds `Service`: `PlatformService`, keyed `@rivus/agent-kit/platform/Platform/v1`, holds a `Platform`. The key is the service's runtime identity; it moves to `v2` only for an incompatible interface. `isolatedDeclarations` rejects a call in `extends`, so the generated base gets an explicit type:

  ```ts
  const KEY = "@rivus/agent-kit/harness/LedgerLock/v1";
  const LedgerLockBase: Context.ServiceClass<LedgerLock, typeof KEY, LedgerLockShape> = Context.Service<
    LedgerLock,
    LedgerLockShape
  >()(KEY);
  export class LedgerLock extends LedgerLockBase {}
  ```

- A port's implementation is a Layer in the context's `infra/`, named `<Variant><Port>Live` (`SqliteLedgerLockLive`), or a function named `<variant><Port>` when the Layer takes options (`sqliteLeaseRepository({ path })`); a context's default set, such as `HarnessLive` (`infra/factories/`), is composed there too, because `application/` may not import `infra/`. Layers in a context's `infra/` require `PlatformService` and never provide it; the application provides it with platform-node's `NodePlatformLive` or its own `Layer.succeed(PlatformService, platform)`. A Layer that captures the environment builds it lazily (`Layer.sync`, `Layer.effect`), never at import. Platform stays one service; do not turn each Platform method into its own service.
- Compose Layers with `Layer.provide` or `Layer.provideMerge`. `Layer.mergeAll` only merges outputs; it does not feed one Layer's output into another Layer of the same group.
- Entries return `Effect`, `Stream` or `Layer`. Cancellation is fiber interruption, and long-lived resources (ACP connections, lease managers, lanes) belong to a Scope the caller provides.
- Errors use the same `_tag` unions as the plain TS side, in the typed error channel. A `Result` from a plain function enters it through `fromResult`, one expression that each Effect context declares in its `application/`; `catchTag` does not see an `{ ok: false }` value that was never failed:

  ```ts
  const fromResult = <A, E>(result: Result<A, E>): Effect.Effect<A, E> =>
    result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);
  ```

- External data is validated with `zod/mini` here too; `Effect.try` (or `safeParse` and `fromResult`) turns a failed parse into a `_tag` error. `effect/Schema` is not used.
- There is no Promise facade: kit code never calls `Effect.runPromise`, `Effect.runSync`, `Effect.runFork` or builds a `ManagedRuntime` outside tests. Consumers run Effects at their assembly root.
- Child processes go through `Platform.spawn`, not `effect/process`.
- `effect` is an optional peer of the published packages, pinned to an exact version, and a devDependency; it stays external and is never bundled. The dist check fails when a built file inlines a module from `node_modules` (it reads the bundler's `//#region` source comments), when an Effect entry imports no effect module, or when a plain entry reaches effect, and the consumer smoke test runs the Effect entries on the host's single copy.
- Production code must not use Effect APIs tagged `@stability unstable`: the lint of platform, platform-node and harness runs `effect-tsgo diagnostics --strict`, which fails on the `unstableApiUsage` warning. Test code may use `@effect/vitest`, which Effect tags unstable as a whole, so the test tsconfigs of platform-node and harness set `unstableApiUsage` to `off` in their `@effect/language-service` plugin, and their production tsconfigs keep the default. The other contexts' lint does not run `effect-tsgo`; the rule holds for their sources by convention.

Execution rules for locks, writes and retries. Wrapping an async function in `tryPromise` and moving its parameters into a service is not enough: a `tryPromise` around a write that cannot be cancelled lets a timeout release the lock before the write finishes.

- A lock is a scoped resource acquired with `Effect.acquireRelease`. Its acquire step is uninterruptible and registers the release in the same step, so ownership is never lost in between. When waiting for the lock must be interruptible, the acquire step itself releases a lock it obtains after the interruption.
- Persist pending operations before touching a target. Each write and its record form one `Effect.uninterruptible` region, so interruption lands only between steps, and the lock, released when its Scope closes, outlives every write in flight. The installation as a whole stays interruptible.
- Retry with `Effect.retry` only operations that are explicitly retryable; never a partly executed installation, an ACP prompt or a command whose result is unknown.
- A lease's heartbeat runs in the lease's Scope. A failed renewal interrupts the fenced work, and writes after losing the lease still go through fencing.

## Assemble In The Application

The assembly root lives in each consuming application, not in the kit.

- Plain TS entries: create one platform with `createNodePlatform()` and pass it to the functions.
- Effect entries: the application provides the required services. Harness uses `HarnessLive.pipe(Layer.provideMerge(NodePlatformLive))`, retaining `PlatformService` for both its port adapters and its use cases. ACP's `connectAgent` reads `PlatformService` directly and returns a connection in the caller's Scope; provide a `SessionBindingStore` Layer only when using session keys. A one-shot program (a setup command) runs with `Effect.runPromiseExit`; a server process holds a `ManagedRuntime`; an Effect host composes the Layers directly. See [Adopting agent-kit](../development/adoption.md) for the application boundaries and checks.
- The kit is responsible for its guarantees about locks, heartbeats, cancellation and cleanup. The application is responsible for starting programs and interpreting their results (exit codes, HTTP responses).

## Verify At The Owner

- Test real obligations where they are owned: an aggregate's legal transitions and rejections; a use case's port call order and conflict mapping; a repository's behavior through the conformance suite and its store-specific tests; each agent adapter through its context's conformance tests. Do not add identity tests for re-exports.
- Conformance tests live in the testing package and are exported through `/testing` and, for the Effect-based ones, `/testing/effect`, so third-party adapters and repositories run the same suite.
- Tests that need the real platform (files, child processes, SQLite) run on platform-node: a package lists it under `testsOnly` in `boundaries.ts` and as a devDependency, and its source files still may not import it. They run under a temporary home with an explicit environment.
- The aggregate-repository conformance suite (`/testing/effect`, see [Repository Shape](#repository-shape)) runs generic cases against every implementation of a repository, the reopen case against persistent implementations, and the unknown-schema case where the storage carries a schema version. Cross-process cases and anything the suite cannot express stay in the owner's tests, as integration tests.

| Repository | Cases from `/testing/effect` | Store-specific tests beyond the suite |
| --- | --- | --- |
| LedgerRepository | Revisions strictly increase; a save over a stale revision is refused; an unknown `schemaVersion` is refused and nothing is cleared; the reopen case | With the LedgerLock: two processes modifying at once, only one enters the critical section; after the holder is killed, the next holder probes pending operations before continuing |
| Lease repository | The generic cases (memory, file, SQLite), the reopen and unknown-schema cases (file and SQLite only) | The generation never decreases, including after release and re-creation; ABA is detected; two processes acquiring at once, only one succeeds; a reused pid is not taken as alive; two reclaimers at once, only one succeeds |
| SessionBindingStore (a key-value store, not an aggregate) | — | Read, write, delete; the conflict semantics of two writes for one `sessionKey`; bindings survive reopening |

- A rule that a repository cannot judge belongs to the use case tests of its owner. For example, "invalidate the binding when a cancel does not settle" is an AcpSession rule, tested in acp by simulating an unsettled cancel and asserting that the binding is removed.
### Boundary Rules

[`boundaries.ts`](../../infra/architecture/boundaries.ts) owns package dependencies, sibling and SPI access, layers,
external specifiers, Effect paths and the contexts covered by agent-marker checks. Update it with a new package or
dependency. [`lint.ts`](../../infra/architecture/lint.ts) generates each package's rules through `withBoundaryLint`;
`manifest.test.ts` verifies that every package runs whole-package `vp lint` with the generated configuration intact.

| Check | Authority and evidence |
| --- | --- |
| `layer`, `package-dependency`, `types-only`, `external-dependency`, `deep-import`, `relative-escape`, `public-entry`, `spi-import`, `effect` | Boundary manifest and generated import policies; `lint-cases.ts`, `spi-cases.ts`, `sibling-entry-cases.ts`, `lib-cases.ts` |
| `provider-entry`, `shell-entry` | `lint.ts`; provider cases and shell cases in `lint-cases.ts` |
| `node-builtin`, `dynamic-import`, `source-file`, `parse`, `unresolved` | Built-in Node rule, syntax selectors, parser and resolver; `lint-cases.ts` |
| `undeclared-package`, entry files/exports, workspace dependencies, test-only dependencies, production cycles, forbidden barrels and policies folders | `manifest.test.ts`; unknown source packages also fail lint |
| `agent-marker` | `agent-markers.ts`, `agent-markers.test.ts` and marker cases in `lint-cases.ts` |

Generated diagnostics name the rule in brackets; built-in rules and the parser keep their own diagnostics.
`run-lint-cases.ts` runs allowed and violating cases in a temporary repository copy and checks exact rule ids.
Keep targets resolvable: the boundaries plugin can skip an unresolved dependency as external. The TypeScript
resolver handles source `.js` specifiers and declaration-level type imports. New rules or exemptions need both
allowed and rejected cases; run these cases when upgrading the lint plugins too.

An agent marker is a value naming exactly one agent: its id, alias, home directory or environment variable.
Generic file names, path segments and shared environment names are not markers. Each provider's `facts.ts` exports
`agentMarkers`; `providerFacts` points to it. The extractor parses source text without executing provider code and
rejects unsupported declarations. Marker values have one authority in those facts. The `agent-marker` rule covers
exact literals and slash-separated template pieces in non-test context source, with no source-path exemptions.

Review also checks **agent knowledge without a marker**, such as a conditional on one agent's
`notification_type` field. Move that behavior to its provider or express it through the SPI; a clean lint run
cannot establish that this review item passed. Keep fixtures synthetic and free of private paths or names.

### Compatibility And Size Evidence

For a behavior-preserving refactor, compare fixed inputs through all supported providers and retained use cases.
Compare runtime and declaration exports against the intended public surface, and demonstrate that the parity
check detects an injected defect. For import-only changes, compare normalized AST statements and mapped chunks;
module ordering, chunk hashes and declaration ordering may differ without changing behavior.

Run the full check steps from [CONTRIBUTING](../../CONTRIBUTING.md#required-checks). Provider tests run their service
conformance suites; model rules have behavioral assertions, with a reverted-rule failure demonstrating
coverage. The built-output identity check (`scripts/check-provider-packing.ts` in the shell) runs from
`check:package` after build, not from unit tests. It checks descriptor reference identity in ordinary entries;
isolated hook objects are intentionally separate. `check-dist.ts` checks the slim runtime and declaration graphs.

Compare every size-limit entry in both published packages with the main commit the change starts from, and explain
growth over 1% in the PR. Each budget is the measured size plus 2%, at least 256 B, so small dependency updates pass
without a budget change. When an entry exceeds its budget, or the change shrinks one, run `pnpm size:update` to
reset every budget from the new sizes; do not edit limits by hand. Keep identity facts together even when an
unbundled catalog chunk contains unused facts: assess the tree-shaken entry as well as its chunk. Record CI duration
when changing workspace structure or lint tooling.

## What Not To Build

- No seedwork package, dependency injection container, event bus, inheritance-based base classes or cross-aggregate transactions.
- `Result` in catalog is the only type shared across contexts; collab reaches it through the public `/catalog` entry. Each aggregate declares its own `{ state, events }` type.
