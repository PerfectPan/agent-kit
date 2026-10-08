import { AgentKitError } from "@rivus/agent-kit/catalog";
import type { Platform } from "@rivus/agent-kit/platform";
import { PlatformService } from "@rivus/agent-kit/platform/effect";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";

import {
  type FenceRejected,
  type FencingToken,
  type Holder,
  type HolderLiveness,
  holderExpired,
  holderLiveness,
  isFresh,
  Lease,
  type LeaseConfigInvalid,
  type LeaseHeld,
  type LeaseHolding,
  type LeaseLost,
  type LeaseObservation,
  type LeaseSnapshot,
  type LeaseTiming,
  leaseTiming,
  type LeaseTransition,
  lossReason,
  observe
} from "../../domain/lease/index.js";
import { fromResult } from "../services/from-result.js";
import {
  LeaseRepository,
  type LeaseRepositoryFailure,
  type LeaseRepositoryShape,
  type RevisionConflict
} from "../ports.js";
import { repositoryFailure } from "../services/repository-failure.js";

export interface LeaseConfig {
  /** How long a lease stays valid without a renewal, as each observer's monotonic clock measures it. */
  readonly ttlMs: number;
  /** How often the holder renews. Two heartbeats must fit in the TTL, so one late heartbeat does not lose it. */
  readonly heartbeatMs: number;
  /** How often `acquire({ wait: true })` tries again; `heartbeatMs` by default. */
  readonly retryMs?: number;
}

export interface AcquireOptions {
  /**
   * Keep trying every `retryMs` while the lease is held or the repository is busy (a guard that stays locked),
   * instead of failing with `LeaseHeld` or a `busy` `LeaseRepositoryFailure`. The wait ends when the lease is taken,
   * on another repository failure, or when the fiber is interrupted.
   */
  readonly wait?: boolean;
}

/** A held lease. It belongs to the Scope `acquire` ran in: closing the Scope stops the heartbeat and releases it. */
export interface LeaseHandle {
  readonly key: string;
  readonly token: FencingToken;
  /**
   * Fails with `LeaseLost` once the heartbeat finds the lease taken over, released or missing, or cannot confirm a
   * renewal within the TTL; it never succeeds. Race other work against it to stop that work on loss.
   */
  readonly lost: Effect.Effect<never, LeaseLost>;
  /**
   * Runs `work` under the store's per-key fence, after re-reading that this acquisition still holds the lease, and
   * passes it the fencing token for the writes it makes. Waiting for the fence stops when the lease is lost. When the
   * lease is lost while `work` runs, `work` is interrupted and the result fails with `LeaseLost`.
   *
   * The fence is released when `work`'s fiber has ended, so a successor's fenced work starts only after that. An
   * interrupted fiber ends at once, though, while a Promise it started (`Effect.tryPromise`) keeps running: put a
   * write that cannot be cancelled in `Effect.uninterruptible`, which keeps the fence until the write settles, or pass
   * it the AbortSignal `tryPromise` provides and settle only after the write has stopped. A resource that can compare
   * atomically should also keep the highest token it has seen and refuse older ones with `checkFence`.
   */
  runFenced<A, E, R>(
    work: (token: FencingToken) => Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | LeaseLost | FenceRejected | LeaseRepositoryFailure, Exclude<R, Scope.Scope>>;
}

export interface LeaseManager {
  /**
   * Takes the lease for `key` in the caller's Scope and keeps renewing it there. Fails with `LeaseHeld` while a live
   * holder keeps it fresh; a dead holder (same host) is taken over at once, a silent one after the TTL. Throws an
   * `AgentKitError` (as a defect) for an empty key.
   */
  acquire(
    key: string,
    options?: AcquireOptions
  ): Effect.Effect<LeaseHandle, LeaseHeld | LeaseRepositoryFailure, Scope.Scope>;
  read(key: string): Effect.Effect<LeaseSnapshot | undefined, LeaseRepositoryFailure>;
}

type ManagerPlatform = Pick<Platform, "process" | "clock">;

/** CAS attempts within one acquisition before the store counts as busy; each lost race re-reads the record. */
const MAX_CAS_TURNS = 8;

/** Validates `config` and builds a manager over the `LeaseRepository` and the platform in context. */
export function createLeaseManager(
  config: LeaseConfig
): Effect.Effect<LeaseManager, LeaseConfigInvalid, LeaseRepository | PlatformService> {
  return Effect.gen(function* () {
    const timing = yield* fromResult(leaseTiming(config));
    return makeManager(timing, yield* LeaseRepository, yield* PlatformService);
  });
}

function makeManager(timing: LeaseTiming, store: LeaseRepositoryShape, platform: ManagerPlatform): LeaseManager {
  const observations = new Map<string, LeaseObservation>();
  const now = () => platform.clock.monotonic();
  const self = (): Holder => {
    const { host, bootId, pid, startTime } = platform.process.self;
    return { host, bootId, pid, startTime };
  };

  /** A holder that cannot be looked up (the platform failed to identify the pid) is judged by its TTL alone. */
  const judge = (holder: Holder, observer: Holder): Effect.Effect<HolderLiveness> =>
    Effect.try({
      try: () => holderLiveness(holder, observer, platform.process.identify(holder.pid)),
      catch: (cause) => cause
    }).pipe(Effect.orElseSucceed(() => "unknown" as const));

  /** One acquisition attempt: reads the record, applies the Lease rules, and writes over exactly that revision. */
  const take = (key: string, holderId: string) =>
    Effect.gen(function* () {
      for (let turn = 0; turn < MAX_CAS_TURNS; turn += 1) {
        const record = yield* store.load(key);
        const claim = { key, holder: self(), holderId, now: platform.clock.now() };
        let transition: LeaseTransition;
        if (record === undefined) {
          transition = Lease.create(claim);
        } else {
          const lease = yield* fromResult(Lease.restore(record)).pipe(
            Effect.mapError((invalid) => repositoryFailure(key, "invalid-record", invalid.message))
          );
          const at = now();
          const observation = observe(observations.get(key), record, at);
          observations.set(key, observation);
          const fresh = isFresh(record, observation, at, timing.ttlMs);
          // Liveness matters only for a fresh record: a stale one or a tombstone can be taken whoever holds it.
          const { holder } = record;
          const liveness = fresh && holder !== null ? yield* judge(holder, claim.holder) : "unknown";
          transition = yield* fromResult(lease.acquire(claim, { fresh, liveness }));
        }
        const next = transition.state.toSnapshot();
        const written = yield* Effect.exit(store.save(key, next, record?.revision));
        if (Exit.isSuccess(written)) {
          observations.delete(key);
          return next;
        }
        // A conflict is a lost race that the next turn re-reads; any other failure is the repository's.
        const error = Cause.squash(written.cause) as LeaseRepositoryFailure | RevisionConflict;
        if (error._tag !== "RevisionConflict") {
          return yield* Effect.fail(error);
        }
      }
      return yield* Effect.fail(repositoryFailure(key, "busy", "the lease record kept changing during acquisition"));
    });

  const lostBy = (key: string, holding: LeaseHolding) =>
    Effect.gen(function* () {
      const read = yield* Effect.exit(store.load(key));
      // A read that failed is classified like a lost race, not like a vanished record; that mapping stays here.
      const reason: LeaseLost["reason"] = Exit.isSuccess(read) ? lossReason(read.value) : "taken-over";
      return { _tag: "LeaseLost", key, generation: holding.generation, reason } satisfies LeaseLost;
    });

  /**
   * Renews every `heartbeatMs`. A refused write means another writer moved the record, so the lease is lost; a
   * repository failure is retried until no renewal has been confirmed for a TTL, after which an observer may take it
   * over. The write stays interruptible while it waits for the repository; `release` re-reads the record, so a
   * renewal interrupted between its write and `Ref.set` cannot keep the tombstone from being written.
   */
  const heartbeat = (key: string, holding: LeaseHolding, ref: Ref.Ref<LeaseSnapshot>) =>
    Effect.gen(function* () {
      let confirmedAt = now();
      for (;;) {
        yield* Effect.sleep(timing.heartbeatMs);
        const current = yield* Ref.get(ref);
        const restored = Lease.restore(current);
        const transition = restored.ok ? restored.value.renew(holding, platform.clock.now()) : undefined;
        if (transition?.ok !== true) {
          return yield* Effect.fail(yield* lostBy(key, holding));
        }
        const next = transition.value.state.toSnapshot();
        const written = yield* Effect.exit(
          store.save(key, next, current.revision).pipe(Effect.tap(() => Ref.set(ref, next)))
        );
        if (Exit.isSuccess(written)) {
          confirmedAt = now();
        } else {
          const error = Cause.squash(written.cause) as LeaseRepositoryFailure | RevisionConflict;
          if (error._tag === "RevisionConflict") {
            return yield* Effect.fail(yield* lostBy(key, holding));
          }
          if (holderExpired(confirmedAt, now(), timing.ttlMs)) {
            return yield* Effect.fail<LeaseLost>({
              _tag: "LeaseLost",
              key,
              generation: holding.generation,
              reason: "expired"
            });
          }
        }
      }
    });

  /**
   * Writes the tombstone over the record as read now, if it is still this acquisition's. A failure leaves the lease
   * to expire after the TTL; a finalizer cannot fail.
   */
  const release = (key: string, holding: LeaseHolding) =>
    Effect.gen(function* () {
      const current = yield* store.load(key);
      const restored = current === undefined ? undefined : Lease.restore(current);
      const transition = restored?.ok === true ? restored.value.release(holding, platform.clock.now()) : undefined;
      if (current !== undefined && transition?.ok === true) {
        yield* store.save(key, transition.value.state.toSnapshot(), current.revision);
      }
    }).pipe(Effect.ignore);

  const handle = (key: string, holding: LeaseHolding, lost: Deferred.Deferred<never, LeaseLost>): LeaseHandle => {
    const token: FencingToken = { key, generation: holding.generation };
    return {
      key,
      token,
      lost: Deferred.await(lost),
      runFenced: (work) =>
        Effect.scoped(
          Effect.gen(function* () {
            if (yield* Deferred.isDone(lost)) {
              return yield* Deferred.await(lost);
            }
            yield* store.fence(key).pipe(Effect.raceFirst(Deferred.await(lost)));
            const record = yield* store.load(key);
            const lease =
              record === undefined
                ? undefined
                : yield* fromResult(Lease.restore(record)).pipe(
                    Effect.mapError((invalid) => repositoryFailure(key, "invalid-record", invalid.message))
                  );
            if (lease?.holds(holding) !== true) {
              const current = record?.generation;
              return yield* Effect.fail<FenceRejected>({
                _tag: "FenceRejected",
                key,
                generation: token.generation,
                current
              });
            }
            return yield* Effect.raceFirst(work(token), Deferred.await(lost));
          })
        )
    };
  };

  return {
    acquire: (key, options = {}) => {
      if (key === "") {
        return Effect.die(new AgentKitError("invalid-lease-key", "A lease key must not be empty"));
      }
      const holderId = crypto.randomUUID();
      // The acquire step is uninterruptible and registers the release in the same step, so a lease is never taken
      // without its release; waiting happens between attempts, where interruption is safe.
      const attempt = Effect.acquireRelease(
        take(key, holderId).pipe(Effect.flatMap((snapshot) => Ref.make(snapshot))),
        (ref) => Effect.flatMap(Ref.get(ref), ({ generation }) => release(key, { holderId, generation }))
      );
      const acquired =
        options.wait === true
          ? attempt.pipe(
              Effect.retry({
                while: (error: LeaseHeld | LeaseRepositoryFailure) =>
                  error._tag === "LeaseHeld" || error.reason === "busy",
                schedule: Schedule.spaced(timing.retryMs)
              })
            )
          : attempt;
      return Effect.gen(function* () {
        const ref = yield* acquired;
        const { generation } = yield* Ref.get(ref);
        const holding: LeaseHolding = { holderId, generation };
        const lost = yield* Deferred.make<never, LeaseLost>();
        // Supervised: anything but interruption ends the heartbeat by completing `lost`, which interrupts fenced work.
        yield* Effect.forkScoped(
          heartbeat(key, holding, ref).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Deferred.failCause(lost, cause)
            )
          )
        );
        return handle(key, holding, lost);
      });
    },
    read: (key) => store.load(key)
  };
}
