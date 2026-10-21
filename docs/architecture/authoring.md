# Authoring Conventions

Use this guide when adding or changing code in an agent-kit context. It defines where code goes, how aggregates and use cases are shaped, and which rules apply to plain TS contexts and to Effect contexts. [CONTEXT.md](../../CONTEXT.md) defines the terms; [plan 0001](../plans/0001-agent-kit.md) records the design decisions (sections 3.1–3.3, 3.5, 3.7 and 3.9 are the source of these rules). The architecture manifest `infra/architecture/boundaries.ts` and the boundary rules generated from it enforce the dependency rules below (see [Verify At The Owner](#verify-at-the-owner)).

## Choose The Owner

Start from the knowledge and the invariants, not from the file you want to write. Each kind of agent knowledge has one owner:

| Context | Package | Kind | Owns |
| --- | --- | --- | --- |
| catalog | `@rivus/agent-kit-catalog` | Shared kernel | Identity and home-rule models, `Result`, service tables and lookups |
| discovery | `@rivus/agent-kit-discovery` | Supporting | Installation detection and probe recipe interfaces |
| sessions | `@rivus/agent-kit-sessions` | Core | Session, transcript and usage models; reading and decoding use cases |
| cost | `@rivus/agent-kit-cost` | Supporting | Pricing formulas and summaries over injected price tables |
| harness | `@rivus/agent-kit-harness` | Core | Extension strategies, hook and install interfaces, plans and the ledger |
| acp | `@rivus/agent-kit-acp` | Supporting | ACP profile interfaces, sessions and bindings |
| lease, lanes | `@rivus/agent-kit-collab` | Generic | Mutual exclusion and scheduling between agents |
| redact | `@rivus/agent-kit-redact` | Utility module | Pure redaction functions; no domain model |

Packages are created in the phase that gives them content; see the plan's section 6.3.

Providers own their agent's identity, probe recipes, hook dialects, install adapters, log layouts and decoding,
and ACP launch details. Pi and Cursor live in `packages/providers/pi` and `packages/providers/cursor`; other agents remain in context adapter
folders until their batches in 7–11 of [plan 0002](../plans/0002-providers-and-workspace.md#32-provider-packages).
Providers implement context SPI interfaces; contexts own the service models, shared helpers and use cases.
The shell assembles the built-in service tables from both locations during migration.

- Agent-specific code belongs to its provider; shared format rules and helpers belong to the context that uses them. catalog stays small because every context must coordinate when it changes.
- Code that changes because of the same upstream change belongs together. An agent's installer and hook parser share its HookDialect in the provider.
- A package is not a new bounded context, and a pure re-export is not a second owner. The shell packages own nothing; Platform is a technical port, not a context.
- A revision counter, a JSON file, a state machine or a validator does not by itself establish an owner. Find the context whose invariants the code protects.
- An abstraction needs at least two real consumers. Code with a single consumer stays in that application until a second consumer appears.
- Adding an agent: create its provider package with one subpath per supported service, declare its SPI dependencies and services in `boundaries.ts`, and register it in the shell's service tables. Run the services' conformance suites from testing. Plan 0002 lists the sync points while context tables are being migrated.

## Lay Out A Context Package

Every context package uses the same layout, creating only the directories it needs:

```text
<context>/src/
  domain/<concept>/
    aggregates/  entities/  value-objects/  policies/  factories/  errors/  events/  services/
    adapters/           agent adapters (anti-corruption layer) for this concept's model; a
                        builtinXxx table of pure adapters may live here
    spi/                pure provider interfaces and their parts
    index.ts            the concept's facade inside the package
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
  public.ts             the public surface, re-exported by the shell package
  spi.ts                provider interfaces and the context helpers their implementations need
  index.ts              the surface for sibling packages
```

One agent's code is split by concept, not grouped by agent: each file lives in the `adapters/` of the concept whose
model it produces — in sessions, a log line's translation in `transcript`, the directory layout and preview in
`session`, the usage decoding in `usage`. A concept's `builtinXxx` table lives in that concept's `adapters/` when its
entries are pure (harness's `install-adapters.ts` and `hook-dialects.ts`); a table whose entries need Platform lives
in `application/services/` (sessions' `builtinSessionAdapters` and `builtinUsageDecoders`), because `adapters/` may
not import Platform. A wire format shared across agents at one protocol boundary, such as sessions' translation of
ACP `session/update` streams, is an adapter too and lives in the adapters of the concept whose model it reads and
writes; counted as adapters, it may import other adapters, which the removed `domain/protocols/` layer forbade.

The layer principles:

- `domain/` is pure: no IO, it never sees Platform, and it does not import `effect`. A concept folder may not import any `adapters/` folder, its own or another concept's. The adapters folders are the only domain folders that may use external packages, such as `zod` for payload validation.
- `application/` holds `use-cases/` (the public use cases), `services/` (coordination code shared by use cases; it may call ports but owns no business rules) and `ports.ts` (port shapes and injection tags).
- `infra/` implements the ports and reaches the outside only through Platform. `@rivus/agent-kit-platform-node` is the only package that may import `node:*`.

| Layer | Contents | May import |
| --- | --- | --- |
| `domain/` | Value objects, aggregates, their child entities, policies (rules), factories, errors, domain events, stateless domain services | Any concept folder of this context, but no `adapters/` folder — its own or another concept's — plus catalog, and `import type` from upstream packages declared as dependencies (for example cost's domain imports the UsageRecord type from sessions). No IO, no Platform, no external packages, no effect |
| `domain/<concept>/adapters/` | Translation of one agent's external format into the model of the concept whose `adapters/` holds the file: a log line into TranscriptEvents, a hook payload into a LifecycleEvent. Pure functions, no IO | Any concept folder, also of other concepts, other concepts' `adapters/` folders, catalog, and the external packages the package allows, such as `zod/mini` |
| `application/` | `use-cases/` carry agent knowledge and coordinate ports; `services/` is code shared by use cases; `ports.ts` declares infrastructure ports; Platform slices named by provider interfaces live in `spi.ts`, and use-case-only slices in `platform.ts` | Domain, the `adapters/` folders and ports |
| `infra/` | Implementations of ports the kit declares: persistence implementations under `repository/` (aggregate repositories and key-value stores such as acp's session bindings), stored formats (`models/`), format-preserving configuration editors and other port implementations (`adapters/`), Layer compositions (`factories/`) | Domain and application; reaches the outside only through Platform; never `node:*` |

`@rivus/agent-kit-collab` is a published package that keeps its own code, so it nests this layout under each public entry: `src/lease/domain/lease/`, `src/lease/application/`, `src/lease/infra/`, `src/process-lock/application/`, each entry's file being `src/<entry>/public.ts` (`entries` in `boundaries.ts`). The layer rules apply across the entry folders as within one context: the plain process lock judges holders with lease's domain rules, and lease's infra uses the process lock for its fences. collab reaches agent-kit only through the public entries listed under `publicImports` (`/catalog`, `/platform`, `/platform/effect`), which the boundary rules treat as the shared kernel, the Platform port and its Effect entry; agent-kit is a peer, so a process holds one copy of each.

- Only `@rivus/agent-kit-platform-node` may import `node:*`.
- Cross-package imports go through the target package's `index.ts`, or its `spi.ts` when the importer's `spiImports` explicitly lists that dependency; never into its `domain/` (including the `adapters/` folders) or `infra/`. Dependencies are declared in `package.json`; pnpm's isolated `node_modules` gives a package only what it declares, so an undeclared import does not resolve. A package whose tests need a workspace package that its sources may not use, such as acp's tests starting a fake agent through platform-node, declares it as a devDependency and lists it under `testsOnly` in the manifest.
- Package dependencies run one way: discovery, sessions and harness depend on catalog and platform; acp also depends on sessions; cost depends on sessions for types only; platform-node depends on platform; collab uses agent-kit only through its public subpaths.
- Contexts that are pure computation (catalog, cost, agent translation, hook event parsing) have no `application/` and export domain functions directly.
- A concept's `adapters/` folder and `infra/` are different things. An agent adapter translates a format we do not control into our model. A port adapter implements an interface we declared. A port implementation never goes under a concept's `adapters/`, and a format translation never goes under `infra/`.
- A use case is an operation the package exports for applications: `listSessions`, `planInstall`, `acquireProcessLock`. Its file lives in `application/use-cases/`. Code the use cases share — building a ledger scope, decoding one file's records, walking session directories — lives in `application/services/`; it may call ports but owns no business rules. `errors.ts` and `ports.ts` stay at the `application/` root.

## Aggregate Or Value Object

Use the lifecycle as the criterion. A concept is an aggregate when it keeps one identity across state changes and invariants must hold across those changes: transitions can be legal or illegal depending on the current state. A concept that is created once and then only read, compared or recomputed is a value object, however large it is.

| Aggregate | Lifecycle that makes it one |
| --- | --- |
| InstallPlan (harness) | Its content is immutable, but it has an identity and a lifecycle: built against one ledger revision, then applied once or discarded, and refused once the ledger has moved on |
| Ledger (harness) | Revisions strictly increase; every entry has an owner; modifications happen only under the LedgerLock; an unknown version is never cleared |
| AcpSession (acp) | A state machine (starting, ready, turn in progress or awaiting permission, cancelling, closed) with one turn at a time and nothing allowed after close |
| Lease (collab) | One holder at a time; the generation never decreases, including across release and takeover |
| Lane (collab) | An in-memory state machine (idle, queued, running, with a pending activation while queued or woken again while running) with at most one activation per key |

Read-only contexts have no aggregates. sessions, discovery, cost and catalog only project data that agents wrote; their models are value objects, policies and domain services such as `foldTranscript`. Do not invent an aggregate to make a read-only context look like the others.

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

An entity is a child of one aggregate: it has a local identity inside that aggregate, but no identity outside it. It is a read-only record in the root's snapshot, it is read only through the root's methods, and it is created and changed only by the root's transitions. It has no store and no lock of its own. An entity with its own lifecycle and its own store is an aggregate; promote it rather than giving it a repository. Harness's Ledger keeps its entries, pending operations and kept artifacts as entities under `domain/ledger/entities/`: the Ledger owns their invariants, and a save writes them as part of the Ledger.

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
`SessionBindingStore` (acp) stores value objects, not an aggregate: it stays a key-value store with its current
names, and its documentation says so. `LedgerLock` is unchanged by these rules: mutual exclusion is its own port
beside the repository.

The generic conformance cases for this shape (`load` of a missing id, the first `save`, a stale revision refused
with `RevisionConflict` and nothing changed, strictly increasing revisions, an unknown `schemaVersion` refused and
kept, and reopening for persistent implementations) live in the testing package's Effect entry
(`/testing/effect`), so an implementation — built-in or third-party — runs them from its fixtures.

## Coordinate Through Application Ports

- A use case loads an aggregate or reads data through ports, applies domain rules, saves the result, and coordinates external work through ports. It never constructs a concrete adapter.
- Each use case declares only the ports it uses. In a plain TS context the platform part is the first parameter, typed as a `Pick`, for example `listSessions(deps: Pick<Platform, 'fs' | 'env' | 'home'>, opts)`. In an Effect context the use case takes its ports from `Context.Service` (see [Effect Rules](#effect-rules)).
- The application layer holds no policy: trigger timing, fail-open behavior, retries, which agents to count and where to store results belong to the consuming application.
- Context use cases require a `providers` object containing exactly the service tables they read, plus identity when resolving aliases or homes. Shell bindings accept `providers?: readonly Provider[]` and merge each service independently over built-ins by id. There is no global registry. Reading data for an agent that has no adapter in the table is an expected outcome and returns a `CapabilityUnsupported` value; naming such an agent in a call's own options (for example `listSessions({ agents })`) is a programming error and throws `AgentKitError` with code `capability-unsupported`.
- Catalog's `lookupService(agent, table)` returns `Result<T, CapabilityUnsupported>` for data; `requireService(agent, table, reason?)` throws the named-agent error. Only own, non-null table entries provide a service. Identity queries take the table explicitly: `parseCodingAgentId(input, identities)` resolves aliases, and `homeRuleOf(agent, identities, own?)` gives an own rule precedence. `homeFromRule` resolves that rule against supplied home and environment values. The shell validates merged identities: keys must match ids, and names may not belong to distinct identities. A service supplied by a descriptor must use that descriptor's id.
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

- Stateless operations are functions over plain data. Stateful parts are created by factory functions. The only public class is `AgentKitError` (`code` + `cause`), recognized through a `Symbol.for` brand.
- Aggregates are exposed as handle interfaces plus read-only snapshot types, obtained only through use cases. Their classes never appear in `public.ts`.
- `spi.ts` lists the provider interfaces and shared helpers used by adapters. Pure interfaces live in `domain/<concept>/spi/`; file-reading interfaces live in `application/spi.ts`. Shared helpers stay internal; SPI interface types are public through their service's shell entry. `spi: true` declares the entry in the boundary manifest; `spiImports` grants SPI access independently of `dependsOn` index access, subject to the existing layer and type-only rules. No current context imports a sibling SPI.
- `public.ts` lists every exported name. The shell re-exports unchanged names one by one and binds routed functions to the per-service modules under `src/providers/`. Each entry imports only the services it binds; `/harness/events` reads only the hooks table. `builtinProviders` is assembled separately for consumers that need all services. Local shell imports are declared in `boundaries.shellImports`; `export *` stays forbidden. `index.ts` serves sibling packages and may export more than `public.ts`.
- An entry whose runtime profile differs from the rest of its context, such as the hook path `/harness/events`, gets its own file next to `public.ts` (harness's `src/events.ts`), exported as `<package>/public/<name>`. It imports only the layers that path needs, so its module graph does not depend on tree-shaking, and the shell entry imports its context function from that entry to bind the needed service tables.
- Adapter interfaces carry a version literal (`specificationVersion: 'sessions-v1'`, `'harness-v1'`), so a later version can coexist with the current one.
- Versioning: correcting an agent fact is a patch; a new agent, event type or capability is a minor; dropping a Node LTS is a major. Unstable APIs go under `/experimental/*`.

## Plain TS Rules

These rules apply to every domain layer and to the contexts that do not use Effect: catalog, discovery, sessions and transcript, `/transcript/usage`, cost, redact, `/harness/events` and the process lock.

- Async shapes: a single result is a `Promise`; sessions, events and usage are `AsyncIterable`, and leaving the loop cancels the work; every IO function accepts `{ signal?: AbortSignal }`; functions on the hook path are synchronous and do no IO.
- Errors: expected outcomes are `Result` values whose `error` carries a `_tag`; only defects throw. A line that cannot be parsed is recorded as skipped; only an unrecognized format generation is an error.
- Dependencies: the platform, or the part of it the function uses, is the first parameter. There is no kit object bound to a platform.
- Validation of external data uses `zod/mini`; it is the only validation library. `vp pack` bundles `zod/mini` into the zero-dependency entries (`/transcript/usage`, `/harness/events`, `/cost`), whose built files import nothing, so a host that cannot install dependencies loads them on their own. It also bundles `zod/mini` into the code `/node`, `/node/effect` and `@rivus/agent-kit-collab/process-lock` load, so loading those entries does not load the zod package. Every other entry imports `zod/mini`, and zod stays a dependency of both published packages. The hook path stays synchronous and parses its payloads through schemas too.
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
- When ownership or dependencies change, update `infra/architecture/boundaries.ts`; the boundary rules are generated from it. `infra/architecture/lint.ts` turns it into `vp lint` rules, which every package's `vite.config.ts` applies through `withBoundaryLint`: eslint-plugin-boundaries for imports between packages and layers, Effect and npm specifiers; oxlint's `import/no-nodejs-modules` for Node built-ins; `no-restricted-syntax` for computed `import()`, shell entries, non-`.ts` sources and agent markers. Generated diagnostics carry their rule id in brackets, such as `[layer]`; the built-in Node rule and parser keep their own diagnostics. `manifest.test.ts` checks what has no source file to lint: every package under `packages/` is declared, its `workspace:` dependencies are allowed, its entry files exist, its lint script runs whole-package `vp lint`, and its `vite.config.ts` applies the rules. Lint scripts may add `2>&1` and the existing `&& effect-tsgo diagnostics --project … --strict` commands. The manifest test requires the generated overrides last and in order, accepts only `dist/**` in top-level `ignorePatterns`, and requires the top-level `boundaries/` and `import/` settings to match the generator exactly, including their keys. The generated source override explicitly enables the `import` plugin even when the top-level plugin list omits it. `run-lint-cases.ts`, part of `pnpm run test`, lints the cases of `lint-cases.ts` in a temporary copy of the repository: a legal import (such as cost's domain importing a type from sessions) must report nothing, and a violating one (`node:*` in a domain file, `effect` in a plain context, a deep import into another package's `domain/`) must report its rule. A new rule or exemption comes with its cases.
- Agent knowledge stays in the agent adapters. Outside `domain/*/adapters/` and the files listed under `agentMarkers` in `boundaries.ts`, the non-test source of catalog, discovery, sessions, harness, acp and cost may not spell an agent marker (an agent id, a home directory such as `.claude`, an environment variable such as `CLAUDE_CONFIG_DIR`) as a whole string literal or literal type, or as a `/`-separated piece of a template literal's static text. The lint cannot see agent knowledge without a marker, such as branching on Claude's `notification_type` field; review checks for it.

## What Not To Build

- No seedwork package, dependency injection container, event bus, inheritance-based base classes or cross-aggregate transactions.
- `Result` in catalog is the only type shared across contexts; collab reaches it through the public `/catalog` entry. Each aggregate declares its own `{ state, events }` type.
