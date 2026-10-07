# Authoring Conventions

Use this guide when adding or changing code in an agent-kit context. It defines where code goes, how aggregates and use cases are shaped, and which rules apply to plain TS contexts and to Effect contexts. [CONTEXT.md](../../CONTEXT.md) defines the terms; [plan 0001](../plans/0001-agent-kit.md) records the design decisions (sections 3.1–3.3, 3.5, 3.7 and 3.9 are the source of these rules). The architecture manifest `infra/architecture/boundaries.ts` and its boundary test enforce the dependency rules below.

## Choose The Owner

Start from the knowledge and the invariants, not from the file you want to write. Each kind of agent knowledge has one owner:

| Context | Package | Kind | Owns |
| --- | --- | --- | --- |
| catalog | `@rivus/agent-kit-catalog` | Shared kernel | Agent identity, home directory rules, `Result` |
| discovery | `@rivus/agent-kit-discovery` | Supporting | What is installed on this machine; probe recipes |
| sessions | `@rivus/agent-kit-sessions` | Core | What an agent stores and how to read it: layout, preview, event translation, usage decoding |
| cost | `@rivus/agent-kit-cost` | Supporting | Pricing formulas and summaries over injected price tables |
| harness | `@rivus/agent-kit-harness` | Core | What can be extended and how to install it: strategies, hook dialects, plans, the ledger |
| acp | `@rivus/agent-kit-acp` | Supporting | How to drive an agent over ACP: profiles, sessions, bindings |
| lease, lanes | `@rivus/agent-kit-collab` | Generic | Mutual exclusion and scheduling between agents |
| redact | `@rivus/agent-kit-redact` | Utility module | Pure redaction functions; no domain model |

Packages are created in the phase that gives them content; see the plan's section 6.3.

- Knowledge used by only one context belongs to that context: hook dialects to harness, ACP launch details to acp, log layouts to sessions, probe methods to discovery. catalog stays small because every context must coordinate when it changes.
- Code that changes because of the same upstream change belongs together. When Gemini renames its hook events, the installer and the hook parser change together, so both live in harness and share one HookDialect.
- A package is not a new bounded context, and a pure re-export is not a second owner. The shell packages own nothing; Platform is a technical port, not a context.
- A revision counter, a JSON file, a state machine or a validator does not by itself establish an owner. Find the context whose invariants the code protects.
- An abstraction needs at least two real consumers. Code with a single consumer stays in that application until a second consumer appears.
- Adding an agent: add its identity in `catalog/src/agents/`, add the agent's pure translation in the `agents/` of each context that supports it, and register the adapter in that context's builtin table (in sessions: `application/session-adapters/index.ts`, because an adapter that reads files needs Platform, which `agents/` may not import). Each context's conformance tests check the new adapter. There is no composite per-agent object, because catalog would then depend on every context.

## Lay Out A Context Package

Every context package uses the same layout, creating only the directories it needs:

```text
<context>/src/
  domain/<concept>/
    aggregate/  value-objects/  policies/  factories/  errors/  events/  services/
    index.ts            the concept's facade inside the package
  agents/<agent>/       agent adapters (anti-corruption layer)
  agents/index.ts       exports the pure per-agent rules; a builtinXxx table of pure adapters may live here
  application/          use cases + ports.ts
  adapters/             implementations of this context's ports
  public.ts             the public surface, re-exported by the shell package
  index.ts              the surface for sibling packages
```

| Layer | Contents | May import |
| --- | --- | --- |
| `domain/` | Value objects, aggregates, policies (rules), factories, errors, domain events, stateless domain services | Its own domain, catalog, and `import type` from upstream packages declared as dependencies (for example cost's domain imports the UsageRecord type from sessions). No IO, no Platform, no external packages |
| `agents/` | Translation of one agent's external format into this context's model: a log line into TranscriptEvents, a hook payload into a LifecycleEvent | This context's domain only. Pure functions, no IO |
| `application/` | Use cases that carry agent knowledge and coordinate ports; `ports.ts` declares the part of Platform and the context's own ports that they use | Domain, agents and ports |
| `adapters/` | Implementations of ports the kit declares: format-preserving configuration editors, ledger store, SQLite index, lease store | Reaches the outside only through Platform; never `node:*` |

- Only `@rivus/agent-kit-platform-node` may import `node:*`.
- Cross-package imports go through the target package's `index.ts`, never into its `domain/`, `agents/` or `adapters/`. Dependencies are declared in `package.json`; Rush rejects phantom dependencies.
- Package dependencies run one way: discovery, sessions and harness depend on catalog and platform; acp also depends on sessions; cost depends on sessions for types only; platform-node depends on platform; collab uses agent-kit only through its public subpaths.
- Contexts that are pure computation (catalog, cost, agent translation, hook event parsing) have no `application/` and export domain functions directly.
- `agents/` and `adapters/` are different things. An agent adapter translates a format we do not control into our model. A port adapter implements an interface we declared. A port implementation never goes under `agents/`, and a format translation never goes under `adapters/`.

## Aggregate Or Value Object

Use the lifecycle as the criterion. A concept is an aggregate when it keeps one identity across state changes and invariants must hold across those changes: transitions can be legal or illegal depending on the current state. A concept that is created once and then only read, compared or recomputed is a value object, however large it is.

| Aggregate | Lifecycle that makes it one |
| --- | --- |
| InstallPlan (harness) | Its content is immutable, but it has an identity and a lifecycle: built against one ledger revision, then applied once or discarded, and refused once the ledger has moved on |
| Ledger (harness) | Revisions strictly increase; every entry has an owner; modifications happen only under the LedgerLock; an unknown version is never cleared |
| AcpSession (acp) | A state machine (starting, ready, turn in progress or awaiting permission, cancelling, closed) with one turn at a time and nothing allowed after close |
| Lease (collab) | One holder at a time; the generation never decreases, including across release and takeover |
| Lane (collab) | An in-memory state machine (idle, running, pending) with at most one activation per key |

Read-only contexts have no aggregates. sessions, discovery, cost and catalog only project data that agents wrote; their models are value objects, policies and domain services such as `foldTranscript`. Do not invent an aggregate to make a read-only context look like the others.

## Aggregate Shape

- An aggregate is a frozen class with a private constructor. The only ways to obtain one are `create` (new identity from validated input) and `restore` (a validated snapshot entering the model). Files under `factories/` prepare their input, for example `buildInstallPlan` turns a Bundle, a Ledger snapshot and the observed files into a plan.
- A transition is a method that returns `{ state, events }`: the next frozen instance and the domain events it produced. The previous instance does not change. The transition type is one line declared next to its aggregate; there is no shared base type.
- A transition that the invariants reject returns a `_tag` error as a `Result` value; only a defect throws.
- Validators and transition helpers inside the domain support the aggregate and do not become a second way to change its state.
- An aggregate never receives a repository, a port or a Platform. Use cases load it, call a transition and save the result.

```ts
// Illustrative shape; real aggregates arrive with harness, acp and collab.
type AcpSessionTransition = { readonly state: AcpSession; readonly events: readonly AcpSessionEvent[] }

export class AcpSession {
  static create(input: CreateAcpSessionInput): Result<AcpSession, AcpSessionError>
  static restore(snapshot: AcpSessionSnapshot): Result<AcpSession, AcpSessionError>

  private constructor(private readonly snapshot: AcpSessionSnapshot) {
    Object.freeze(this)
  }

  startTurn(turn: TurnInput): Result<AcpSessionTransition, TurnInProgress | SessionClosed>
  toSnapshot(): AcpSessionSnapshot
}
```

## Coordinate Through Application Ports

- A use case loads an aggregate or reads data through ports, applies domain rules, saves the result, and coordinates external work through ports. It never constructs a concrete adapter.
- Each use case declares only the ports it uses. In a plain TS context the platform part is the first parameter, typed as a `Pick`, for example `listSessions(deps: Pick<Platform, 'fs' | 'env' | 'home'>, opts)`. In an Effect context the use case takes its ports from `Context.Service` (see [Effect Rules](#effect-rules)).
- The application layer holds no policy: trigger timing, fail-open behavior, retries, which agents to count and where to store results belong to the consuming application.
- Use cases default to the context's `builtinXxx` adapter table and accept an `adapters` option that overrides or extends it for one call. There is no global registry. Reading data for an agent that has no adapter in the table is an expected outcome and returns a `CapabilityUnsupported` value; naming such an agent in a call's own options (for example `listSessions({ agents })`) is a programming error and throws `AgentKitError` with code `capability-unsupported`.
- Do not add an export, a deep import or a facade to make a caller compile. Derive option and result types from the retained signatures (`Parameters`, `ReturnType`) instead.

## Make Persistence And Partial Failure Explicit

- Write a store's preconditions into its calling convention. Promise CAS only when the store can check atomically (the SQLite lease store compares inside a transaction) or when every writer goes through the same lock (the file lease store's guard, the LedgerLock).
- Shared configuration files that agents and other tools also write are not under a common lock. Do not promise CAS for them: re-checking a precondition before `rename` narrows the window but does not close it, and an overwritten external change cannot be detected afterwards. Prefer the agent's command line or native plugin for files the agent is using.
- Every ledger modification happens within one lock holding period: read the ledger, write pending, change the target files, write the ledger, clear pending. The lock is held until the last step.
- Multi-step writes are not transactions. Failures stay visible to the caller; pending operations are written before acting and probed (not replayed blindly) at the next lock acquisition; pre-images allow restoring what was there.
- A stored file with an unknown `schemaVersion` is refused or kept whole, never cleared.
- Locks and stores support local directories only; fcntl locks are unreliable on NFS.

## Expose A Small Public Surface

- Stateless operations are functions over plain data. Stateful parts are created by factory functions. The only public class is `AgentKitError` (`code` + `cause`), recognized through a `Symbol.for` brand.
- Aggregates are exposed as handle interfaces plus read-only snapshot types, obtained only through use cases. Their classes never appear in `public.ts`.
- `public.ts` lists every exported name. The shell package's entry files re-export those names one by one, with no `export *`, so every change to the public surface shows up in review. `index.ts` serves sibling packages and may export more than `public.ts`.
- Adapter interfaces carry a version literal (`specificationVersion: 'sessions-v1'`, `'harness-v1'`), so a later version can coexist with the current one.
- Versioning: correcting an agent fact is a patch; a new agent, event type or capability is a minor; dropping a Node LTS is a major. Unstable APIs go under `/experimental/*`.

## Plain TS Rules

These rules apply to every domain layer and to the contexts that do not use Effect: catalog, discovery, sessions and transcript, `/transcript/usage`, cost, redact, `/harness/events` and the process lock.

- Async shapes: a single result is a `Promise`; sessions, events and usage are `AsyncIterable`, and leaving the loop cancels the work; every IO function accepts `{ signal?: AbortSignal }`; functions on the hook path are synchronous and do no IO.
- Errors: expected outcomes are `Result` values whose `error` carries a `_tag`; only defects throw. A line that cannot be parsed is recorded as skipped; only an unrecognized format generation is an error.
- Dependencies: the platform, or the part of it the function uses, is the first parameter. There is no kit object bound to a platform.
- Validation of external data uses `zod/mini`; it is the only validation library. The exception is `/harness/events`, which must stay synchronous with zero dependencies, reads only a few fields with `typeof` checks, and says so in a comment.
- Prefer existing libraries and built-ins over hand-written equivalents: `es-toolkit` instead of lodash-es; `Object.groupBy`, `toSorted`, `structuredClone`, `crypto.randomUUID()`, `AbortSignal.timeout` and `AbortSignal.any` where they suffice.
- A plain TS context must not import `effect`, and its module graph and published `.d.ts` graph must not reach it. The boundary test checks this.
- A plain context moves its reading layer to Effect only when it gains live following, file watching, background index refresh or concurrent scanning with backpressure. Its translation functions stay plain.

## Effect Rules

These rules apply to the use cases and port adapters of harness execution (apply, verify, uninstall, the LedgerLock), acp, collab's lease and lanes.

- Only `application/` and `adapters/` of these contexts may import `effect`. Their `domain/` and `agents/` stay plain TS, like every other domain layer.
- Ports are `Context.Service`s keyed `@rivus/agent-kit/<context>/<port>/v1` (for example LedgerStore, LedgerLock, AcpTransport, SessionBindingStore, LeaseStore); the version changes only for an incompatible interface. Implementations are Layers. Platform stays a plain TS interface, provided by a Layer such as `PlatformLive` built from `createNodePlatform()`; do not turn each Platform method into its own service.
- Entries return `Effect`, `Stream` or `Layer`. Cancellation is fiber interruption, and long-lived resources (ACP connections, lease managers, lanes) belong to a Scope the caller provides.
- Errors use the same `_tag` unions as the plain TS side, in the typed error channel. A `Result` from a plain function is unwrapped first with `fromResult` (`r.ok ? Effect.succeed(r.value) : Effect.fail(r.error)`); `catchTag` does not see an `{ ok: false }` value that was never failed.
- There is no Promise facade. Consumers run Effects at their assembly root.
- Compose Layers with `Layer.provide` or `Layer.provideMerge`. `Layer.mergeAll` only merges outputs; it does not feed one Layer's output into another Layer of the same group.
- Use Scope and supervision for real. Wrapping an async function in `tryPromise` and moving its parameters into a service is not enough: a `tryPromise` around a write that cannot be cancelled lets a timeout release the lock before the write finishes.
- Child processes go through `Platform.spawn`, not `effect/process`.
- `effect` is an optional peer of the published packages, pinned to an exact version, and a devDependency; it stays external and is never bundled.

Execution rules for locks, writes and retries:

- Ownership must not be lost between acquiring a lock and registering its finalizer. A lock acquired after its waiter was cancelled is released immediately.
- Persist pending operations first. Cancellation takes effect only at recoverable step boundaries.
- Do not release a lock before an in-flight write and its record are finished. A non-cancellable write wrapped in `tryPromise` goes in an uninterruptible region, but a whole installation is never made uninterruptible.
- Do not retry partially executed installations, ACP prompts or commands with unknown results automatically. Use `Effect.retry` only for operations that are explicitly retryable.
- A failed lease renewal is supervised and interrupts the fenced work. Writes after losing a lease still go through fencing.

## Assemble In The Application

The assembly root lives in each consuming application, not in the kit.

- Plain TS entries: create one platform with `createNodePlatform()` and pass it to the functions.
- Effect entries: the application provides a Layer, such as `Layer.mergeAll(HarnessLive, AcpLive).pipe(Layer.provide(NodePlatformLive))`. A one-shot program (a setup command) runs it with `Effect.runPromiseExit`; a server process holds a `ManagedRuntime`; an Effect host composes the Layers directly.
- The kit is responsible for its guarantees about locks, heartbeats, cancellation and cleanup. The application is responsible for starting programs and interpreting their results (exit codes, HTTP responses).

## Verify At The Owner

- Test real obligations where they are owned: an aggregate's legal transitions and rejections; a use case's port call order and conflict mapping; a store's behavior through the storage conformance tests; each agent adapter through its context's conformance tests. Do not add identity tests for re-exports.
- Conformance tests live in the testing package and are exported through `/testing`, so third-party adapters and stores run the same suite.
- Storage conformance tests have two groups. Generic cases run against every implementation (memory, file, SQLite). Persistence and cross-process cases run only against persistent implementations, with their locks, as integration tests.

| Store | Generic cases | Persistence and cross-process cases |
| --- | --- | --- |
| Ledger store | Revisions strictly increase; a write with a mismatched revision is refused; an unknown `schemaVersion` is refused and nothing is cleared | With the LedgerLock: two processes modifying at once, only one enters the critical section; after the holder is killed, the next holder probes pending operations before continuing; data read after reopening equals data written |
| LeaseStore | A revision conflict is refused; the generation never decreases, including after release and re-creation; ABA is detected | Two processes acquiring at once, only one succeeds; a reused pid is not taken as alive; two reclaimers at once, only one succeeds |
| SessionBindingStore | Read, write, delete; the conflict semantics of two writes for one `sessionKey` | Bindings survive reopening |

- A rule that a store cannot judge belongs to the use case tests of its owner. For example, "invalidate the binding when a cancel does not settle" is an AcpSession rule, tested in acp by simulating an unsettled cancel and asserting that the binding is removed.
- When ownership or dependencies change, update `infra/architecture/boundaries.ts` and run the boundary test. The test has positive and negative cases: a legal import (such as cost's domain importing a type from sessions) must pass, and a violating one (`node:*` in a domain file, `effect` in a plain context, a deep import into another package's `domain/`) must fail.

## What Not To Build

- No seedwork package, dependency injection container, event bus, inheritance-based base classes or cross-aggregate transactions.
- `Result` in catalog is the only type shared across contexts; collab reaches it through the public `/catalog` entry. Each aggregate declares its own `{ state, events }` type.
