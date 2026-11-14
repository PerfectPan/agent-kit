# Effect Bindings Over A Plain Async Core — Exploration

An evaluation of the question in
[#277](https://github.com/PerfectPan/agent-kit/issues/277): can agent-kit's Effect APIs become optional bindings
over a framework-independent asynchronous core, in the pattern of
[`@tanstack/ai-effect`](https://github.com/TanStack/ai/tree/main/packages/ai-effect)? This document records the
explored design space; it approves no architecture, package split or migration.

## Current state, verified

- The plain entries — `/sessions`, `/transcript`, `/transcript/usage`, `/discovery`, `/platform`, `/redact`,
  `/cost` — run without loading Effect. `check-dist.ts` prohibits Effect in the JavaScript and declarations
  reachable from them, so the boundary is enforced, not conventional.
- `/acp` is Effect-first at every layer of its public surface:
  `connectAgent` returns `Effect.Effect<AcpConnection, ConnectError, PlatformService | Scope.Scope>`; the
  connection's per-session handle exposes `snapshot: Effect<AcpSessionSnapshot>`,
  `prompt(blocks): Stream.Stream<TranscriptStreamPart, PromptError>`, `cancel(): Effect<void, CancelUnsettled |
  SessionClosed>` and `close(): Effect<void>`. A consumer without Effect cannot call them.
- `/harness` and collab's `/lease` and `/lanes` are Effect-first for the same reason: they own resources (processes,
  scopes, locks) whose lifetimes the Effect runtime tracks. The architecture boundaries already keep the domain
  logic free of Effect; Effect appears where orchestration and resource ownership live.

## What the TanStack pattern provides, and where agent-kit is harder

TanStack's `ai-effect` is a one-way dependency: the plain core speaks Promise and AsyncIterable, and the binding
calls it, lifting results into Effect and propagating cancellation and context. Nothing in the core knows Effect
exists.

agent-kit has more to lift than a request/response call:

- **Resource ownership.** ACP ties a child process, its sessions and their bindings to the caller's `Scope`; closing
  the Scope closes every session and stops the process. A plain core needs an explicit owner for that lifetime —
  typically a disposable handle (`Symbol.asyncDispose`) or a documented `close()` contract with finalizer
  semantics — because nothing in plain JavaScript closes a leaked process for the caller.
- **Interruption as cancellation.** `prompt`'s Stream cancels the turn when the consumer interrupts it. The plain
  equivalent is an `AbortSignal` per prompt: the binding lifts `signal.abort` into `Effect.interrupt` (or the core
  grows the signal natively and the binding subscribes). The semantics documented on the handle — a second prompt
  fails with `TurnInProgress`, an unsettled cancel removes the binding and fails with `CancelUnsettled`, `close()`
  runs to the end even when the caller is interrupted — must survive the translation verbatim.
- **Buffered background updates.** `prompt` opens with the updates that arrived while no turn ran. An
  AsyncIterable lifted from an internal queue keeps this; an implementation that re-derives the stream per call
  would not.
- **Typed failures.** The Effect channel is `PromptError | CancelUnsettled | SessionClosed | ConnectError | …`. A
  plain core picks one: rejected `Error` subclasses with `_tag`-style names, or discriminated-union result objects.
  TanStack rejects with typed error classes; the binding then maps each class back into the Effect channel. The
  classes must remain exhaustive against the Effect errors, or a new error kind added to the core silently degrades
  to a defect for binding consumers.
- **Services and context.** `PlatformService` and the optional `SessionBindingStore` arrive through Effect layers
  today. A plain core takes them as plain arguments on an options object; the binding's `Layer` constructs them and
  hands them down. Consumer-supplied services written against Effect interfaces (the store is one) need plain
  interfaces of their own in the core.

## The two shapes, stated distinctly

1. **Plain core, Effect binding** (what the issue asks evaluated): `/acp`'s internals re-express their use cases on
   Promise/AsyncIterable/AbortSignal; `agent-kit-acp/effect` (or a sibling package) re-exports the Effect API by
   lifting the core, and `/acp` keeps its current signature for existing consumers. Effect becomes genuinely
   optional for ACP. Cost: the largest, riskiest piece is re-owning the process lifetime without `Scope` and
   keeping permission callbacks, timeout budgets and the unsettled-cancel semantics bit-identical across two
   surfaces. Two API surfaces can drift; the mitigation is conformance tests that run the same scenario fixtures
   through both and assert identical event and error sequences.
2. **Effect core, plain facade**: a Promise/AsyncIterable wrapper over the existing runtime. It reduces API-learning
   cost for consumers who never touch Effect, but Effect still loads and still owns the process — the runtime
   dependency stays. That is a smaller, honest improvement, and it is not the outcome the issue asks for; naming it
   here only to keep the two outcomes apart.

The candidate first slice — `connect → prompt → cancel → close` for ACP only — fits shape 1: it is the one surface
whose lifecycle is fully documented on the handle, and the sessions/transcript entries show the plain
AsyncIterable-shaped output already exists (`TranscriptStreamPart`). Harness and collab wait: leases and lanes carry
fiber-scoped locks whose plain equivalents (mutual exclusion without fibers) need their own design, and nothing in
this exploration suggests forcing them.

## Decision points before any implementation

- The plain error contract (classes versus discriminated unions) — it sets the binding's mapping table and the
  consumer's catch story.
- Where the process owner lives in the plain API: explicit `dispose()` on the connection, `Symbol.asyncDispose`,
  or both, and what `close()` guarantees when the consumer forgets to dispose.
- Whether the plain core lives beside the Effect code in `@rivus/agent-kit-acp` (one package, two entries) or in a
  sibling package the binding depends on; the boundary rules and `check-dist` already police the second shape's
  dependency direction.
- Whether the Effect API keeps its current types (preferred — existing consumers do not migrate) or re-expresses
  over the core's types.
- The parity test harness: one scenario runner, two surfaces, byte-identical transcripts and error sequences.

A spike on the ACP slice — plain core behind a feature branch, both surfaces tested against the same fixtures — is
the cheapest way to turn every open point above into a measured answer. This document takes no position on doing
it; that decision follows the owner's read of the consumer demand for an Effect-free `/acp`.
