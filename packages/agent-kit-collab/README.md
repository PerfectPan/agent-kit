# @rivus/agent-kit-collab

Collaboration primitives for processes that run coding agents side by side: a lease with fencing tokens, so that
one process at a time owns a task and a stale owner's writes are refused, and a single-instance process lock. The
package knows no particular agent; it reaches files, processes, clocks and SQLite through the `Platform` of
[`@rivus/agent-kit`](https://www.npmjs.com/package/@rivus/agent-kit).

Status: 0.x, released in lockstep with `@rivus/agent-kit` (same version). A minor release may contain breaking
changes.

## Install

```bash
npm install @rivus/agent-kit @rivus/agent-kit-collab
# for /lease, which is an Effect entry:
npm install effect@4.0.1
```

`@rivus/agent-kit` is a peer dependency, so the process holds one copy of the platform types. `effect` 4.0.1 is an
optional peer that only `/lease` needs. ESM only, no side effects, Node.js 22.13 or later on darwin or linux (the
locks identify processes by boot id, pid and start time, which the platform does not support on win32). Every
lock supports local directories only; neither SQLite's locks nor lock files are reliable on NFS. Holders are judged
by host name, boot id, pid and start time, so all processes that share a lock must see one process table: containers
that share the host's name and kernel but not its PID namespace are not supported, and a host renamed while it holds
locks makes its holders look remote (judged by the TTL alone; a lock file of a dead holder then stays until removed).

## Entries

| Entry                                  | Main exports                                                                                                                                                                    | Kind     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `@rivus/agent-kit-collab/process-lock` | `acquireProcessLock`, `ProcessLock`, `ProcessLockHeld`                                                                                                                          | plain TS |
| `@rivus/agent-kit-collab/lease`        | `createLeaseManager`, `LeaseStore`, `sqliteLeaseStore`, `fileLeaseStore`, `memoryLeaseStore`; rules `isFresh`, `canAcquire`, `nextFencingToken`, `checkFence`, `holderLiveness` | Effect   |

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

## License

MIT
