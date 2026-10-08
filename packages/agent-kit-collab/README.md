# @rivus/agent-kit-collab

Collaboration primitives for processes that run coding agents side by side: a lease with fencing tokens, so that
one process at a time owns a task and a stale owner's writes are refused, a single-instance process lock, and lanes
that run work per key, one activation at a time, under a global concurrency cap. The package knows no particular
agent; it reaches files, processes, clocks and SQLite through the `Platform` of
[`@rivus/agent-kit`](https://www.npmjs.com/package/@rivus/agent-kit).

Status: 0.x, with one lockstep release policy for this package and `@rivus/agent-kit` (same version). A minor release may contain breaking
changes.

## Install

```bash
npm install @rivus/agent-kit @rivus/agent-kit-collab
# for /lease and /lanes, which are Effect entries:
npm install effect@4.0.1
```

Select a verified non-placeholder release that exports the entries you need, with both packages at the same
version. See [Adopting agent-kit](https://github.com/PerfectPan/agent-kit/blob/main/docs/development/adoption.md) for migration checks and rollback.

`@rivus/agent-kit` is a peer dependency, so the process holds one copy of the platform types. `effect` 4.0.1 is an
optional peer that only `/lease` and `/lanes` need. ESM only, no side effects, Node.js 22.13 or later on darwin or
linux (the locks identify processes by boot id, pid and start time, which the platform does not support on win32).
Every lock supports local directories only; neither SQLite's locks nor lock files are reliable on NFS. Holders are
judged by host name, boot id, pid and start time, so all processes that share a lock must see one process table:
containers that share the host's name and kernel but not its PID namespace are not supported, and a host renamed
while it holds locks makes its holders look remote (judged by the TTL alone; a lock file of a dead holder then stays
until removed).

## Entries

| Entry                                  | Main exports                                                                                                                                                                    | Kind     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `@rivus/agent-kit-collab/process-lock` | `acquireProcessLock`, `ProcessLock`, `ProcessLockHeld`                                                                                                                          | plain TS |
| `@rivus/agent-kit-collab/lease`        | `createLeaseManager`, `LeaseStore`, `sqliteLeaseStore`, `fileLeaseStore`, `memoryLeaseStore`; rules `isFresh`, `canAcquire`, `nextFencingToken`, `checkFence`, `holderLiveness` | Effect   |
| `@rivus/agent-kit-collab/lanes`        | `createLanes`                                                                                                                                                                   | Effect   |

### Process lock

```ts
import { createNodePlatform } from "@rivus/agent-kit/node";
import { acquireProcessLock } from "@rivus/agent-kit-collab/process-lock";

const lock = await acquireProcessLock(createNodePlatform(), "/var/run/my-daemon/daemon.lock");
if (!lock.ok) {
  console.error(`already running (pid ${lock.error.holder?.pid ?? "unknown"})`);
  process.exit(1);
}
// ... run; the kernel releases the lock if the process dies, or call:
await lock.value.release();
```

With `platform.sqlite` the lock is a SQLite database held with `locking_mode=EXCLUSIVE`; the kernel drops it the
moment the holder exits or crashes, and nothing is reclaimed. The holder's identity goes into `<path>.holder` for
diagnostics only. Without SQLite the lock is a file that holds the identity; a lock file whose holder died on this
host is reclaimed on the next attempt, one reclaimer at a time. Pass `{ wait: true, signal }` to wait for the holder
instead of getting `ProcessLockHeld` at once.

### Lease

```ts
import { NodePlatformLive } from "@rivus/agent-kit/node/effect";
import { createLeaseManager, sqliteLeaseStore } from "@rivus/agent-kit-collab/lease";
import { Effect, Layer } from "effect";

const LeaseLive = sqliteLeaseStore({ path: "/var/lib/my-app/leases.db" }).pipe(Layer.provideMerge(NodePlatformLive));

const program = Effect.scoped(
  Effect.gen(function* () {
    const leases = yield* createLeaseManager({ ttlMs: 60_000, heartbeatMs: 15_000 });
    const lease = yield* leases.acquire("task:42"); // fails with LeaseHeld while another live holder renews it
    // Writes carry the fencing token; when the lease is lost, the fenced work is interrupted.
    yield* lease.runFenced((token) => saveResult(token));
    // Stop other work on loss by racing it against lease.lost.
    yield* longRunningWork.pipe(Effect.raceFirst(lease.lost));
  })
);

await Effect.runPromiseExit(program.pipe(Effect.provide(LeaseLive)));
```

- A lease has one holder. Its generation, the fencing token, grows on every acquisition and never goes back: a
  release keeps the record as a tombstone. Losing the lease and getting it again gives a new generation, so the old
  handle's token is refused.
- The holder renews every `heartbeatMs` in the Scope that acquired it; `heartbeatMs × 2` must not exceed `ttlMs`.
  Closing the Scope stops the heartbeat and releases the lease.
- A holder on the same host whose process is gone (or whose pid now belongs to another process) is taken over at
  once. A holder that is alive but stopped renewing is taken over after the TTL, measured by the observer's own
  monotonic clock from the moment it first saw the current record.
- `runFenced` holds the store's per-key fence and re-reads the record before the work starts; waiting for the fence
  stops when the lease is lost. The fence is released when the work's fiber ends, so a successor's fenced work starts
  after that. An interrupted fiber ends at once, but a Promise it started keeps running: put a write that cannot be
  cancelled in `Effect.uninterruptible` (the fence then waits for it to settle), or pass it the AbortSignal that
  `Effect.tryPromise` provides and let it settle only once the write has stopped.
- Guard plus re-read is as strong as a check by the protected resource itself only when every writer goes through
  the same store on the same machine; a resource that can compare atomically should keep the highest token it has
  seen and call `checkFence`.
- `sqliteLeaseStore` compares revisions inside `BEGIN IMMEDIATE` transactions. `fileLeaseStore` is the fallback
  without SQLite: one JSON file per key, written under a per-key lock file. `memoryLeaseStore` serves one process.

Expected failures are typed values with a `_tag`: `LeaseHeld`, `LeaseLost`, `FenceRejected`, `LeaseConfigInvalid`
and `LeaseStoreFailure`. The kit runs no Effect itself; run the program at your application's assembly root.

### Lanes

```ts
import { createLanes } from "@rivus/agent-kit-collab/lanes";
import { Effect } from "effect";

const program = Effect.scoped(
  Effect.gen(function* () {
    const lanes = yield* createLanes({
      maxConcurrent: 4, // activations running at once across all keys
      maxQueued: 32, // keys waiting for a free slot
      turnTimeoutMs: 600_000, // an activation running longer is interrupted
      activate: (key) => runTurn(key), // the work for one key, in a Scope of its own
      onExit: (exit) => report(exit) // ActivationSucceeded | ActivationFailed | ActivationInterrupted
    });
    yield* lanes.wake("room:1"); // "started", "queued" or "coalesced"; never waits for the activation
    // ... closing the Scope interrupts the running activations and waits for them.
  })
);
```

- A lane runs at most one activation at a time. Every wake that arrives before an activation starts is served by
  it: waking a running lane any number of times leaves one activation to follow the running one, and waking a
  queued lane changes nothing.
- An idle lane starts while a slot is free and nobody waits; otherwise it waits at the end of the queue, and when
  `maxQueued` lanes already wait, `wake` fails with `LaneQueueFull`. A freed slot goes to the lane that has waited
  longest, so a lane woken again while it ran waits behind the lanes queued meanwhile. Without `maxQueued`, the queue
  holds at most one entry per key.
- `cancel(key)` drops the wakes the key owes and interrupts its running activation, and returns once the activation
  has ended (its finalizers and `onExit` included). `close` refuses later wakes with `LanesClosed`, drops the queue,
  interrupts every running activation and waits for them; closing the Scope that created the lanes runs it.
- An activation runs with the context `createLanes` ran in. Its Scope closes when it ends, and the lane moves on only
  after that: an interrupted activation's finalizers have run before the next activation of any key takes its slot.
- `onExit` hears how each activation ended. One that succeeded or failed by itself is reported so even when a cancel,
  close or timeout arrives while its Scope closes; `ActivationInterrupted` means the lanes cut it short, or stopped it
  before it started, in which case `activate` was never called. `onExit` runs uninterruptibly, so `cancel` and `close`
  wait for it; it must not wait for them in turn, and a defect it raises is logged as a warning.

Nothing is persisted: lanes live in one process. Expected failures are typed values with a `_tag`:
`LaneQueueFull`, `LanesClosed` and `LanesConfigInvalid`.

## License

MIT
