# 0002: Transcript model

Give `Transcript` an in-memory model that carries the operations over a whole transcript as methods, and name its plain data `TranscriptSnapshot`. Use cases and session adapters keep returning the plain data, boundaries keep carrying it, and the runtime output of every existing export stays the same.

- Status: in review
- Owner: PerfectPan
- Reviewer: unconfirmed
- Last updated: 2026-10-15
- Paired Spec: [docs/specs/0001-agent-kit.md](../specs/0001-agent-kit.md): the `/transcript` section, the domain invariant on public classes and the new scenarios S117 and S118. Task 2 applies the text in [A.1](#a1-spec-0001-changes)

## Contents

- [1. Background and goals](#1-background-and-goals)
- [2. Outline](#2-outline)
- [3. Detailed design](#3-detailed-design)
- [4. Release and rollback](#4-release-and-rollback)
- [5. Verification](#5-verification)
- [6. Execution plan](#6-execution-plan)
- [7. Risks, open questions, and follow-up](#7-risks-open-questions-and-follow-up)
- [Appendix](#appendix)

## 1. Background and goals

### 1.1 Current behavior and constraints

- `Transcript` (`packages/sessions/src/domain/transcript/value-objects/transcript.ts`) is a plain interface with `agent`, `agentVersion?`, `session`, `capabilities`, `agents`, `events` and `skipped`. The operations over a whole transcript are exported functions of the same concept: `foldTranscript` (`services/fold-transcript.ts`), `sessionPrompts`, `mainAgentId`, `promptStarts` (`policies/turns.ts`) and `shadowedIn` (`policies/compaction-shadowing.ts`).
- `loadTranscript` and `SessionAdapter.load` (`sessions-v1`) resolve to `Result<Transcript, …>`. A third-party adapter builds that plain object itself; the helpers that build it (`createTranscript`) are internal.
- `summarizeSession` takes the adapter's `summarize` pass when it has one, else `foldTranscript(load(...))` plus `sessionPrompts`. All three built-in adapters have a pass. A pass never builds a Transcript and keeps state that grows with the session's requests, not its bytes (Spec 0001, `/transcript`). The passes and `foldTranscript` share one fold kernel (`SummaryTotals`, `addRequest`, `emptyPrompts`, `finishPass` in `fold-transcript.ts`), and the conformance case "summarizes like foldTranscript(load())" (`packages/testing/src/session-adapter-conformance.ts`) keeps their numbers equal on every fixture.
- Only the failure of the fallback path (an adapter without a pass) is tested (`packages/testing/test/claude-code.test.ts`, "returns ReadFailed…" with a custom adapter). Its successful result is not.
- Public surface rules: the only public class is `AgentKitError` (Spec 0001, "All entries"); aggregate classes never appear in `public.ts` and are exposed as handle interfaces plus read-only snapshots (authoring.md, "Expose A Small Public Surface"; Spec 0001, "Domain Invariants"); plain data passes through the trace viewer's RPC unchanged (plan 0001, 3.5). Read-only contexts have no aggregates (authoring.md, "Aggregate Or Value Object").
- Size budgets in `packages/agent-kit/.size-limit.ts`, measured on `bfb1cd0` (2026-10-15, minified and brotlied): `/transcript` 25.08 kB of 25.5 kB, `/sessions` 23.91 kB of 24.4 kB, `/transcript/usage` 18.82 kB of 19.36 kB.
- Compiler settings that constrain the class: internal packages target ES2022 (class fields use define semantics) with `isolatedDeclarations`; the shell type-checks the bundled sources with `erasableSyntaxOnly`.

### 1.2 Problem

A caller that holds a loaded transcript reaches its operations through free functions that the editor does not offer on the value, so the caller has to know which functions exist. The owner chose to give Transcript an in-memory model whose methods carry these operations, while plain data stays the form that crosses boundaries and is stored. The model must not:

- create a second implementation of the summary rules, because the fast passes never build a model and cannot call its methods;
- copy events or add memory per event for sessions with tens of thousands of events;
- add a public class or move a class into `public.ts`;
- push `/transcript` over its budget or grow the entries that do not use it.

### 1.3 Goals and success criteria

1. `restoreTranscript(snapshot)` returns a `Transcript` with `summarize()`, `prompts(options)`, `mainAgentId()`, `promptStarts(lane?)`, `shadowed()` and `toSnapshot()`. Each method gives what the function of the same rule gives for that snapshot (S117).
2. The runtime output of every existing export is unchanged: existing tests pass without changing an assertion; test files change only type names.
3. Nothing is copied: `toSnapshot()` returns the restored object, and the model's `events`, `agents`, `capabilities` and `skipped` are the snapshot's arrays.
4. Serializing or cloning a model gives its snapshot (S118).
5. `public.ts` and the shell's `src/transcript.ts` export the `Transcript` interface, the `TranscriptSnapshot` type and `restoreTranscript`, and no class.
6. `/transcript` stays within 25.5 kB (prototype: 25.17 kB); `/sessions` and `/transcript/usage` do not grow.
7. Spec 0001, authoring.md, CONTEXT.md, both READMEs, the adoption guide and plan 0001 describe the model.

### 1.4 Non-goals

- No aggregate, repository, state transition or domain event for Transcript; sessions stays a read-only context.
- TranscriptEvent, Lane and the payloads stay plain data.
- No change to the translators, the adapters' passes, the fold kernel, the summary numbers (`SESSION_SUMMARY_VERSION` stays 1) or the shape of `sessions-v1`.
- No deprecation of `foldTranscript`, `sessionPrompts`, `mainAgentId`, `promptStarts` or `shadowedIn`.
- No deep `readonly` types for events, no runtime validation of snapshots, no caching in the model.
- The other findings of the same review (the usage scan state rules in `scanUsage`, moving the SourcePointer types and SessionSummary between concepts) are separate work.

## 2. Outline

### 2.1 Design principles

- One implementation per rule: a method calls exactly one exported function of the concept and holds no logic of its own.
- Plain data across boundaries, the model in memory: use cases and adapters produce TranscriptSnapshot; a caller restores the model when it wants the methods.
- No copies: the model holds references to the snapshot's values.
- The class is an implementation detail: callers see an interface and a function.

### 2.2 Boundaries and responsibilities

| Part | Package | Change |
| --- | --- | --- |
| transcript concept | sessions, `domain/transcript/` | The plain interface becomes `TranscriptSnapshot` in `value-objects/transcript-snapshot.ts`; `value-objects/transcript.ts` holds the model |
| use cases and ports | sessions, `application/` | Types name `TranscriptSnapshot`; the fallback of `summarizeSession` reads the model |
| `/transcript` entry | agent-kit, `src/transcript.ts` | Re-exports `restoreTranscript` and `TranscriptSnapshot` |
| conformance suite | testing | Type names only |
| built-in and third-party adapters | sessions, consumers | Runtime unchanged; annotations name `TranscriptSnapshot` |

### 2.3 Main path

```text
SessionAdapter.load ──► TranscriptSnapshot ──► loadTranscript ──► caller
                                                                   │  (RPC, worker, storage: plain data as today)
                                                                   ▼
                                         restoreTranscript(snapshot) ──► Transcript
                                                                   │  summarize()     → foldTranscript
                                                                   │  prompts(o)      → sessionPrompts
                                                                   │  mainAgentId()   → mainAgentId
                                                                   │  promptStarts(l) → promptStarts
                                                                   │  shadowed()      → shadowedIn
                                                                   ▼
                                                     toSnapshot() → the same snapshot object

summarizeSession: adapter pass when it has one (unchanged), else load → restoreTranscript → summarize() / prompts()
```

The summary rules sit in three layers, and the model adds no fourth:

| Layer | Code | Used by |
| --- | --- | --- |
| Fold kernel | `SummaryTotals`, `addRequest`, `emptyPrompts`, `finishPass` | `foldTranscript` and the three passes |
| From events | `foldTranscript`, `sessionPrompts` | `Transcript.summarize()`, `Transcript.prompts()`, the conformance suite |
| From records | each adapter's `summarize` pass | `summarizeSession` |

### 2.4 Design decisions

**D1. Transcript is a value object with behavior, not an aggregate.** It keeps no identity across state changes and has no transitions. The aggregate shape of authoring.md (`create` and `restore` returning a `Result`, transitions returning `{ state, events }`, a repository and its conformance suite) does not apply, so the file goes under `value-objects/`, not `aggregates/`. The statement that read-only contexts have no aggregates stays true.

**D2. The method set holds only operations whose subject is the whole transcript.** `summarize`, `prompts`, `mainAgentId`, `promptStarts`, `shadowed` and `toSnapshot`. The rules about one event (`isPrompt`, `laneOf`, `recordKey`, `requestUsage`, `promptSnapshot`, `latestSnapshot`, `snapshotHasSystemPrompt`, `snapshotHasTools`) stay functions, because events stay plain data. Every method is code an importer of the model cannot shake off, so the set stays at what callers use on a loaded transcript.

**D3. Events stay plain data.** Rejected: a class per event. Built in the translators, it would change three translators, every third-party adapter (`sessions-v1` returns plain data) and the live ACP events from `foldStreamParts`. Wrapped after loading, it would allocate a second object per event, tens of thousands per large session. The ten event kinds with their own payload types would need ten classes, and every RPC call would need a `toSnapshot` per event.

**D4. One summary algorithm.** `summarize()` calls `foldTranscript`, which the fast passes are tested against. The passes cannot use the model because they never build one, so the shared code stays in the fold kernel, where it is today.

**D5. `loadTranscript` and `SessionAdapter.load` return `TranscriptSnapshot`.** Rejected: returning the model, which breaks the plain-data rule for RPC (`structuredClone` drops methods), breaks every `sessions-v1` adapter and changes runtime output. Rejected: an option such as `{ model: true }`, which gives one call two result types for no gain over one `restoreTranscript` call.

**D6. The public surface is an interface and a function.** `Transcript` (interface), `TranscriptSnapshot` (type) and `restoreTranscript` (function); the class `TranscriptValue` stays internal. Rejected: exporting the class, which breaks the rule that `AgentKitError` is the only public class, and whose `instanceof` fails when two copies of the kit are installed. No `isTranscript` guard is added: authoring.md bans hand-written shape guards.

**D7. `Transcript` names the model; `TranscriptSnapshot` names the data.** Rejected: keeping `Transcript` for the data and naming the model `TranscriptView`. That has no type break, but the glossary term would name the data while its operations live under another name, and giving `Transcript` to the model later would change the meaning of a name silently. Chosen: one type break that the compiler reports, in one release (3.7).

**D8. `restoreTranscript` does not validate and returns the model, not a `Result`.** Its input is typed and comes from `loadTranscript`, a translator, or a caller's own copy of one. The adapters guarantee the invariants, and the conformance suite checks them. authoring.md's validated `restore` belongs to aggregates read back from a repository's stored files; Transcript has no repository. If the kit ever stores snapshots, a `schemaVersion` and validation come with that store.

**D9. Shallow freeze, no deep freeze, no caches.** `Object.freeze(this)` stops the model's own fields from being reassigned. Deep freezing would walk every payload and every `original` record on each restore. A cache would go stale silently, because the snapshot's arrays stay mutable and are shared with whoever holds the snapshot. Each method computes on call, in time linear in the events.

**D10. Own fields through `declare` and `Object.assign`; methods read `this`; `#snapshot` keeps the restored object.** Under ES2022 define semantics, a plain field declaration creates an own property with value `undefined`, so a snapshot without `agentVersion` would gain the key in `Object.keys` and `structuredClone`. `declare` emits nothing (allowed under `erasableSyntaxOnly`). Methods pass `this`, so the data a caller reads on the model is the data the rules read. `#snapshot` lets `toSnapshot()` return the restored object, and a private field is left out by `JSON.stringify` and `structuredClone`.

**D11. The fallback of `summarizeSession` reads the model.** The application layer then uses the model the way callers do. Task 1 pins the fallback's result before the change.

**D12. The free functions stay exported, without deprecation.** They are the reference the passes and the conformance suite compare against, and a caller that needs one rule keeps importing only that rule. The prototype measured `/sessions` and `/transcript/usage` unchanged because the class is shaken out of entries that do not import it.

**D13. One implementation PR, released as a minor with a migration note.** The commits in the PR are ordered and each one builds, but they ship together, so no release publishes the state between the rename and the model. The 0.12.0 release set the precedent of a type-only break in a minor while the version is below 1.0: `TranscriptEvent` became a discriminated union, and "Runtime output is unchanged" was stated in the note.

## 3. Detailed design

### 3.2 Interfaces

`value-objects/transcript-snapshot.ts` takes the current contents of `value-objects/transcript.ts` (`Capability`, `CAPABILITIES`, `Lane`, `TranscriptSession`) with the interface renamed; its fields do not change:

```ts
/** The ordered events of a Session, merged from all its files, with the records that became no event, as plain data. */
export interface TranscriptSnapshot {
  agent: CodingAgentId;
  agentVersion?: string;
  session: TranscriptSession;
  capabilities: Capability[];
  agents: Lane[];
  events: TranscriptEvent[];
  skipped: SkippedRecord[];
}
```

`value-objects/transcript.ts`:

```ts
/**
 * A transcript in memory: the snapshot's fields plus the operations over the whole transcript. Each method gives what
 * the function of its rule gives for the snapshot. The model shares the snapshot's arrays and keeps no state of its
 * own; a top-level field reassigned on the snapshot after `restoreTranscript` is not seen.
 */
export interface Transcript extends Readonly<TranscriptSnapshot> {
  /** `foldTranscript` of this transcript. */
  summarize(): SessionSummary;
  /** `sessionPrompts` of this transcript under the given caps. */
  prompts(options: SessionPromptsOptions): SessionPrompt[];
  /** `mainAgentId` of this transcript. */
  mainAgentId(): string;
  /** `promptStarts` of this transcript, on one lane or on all. */
  promptStarts(lane?: string): TranscriptEvent[];
  /** `shadowedIn` of this transcript's events. */
  shadowed(): Set<string>;
  /** The snapshot this model was restored from, the same object. */
  toSnapshot(): TranscriptSnapshot;
}

class TranscriptValue implements Transcript {
  // `declare`: under ES2022 class fields a plain declaration creates an own `undefined` property, and a snapshot
  // without `agentVersion` would gain that key when it is cloned or serialized.
  declare readonly agent: CodingAgentId;
  declare readonly agentVersion?: string;
  declare readonly session: TranscriptSession;
  declare readonly capabilities: Capability[];
  declare readonly agents: Lane[];
  declare readonly events: TranscriptEvent[];
  declare readonly skipped: SkippedRecord[];
  readonly #snapshot: TranscriptSnapshot;

  private constructor(snapshot: TranscriptSnapshot) {
    Object.assign(this, snapshot);
    this.#snapshot = snapshot;
    Object.freeze(this);
  }

  static restore(snapshot: TranscriptSnapshot): Transcript {
    return new TranscriptValue(snapshot);
  }

  summarize(): SessionSummary {
    return foldTranscript(this);
  }

  prompts(options: SessionPromptsOptions): SessionPrompt[] {
    return sessionPrompts(this, options);
  }

  mainAgentId(): string {
    return mainAgentId(this);
  }

  promptStarts(lane?: string): TranscriptEvent[] {
    return promptStarts(this, lane);
  }

  shadowed(): Set<string> {
    return shadowedIn(this.events);
  }

  toSnapshot(): TranscriptSnapshot {
    return this.#snapshot;
  }
}

/**
 * The model of a snapshot from `loadTranscript`, a translator, or a copy of one. The snapshot is not validated or
 * copied: the adapters guarantee its invariants, and the model shares its arrays.
 */
export function restoreTranscript(snapshot: TranscriptSnapshot): Transcript {
  return TranscriptValue.restore(snapshot);
}
```

Module dependencies stay acyclic: `transcript-snapshot.ts` ← `policies/`, `services/`, `factories/` ← `transcript.ts`. Every function that takes a transcript today takes `TranscriptSnapshot` or a `Pick` of it. A `Transcript` is assignable to those parameters, because `Readonly` does not affect assignability.

Signature changes, all type-level:

| Symbol | Before | After |
| --- | --- | --- |
| `loadTranscript` | `Promise<Result<Transcript, LoadTranscriptError>>` | `Promise<Result<TranscriptSnapshot, LoadTranscriptError>>` |
| `SessionAdapter.load` | `Promise<Result<Transcript, SessionReadError>>` | `Promise<Result<TranscriptSnapshot, SessionReadError>>` |
| `foldTranscript` | `(transcript: Transcript)` | `(transcript: TranscriptSnapshot)` |
| `mainAgentId`, `promptStarts`, `sessionPrompts` | `Pick<Transcript, …>` | `Pick<TranscriptSnapshot, …>` |
| `createTranscript` (internal) | returns `Transcript` | renamed `createTranscriptSnapshot`, returns `TranscriptSnapshot` |
| `Transcript` (public type) | the plain interface | the model interface above |
| `TranscriptSnapshot`, `restoreTranscript` | — | new exports of `/transcript` |

### 3.3 Domain model, state, and data ownership

- A restore allocates one frozen object holding seven references; the arrays and every event stay the snapshot's. The memory of a loaded session is what `loadTranscript` already holds. A view that only needs numbers keeps using `summarizeSession`, whose passes load no transcript.
- The transcript invariants (unique ids, `seq` equal to the index, paired or orphan tool results, `shadowedBy` pointing at a later compaction on the same lane, references that resolve) keep their owners: the translators set them, and the conformance suite checks them.
- The snapshot's type stays mutable, as today. A change to an event after the restore shows in the next method call, because nothing is cached. A top-level field reassigned on the snapshot after the restore is not seen by the model; the interface's TSDoc says so.

### 3.4 State transitions and lifecycle

The model has no transitions. Its life is: an adapter or a translator produces the snapshot → the snapshot crosses boundaries as plain data → a caller restores the model → the caller reads it → `toSnapshot()` hands the same object to the next boundary.

### 3.6 Failures and recovery

`restoreTranscript` cannot fail. A snapshot that breaks the type, such as one read back from a caller's own storage, makes a method fail exactly as the function of its rule fails on the same value.

### 3.7 Compatibility and migration

- Runtime: no change. Every use case, translator and adapter resolves to the same values, `SESSION_SUMMARY_VERSION` stays 1, and the shape of `sessions-v1` is unchanged.
- Types: code that annotates a `loadTranscript` value, a `SessionAdapter.load` result or an object literal it builds as `Transcript` no longer compiles, because `Transcript` now requires the methods. Rename the annotation to `TranscriptSnapshot`, or pass the value through `restoreTranscript` where the methods are wanted. `Pick<Transcript, …>` parameters keep compiling and accept both forms.
- Change file for `@rivus/agent-kit`, type `minor`:

  > `/transcript` adds `restoreTranscript(snapshot)`, which gives a `Transcript` model with `summarize()`, `prompts(options)`, `mainAgentId()`, `promptStarts(lane?)`, `shadowed()` and `toSnapshot()`. The plain transcript type is now `TranscriptSnapshot`: `loadTranscript` and `SessionAdapter.load` resolve to it, and code that annotates their values as `Transcript` must rename the annotation to `TranscriptSnapshot` or restore the model. Runtime output is unchanged.

### 3.8 Security and privacy

No new IO and no new data. `redact` and the source pointers are unaffected.

## 4. Release and rollback

### 4.1 Gates and rollout stages

The implementation PR merges after the gates in 6.4. The release workflow publishes it with the next release (`docs/development/release.md`). Consumers (the trace viewer, the host application, presence, the editor plugin) adopt it when they upgrade; a compile error on a `Transcript` annotation is the expected signal, and the change file states the fix.

### 4.3 Rollback

Revert the implementation PR. If the release already shipped, the next release carries the revert with its own change file. No data is persisted, so nothing needs migration.

## 5. Verification

### 5.1 Functional checks

- S117 (`packages/testing/test/claude-code.test.ts`): on the `plain` fixture, the restored model's `summarize()` is the literal summary that `summarizeSession` gives, `prompts({ limit: 5, maxChars: 3 })` is `[{ text: "Run" }]`, and `toSnapshot()` is the loaded value.
- Unit tests (`packages/sessions/src/domain/transcript/value-objects/transcript.test.ts`) on synthetic snapshots built like `fold-transcript.test.ts` builds them: each method's literal result, capability gating included; identity and array sharing; S118 serialization; freezing; a model accepted by the functions.

### 5.3 Compatibility checks

- No assertion in an existing test changes; test files change only `Transcript` to `TranscriptSnapshot`.
- The fallback characterization test (Task 1) passes before and after Task 5 without edits.
- The conformance suite runs unchanged for the three built-in adapters.
- Sizes: `/transcript` ≤ 25.5 kB, `/sessions` 23.91 kB and `/transcript/usage` 18.82 kB.
- The dist check (`scripts/check-dist.ts`) passes: `/transcript` stays a plain entry.

### 5.4 End-to-end acceptance

The consumer smoke test (`scripts/smoke-consumer.ts`, run by `npm run check:package`) installs the packed tarball and, for each seeded agent, restores the loaded transcript and asserts that `toSnapshot()` is the loaded value and that `summarize()` deep-equals what `summarizeSession` resolves to for the same ref.

## 6. Execution plan

### 6.1 Preconditions

- This plan is accepted (Status `accepted`).
- Work starts on a branch from `main`, for example `refactor/transcript-model`.
- Local hooks are installed (`./scripts/install-git-hooks.sh`) and `node common/scripts/install-run-rush.js install` has run.
- Baseline: `npm run check` passes on the branch point, and the sizes match 1.1 or are recorded again.

### 6.2 Completion contract

| Condition | Task | Evidence |
| --- | --- | --- |
| Goal 1, S117 | 4 | S117 test in `claude-code.test.ts`; unit tests in `transcript.test.ts` |
| Goal 2 | 1, 3, 5 | `npm run test` passes; the Task 3 and Task 5 commits change no assertion in an existing test |
| Goal 3 | 4 | Unit tests: `toSnapshot()` is the snapshot; the arrays are the snapshot's |
| Goal 4, S118 | 4 | Unit test for `JSON.stringify` and `structuredClone` |
| Goal 5 | 4 | `public.ts` and `packages/agent-kit/src/transcript.ts` export no class; `npm run check:package` passes |
| Goal 6 | 4 | `size-limit` output in `npm run check:package` |
| Goal 7 | 2, 6 | Doc diffs in the PR |
| Fallback unchanged | 1, 5 | Task 1 test passes before and after Task 5 |

### 6.3 Execution order

The plan ships in two PRs. Batch A is this document. Batch B holds Tasks 1–7 as separate commits; each commit builds and passes `npm run check`, and they merge together.

#### Task 1: Pin the fallback of `summarizeSession`

- Files: `packages/testing/test/claude-code.test.ts`.
- Change: add the test "summarizes through the loaded transcript when the adapter has no pass", next to "summarizes a session like folding its transcript". It passes `{ adapters: { "claude-code": { ...builtinSessionAdapters["claude-code"], summarize: undefined } }, prompts: { limit: 5, maxChars: 3 } }` for `{ agent: "claude-code", path: session("plain") }` and expects `{ ok: true, value: { turns: 1, requests: 2, inputTokens: 40, outputTokens: 9, durationMs: 1500, compactions: 0, subagents: 0, failedTools: 1, contextShape: [13, 27], prompts: [{ text: "Run" }] } }`. These values were computed on the built dist on 2026-10-15, and the fast pass gives the same.
- Tests: the new test only. No production code changes in this task.
- Exit condition: `npm run test` passes on unchanged production code.

#### Task 2: Revise Spec 0001

- Files: `docs/specs/0001-agent-kit.md`.
- Change: apply [A.1](#a1-spec-0001-changes): the `/transcript` exports, the new bullet on the snapshot and the model, the domain invariant on public classes, and scenarios S117 and S118 with their entry in the test coverage list.
- Tests: none.
- Exit condition: `npm run format:check` passes.

#### Task 3: Rename the plain type to `TranscriptSnapshot`

- Files:
  - `packages/sessions/src/domain/transcript/value-objects/transcript.ts` → moved to `value-objects/transcript-snapshot.ts`, interface renamed, plus a temporary `@deprecated` alias `export type Transcript = TranscriptSnapshot`;
  - `domain/transcript/index.ts`, `factories/transcript-event.ts` (`createTranscript` → `createTranscriptSnapshot`), `policies/turns.ts`, `services/fold-transcript.ts`, `services/fold-transcript.test.ts`;
  - `application/ports.ts`, `application/use-cases/load-transcript.ts`, `application/services/session-adapters/{claude-code,codex,grok}.ts`;
  - `packages/sessions/src/index.ts` (the sibling export of `createTranscript`);
  - `packages/sessions/src/public.ts`, `packages/agent-kit/src/transcript.ts` (export `TranscriptSnapshot`; `Transcript` stays exported as the alias until Task 4 gives the name to the model);
  - `packages/testing/src/session-adapter-conformance.ts`;
  - `packages/testing/test/{claude-code,codex,grok,conformance-catches}.test.ts`.
- Change: names only. Every code use moves to `TranscriptSnapshot`: `rg -w Transcript packages --type ts` lists only the alias, its re-exports and comments that mean the domain term, so Task 4 can replace the alias without touching a use.
- Tests: existing tests, unchanged assertions.
- Exit condition: `npm run check` passes; the sizes in 1.1 are unchanged.

#### Task 4: Add the model

- Files:
  - new `packages/sessions/src/domain/transcript/value-objects/transcript.ts` with the code in 3.2;
  - `domain/transcript/index.ts` exports `restoreTranscript` and `type Transcript`;
  - `packages/sessions/src/public.ts` and `packages/agent-kit/src/transcript.ts` export `restoreTranscript` and `type Transcript`, one by one;
  - new `packages/sessions/src/domain/transcript/value-objects/transcript.test.ts`;
  - `packages/testing/test/claude-code.test.ts` (S117);
  - `packages/agent-kit/scripts/smoke-consumer.ts` (5.4).
- Change: as 3.2, and the alias from Task 3 is removed. The class is not exported from any `public.ts` or `index.ts`.
- Tests:
  - `transcript.test.ts`:
    - each method's literal result on synthetic snapshots: `summarize()` with and without the `usage` capability, `prompts()` under caps, `mainAgentId()` with and without a root lane, `promptStarts()` on the main lane and on all lanes, and `shadowed()` with a compaction;
    - `toSnapshot()` is the restored object (`toBe`), and `events`, `agents`, `capabilities` and `skipped` are the snapshot's arrays (`toBe`);
    - S118: `JSON.stringify(model)` equals `JSON.stringify(snapshot)`, `structuredClone(model)` has the snapshot's keys (`Object.keys`), no functions and no `agentVersion` key when the snapshot has none, and a model restored from the clone summarizes the same;
    - `Object.isFrozen(model)` holds, and assigning a field throws a `TypeError`;
    - `foldTranscript(model)` equals `model.summarize()`, so a model is accepted where a snapshot is.
  - `claude-code.test.ts`: S117 with the literals in A.1.
- Exit condition: `npm run check` passes, and `size-limit` reports `/transcript` ≤ 25.5 kB, `/sessions` 23.91 kB and `/transcript/usage` 18.82 kB.

#### Task 5: Read the model in the fallback of `summarizeSession`

- Files: `packages/sessions/src/application/use-cases/load-transcript.ts`.
- Change: replace `foldTranscript(transcript.value)` and `sessionPrompts(transcript.value, prompts)` with `const model = restoreTranscript(transcript.value)`, `model.summarize()` and `model.prompts(prompts)`. The validation of `prompts` (`promptsOption`) stays in the use case.
- Tests: the Task 1 test, unchanged.
- Exit condition: `npm run check` passes.

#### Task 6: Update current-state documentation

- Files and changes:
  - `docs/architecture/authoring.md`: add the paragraph in [A.2](#a2-authoringmd-changes) to "Aggregate Or Value Object", and extend the bullet on handle interfaces in "Expose A Small Public Surface".
  - `CONTEXT.md`: revise **Transcript** and add **TranscriptSnapshot** ([A.3](#a3-contextmd-changes)).
  - `README.md` and `packages/agent-kit/README.md`: add `restoreTranscript` to the `/transcript` row, and after the paragraph on `loadTranscript`, one sentence: it returns a `TranscriptSnapshot`, and `restoreTranscript` gives the model with `summarize()`, `prompts()`, `mainAgentId()`, `promptStarts()` and `shadowed()`.
  - `docs/development/adoption.md`: add `restoreTranscript` to the `/transcript` row.
  - `docs/specs/0001-agent-kit.md`: drop "not yet implemented" from the Status line Task 2 added.
  - `docs/plans/0001-agent-kit.md`: in the sessions model row of 3.1, add "the in-memory Transcript model over TranscriptSnapshot (plan 0002)"; in the 3.5 example, annotate `Result<TranscriptSnapshot>`.
- Tests: none.
- Exit condition: `npm run format:check` passes; `rg -n "Result<Transcript>" docs README.md packages/*/README.md` finds nothing.

#### Task 7: Change file, checks and PR

- Files: `common/changes/@rivus/agent-kit/*.json` from `npm run change`.
- Change: type `minor`, with the message in 3.7.
- Tests: none.
- Exit condition: every row of 6.4 passes; the PR description has Summary, Validation and Risks; `gh repo-checks pr-title` and `gh repo-checks pr-body` pass.

### 6.4 Validation ledger

| Batch | Command or evidence | Expected result |
| --- | --- | --- |
| A | `npm run format:check` | passes |
| A | `gh repo-checks pr-title "docs(plans): add the Transcript model plan"` and `gh repo-checks pr-body` | pass |
| B, after each task | `npm run check` | passes |
| B, Task 1 | `npm run test` on unchanged production code | the new test passes |
| B, Task 3 | `git diff HEAD~1 -- '*.test.ts'` on the Task 3 commit | only type names change |
| B, Task 4 | `size-limit` lines in `npm run check:package` | `/transcript` ≤ 25.5 kB; `/sessions` 23.91 kB; `/transcript/usage` 18.82 kB |
| B, Task 4 | `rg -n "class " packages/sessions/src/public.ts packages/agent-kit/src/transcript.ts` | no match |
| B, Task 7 | `npm run change:verify` | passes |
| B, Task 7 | the publish safety scan in AGENTS.md | no match |
| B, Task 7 | `gh repo-checks pr-title "refactor(transcript): add the Transcript model over TranscriptSnapshot"` and `gh repo-checks pr-body` | pass |

### 6.5 Rollback per batch

- Batch A: revert the documentation PR.
- Batch B: revert the whole PR. Its commits are not released one by one: between Tasks 3 and 4 the public `Transcript` is an alias of the plain type, a meaning no release should publish. No data is persisted, and the release order with other packages does not matter.

## 7. Risks, open questions, and follow-up

| Item | Type | Impact | Owner | Next step or deadline |
| --- | --- | --- | --- | --- |
| `/transcript` keeps about 0.27 kB of headroom after the model (25.23 kB measured after Task 4) | risk | The next feature in `/transcript` will need a budget raise with its reason in `.size-limit.ts` | PerfectPan | Decide with that feature |
| Consumers that annotate `Transcript` stop compiling | risk | Type-only; all known consumers belong to the owner | PerfectPan | Migration note in the change file (3.7) |
| A later edit replaces `declare` with plain fields | risk | Snapshots without `agentVersion` gain the key in clones | PerfectPan | The S118 unit test asserts the keys |
| Reviewer | open question | Review not yet assigned | unconfirmed | Assign before Status `accepted` |
| Usage scan state rules in `scanUsage`; SourcePointer types and SessionSummary placement | follow-up | Domain cohesion, outside this plan | PerfectPan | Separate plan or issue |

## Appendix

### A.1 Spec 0001 changes

In Status, after the paired plan: "[docs/plans/0002-transcript-model.md](../plans/0002-transcript-model.md) revises `/transcript` with the Transcript model (S117, S118), not yet implemented". Task 6 drops "not yet implemented".

In `/transcript`, first bullet: add `restoreTranscript` after `readOriginal` in the export list, and replace "and the types of the transcript model" with "and the types of the transcript model, among them `Transcript` (the in-memory model) and `TranscriptSnapshot` (its plain data)".

In `/transcript`, a new bullet after the one on `summarizeSession`:

> `loadTranscript` and a `SessionAdapter`'s `load` resolve to a `TranscriptSnapshot`: plain data that passes through `structuredClone`, `postMessage` and JSON unchanged. `restoreTranscript(snapshot)` returns a `Transcript`: the snapshot's fields plus `summarize()`, `prompts({ limit, maxChars })`, `mainAgentId()`, `promptStarts(lane?)`, `shadowed()` and `toSnapshot()`. Each method gives what the function of its rule gives for the snapshot (`foldTranscript`, `sessionPrompts`, `mainAgentId`, `promptStarts`, `shadowedIn`), and `prompts` takes its caps as `sessionPrompts` does. `toSnapshot()` returns the restored object, and the model shares the snapshot's arrays instead of copying them. The model does not validate, cache or change the snapshot; serializing or cloning it gives the snapshot. A `Transcript` is accepted wherever a `TranscriptSnapshot` is.

In Domain Invariants, replace the bullet on aggregate classes with:

> Aggregate classes and the class of the Transcript model never appear in the public surface; aggregates are exposed as handle interfaces and read-only snapshots, and the Transcript model as an interface that `restoreTranscript` returns.

New scenarios after S116:

> ### S117: A loaded transcript restores into a model with the same numbers
>
> - Given the claude-code `plain` conformance fixture under the default projects root
> - When `loadTranscript` resolves and `restoreTranscript` restores its value
> - Then `summarize()` is `{ turns: 1, requests: 2, inputTokens: 40, outputTokens: 9, durationMs: 1500, compactions: 0, subagents: 0, failedTools: 1, contextShape: [13, 27] }`, which `summarizeSession` also resolves to for that session; `prompts({ limit: 5, maxChars: 3 })` is `[{ text: "Run" }]`; and `toSnapshot()` is the loaded value itself
>
> ### S118: A model crosses a boundary as its snapshot
>
> - Given a model restored from a snapshot without `agentVersion`
> - When it passes through `JSON.stringify` and through `structuredClone`
> - Then both give the snapshot's keys and values with no functions and no `agentVersion` key, and a model restored from the clone summarizes the same as the original

In the test coverage list of the Acceptance Examples: "S117 by the claude-code transcript tests (`packages/testing/test/claude-code.test.ts`) and the consumer smoke test; S118 by the Transcript model unit tests (`packages/sessions/src/domain/transcript/value-objects/transcript.test.ts`)".

### A.2 authoring.md changes

Add to "Aggregate Or Value Object", after the paragraph on read-only contexts:

> A value object may have an in-memory model when callers want its operations on the value. The model is a frozen class over the snapshot that is not exported; callers get an interface that extends the snapshot type, from a `restore<Concept>(snapshot)` function. Each method calls one exported policy or domain service of the concept, which stays the only implementation and stays public. The model has no transitions, no repository and no caches, does not validate its snapshot, and copies none of its values. Use cases and agent adapters keep returning the snapshot. `Transcript` (sessions) is such a model over `TranscriptSnapshot`.

Extend the bullet "Aggregates are exposed as handle interfaces…" in "Expose A Small Public Surface" with: "A value-object model is exposed the same way: its interface and its restore function."

### A.3 CONTEXT.md changes

> **Transcript**:
> The ordered TranscriptEvents of a Session, merged from all its files, with the records that were skipped. In code, `Transcript` is the in-memory model: a TranscriptSnapshot plus the operations over the whole transcript (its summary, prompts, prompt starts and shadowed events).
>
> **TranscriptSnapshot**:
> A Transcript as plain data: what `loadTranscript` and session adapters return, and what crosses process, worker and storage boundaries. `restoreTranscript` gives its model.

### A.4 Prototype evidence

On 2026-10-15 the class in 3.2 (then named `TranscriptModel`, reading `#snapshot` in its methods) was added to `packages/sessions` and exported through `/transcript`, measured, and removed again; nothing was committed.

- `npm run build` and `size-limit`: `/transcript` 25.08 → 25.17 kB; `/sessions` 23.91 kB and `/transcript/usage` 18.82 kB unchanged.
- `tsc` for sessions, the shell's `typecheck` (with `erasableSyntaxOnly`) and the sessions lint passed.
- A script that imported the built `/transcript` entry printed:
  - `summarize()` equal to `foldTranscript` of the same snapshot;
  - `toSnapshot() === snapshot` and `model.events === snapshot.events`;
  - `JSON.stringify(model) === JSON.stringify(snapshot)`;
  - `structuredClone(model)` with the keys `agent, session, capabilities, agents, events, skipped` and no methods;
  - `Object.isFrozen(model)` true and no own `agentVersion` key;
  - `foldTranscript(model)` equal to `model.summarize()`.
- On the claude-code `plain` fixture, `summarizeSession` through an adapter without a pass, with `prompts: { limit: 5, maxChars: 3 }`, resolved to the literal in Task 1, equal to the fast pass's result.
