import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { LeaseSnapshot } from "../domain/lease/index.js";

/** The store could not read or write a record; the lease's state is unknown, not changed. */
export interface LeaseStoreFailure {
  readonly _tag: "LeaseStoreFailure";
  readonly key: string;
  /**
   * `busy`: other writers kept the store locked; `invalid-record`: a stored record is unreadable or breaks the
   * invariants and is left as it is; `unsupported-schema`: the store was written by a newer version; `unavailable`:
   * the platform lacks what the store needs; `io`: any other failure.
   */
  readonly reason: "busy" | "io" | "invalid-record" | "unsupported-schema" | "unavailable";
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * Where lease records live. Calling convention for every implementation:
 *
 * - `compareAndSet` is atomic across every process that uses the same store location: it writes `next` only when the
 *   stored record's revision equals `expected` (`undefined`: no record), and reports whether it wrote.
 * - Records are never deleted. A release writes a tombstone, so a key's generation never goes back.
 * - `fence(key)` holds one guard per key across those processes until its Scope closes; waiting for it can be
 *   interrupted, and a guard whose holder process exited is freed without waiting for a TTL.
 * - Only local directories are supported; neither SQLite's locks nor lock files are reliable on NFS.
 *
 * The lease's `runFenced` takes the guard and re-reads the holder before the work starts. That is equivalent to the
 * protected resource checking the fencing token itself only when every writer of the resource goes through the same
 * store on the same machine; a resource that can compare atomically should also run `checkFence`.
 */
export interface LeaseStoreShape {
  read(key: string): Effect.Effect<LeaseSnapshot | undefined, LeaseStoreFailure>;
  compareAndSet(
    key: string,
    expected: number | undefined,
    next: LeaseSnapshot
  ): Effect.Effect<boolean, LeaseStoreFailure>;
  fence(key: string): Effect.Effect<void, LeaseStoreFailure, Scope.Scope>;
}

const KEY = "@rivus/agent-kit-collab/lease/LeaseStore/v1";

// isolatedDeclarations rejects a call expression in `extends`, so the generated base class gets an explicit type.
const LeaseStoreBase: Context.ServiceClass<LeaseStore, typeof KEY, LeaseStoreShape> = Context.Service<
  LeaseStore,
  LeaseStoreShape
>()(KEY);

/** The lease store port; `sqliteLeaseStore`, `fileLeaseStore` and `memoryLeaseStore` provide it. */
export class LeaseStore extends LeaseStoreBase {}
