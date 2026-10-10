# Change Log - @rivus/agent-kit-collab

This log was last generated on Sat, 10 Oct 2026 20:10:42 GMT and should not be manually modified.

## 0.10.0
Sat, 10 Oct 2026 20:10:42 GMT

_Version update only_

## 0.9.0
Sat, 10 Oct 2026 17:35:50 GMT

_Version update only_

## 0.8.0
Sat, 10 Oct 2026 15:55:22 GMT

_Version update only_

## 0.7.0
Sat, 10 Oct 2026 13:27:57 GMT

_Version update only_

## 0.6.0
Sat, 10 Oct 2026 05:42:15 GMT

### Updates

- Adopt lint-config v0.5.0.
- Move the toolchain to Vite+: build with `vp pack`, lint/format/test through `vp`. The built output is unchanged.
- Internal refactor: declare functions before their use; no behavior change.
- Adopt lint-config v0.6.0: no-use-before-define checks function declarations.

## 0.5.0
Fri, 09 Oct 2026 09:29:24 GMT

### Patches

- The file lease envelope, the holder file's ENOENT read and the SQLite busy check parse with zod/mini schemas; a stored record missing its `record` field fails as an invalid record again. The `/lease` and `/process-lock` entries grow by their schema code.

### Updates

- Parse the file lease envelope, the holder file's ENOENT code and the SQLite busy check with zod/mini schemas instead of hand-written shape checks. Observed behavior is unchanged.

## 0.4.0
Thu, 08 Oct 2026 22:27:28 GMT

### Minor changes

- Unify the lease store into an aggregate repository: `LeaseStore`, `LeaseStoreShape` and `LeaseStoreFailure` are now `LeaseRepository`, `LeaseRepositoryShape` and `LeaseRepositoryFailure` (service key `@rivus/agent-kit-collab/lease/LeaseRepository/v1`), and `fileLeaseStore`, `memoryLeaseStore`, `sqliteLeaseStore` (with `FileLeaseStoreOptions`, `SqliteLeaseStoreOptions`) are now `fileLeaseRepository`, `memoryLeaseRepository`, `sqliteLeaseRepository` (with the matching options types).
- The lease repository port now follows the kit's repository shape: the port's `read` is `load`, and `compareAndSet(key, expected, next)` (returning a boolean) is `save(key, next, expectedRevision)`, which fails with a typed `RevisionConflict` (`_tag`, `key`, `expectedRevision`, `storedRevision`) instead of returning `false`; the lease manager treats the conflict as it treated the boolean.

### Patches

- Move the lease timing invariant, the loss-reason classification, the holder expiry rule and the lane admission rules into the lease and lane domains; `runFenced` now refuses fenced work over a stored record that breaks the Lease invariants (`LeaseStoreFailure` `invalid-record`) instead of trusting its raw fields. No API change.

### Updates

- Adopt lint-config v0.4.0 and fix the no-use-before-define hits it surfaces. No API or behavior change.
- Align the package layout with the types-ddd folder names (domain aggregates, application use-cases/services, infra). No API or behavior change.

## 0.3.0
Thu, 08 Oct 2026 04:46:15 GMT

### Minor changes

- First release: /lease (Effect: createLeaseManager, SQLite, file and memory stores, fenced work interrupted on lease loss) and /process-lock (acquireProcessLock), released in lockstep with @rivus/agent-kit.
- Add /lanes (Effect): createLanes({ maxConcurrent, maxQueued?, turnTimeoutMs?, activate, onExit? }) runs at most one activation per key, coalesces wakes into one pending activation, caps concurrency across keys, bounds the queue (LaneQueueFull), interrupts an activation after its turn timeout, and offers wake, cancel, status and close in the caller's Scope.

### Updates

- Document lockstep package installation and application adoption.

