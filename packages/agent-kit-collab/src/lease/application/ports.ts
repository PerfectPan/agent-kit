import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { LeaseSnapshot } from "../domain/lease/index.js";

/**
 * Another writer wrote over the revision a `save` was conditioned on, so it wrote nothing. Declared here, next to
 * the port; other contexts declare their own.
 */
export interface RevisionConflict {
  readonly _tag: "RevisionConflict";
  readonly key: string;
  /** The revision the save was conditioned on; `undefined` when it required the record not to exist. */
  readonly expectedRevision: number | undefined;
  /** The revision the stored record had when the save compared it; `undefined` when there was none. */
  readonly storedRevision: number | undefined;
}

/** The repository could not read or write a record; the lease's state is unknown, not changed. */
export interface LeaseRepositoryFailure {
  readonly _tag: "LeaseRepositoryFailure";
  readonly key: string;
  /**
   * `busy`: other writers kept the repository locked; `invalid-record`: a stored record is unreadable or breaks the
   * invariants and is left as it is; `unsupported-schema`: the repository was written by a newer version;
   * `unavailable`: the platform lacks what the repository needs; `io`: any other failure.
   */
  readonly reason: "busy" | "io" | "invalid-record" | "unsupported-schema" | "unavailable";
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * Where lease records live. Calling convention for every implementation:
 *
 * - `load(key)` is the stored record, or `undefined` when there is none.
 * - `save(key, snapshot, expectedRevision)` writes atomically across every process that uses the same repository
 *   location: it writes only when the stored record's revision equals `expectedRevision` (`undefined`: no record),
 *   and fails with a `RevisionConflict` instead of writing when another writer moved the record first.
 * - Records are never deleted. A release writes a tombstone, so a key's generation never goes back.
 * - `fence(key)` holds one guard per key across those processes until its Scope closes; waiting for it can be
 *   interrupted, and a guard whose holder process exited is freed without waiting for a TTL.
 * - Only local directories are supported; neither SQLite's locks nor lock files are reliable on NFS.
 *
 * The lease's `runFenced` takes the guard and re-reads the holder before the work starts. That is equivalent to the
 * protected resource checking the fencing token itself only when every writer of the resource goes through the same
 * repository on the same machine; a resource that can compare atomically should also run `checkFence`.
 */
export interface LeaseRepositoryShape {
  load(key: string): Effect.Effect<LeaseSnapshot | undefined, LeaseRepositoryFailure>;
  save(
    key: string,
    snapshot: LeaseSnapshot,
    expectedRevision: number | undefined
  ): Effect.Effect<void, LeaseRepositoryFailure | RevisionConflict>;
  fence(key: string): Effect.Effect<void, LeaseRepositoryFailure, Scope.Scope>;
}

const KEY = "@rivus/agent-kit-collab/lease/LeaseRepository/v1";

// isolatedDeclarations rejects a call expression in `extends`, so the generated base class gets an explicit type.
const LeaseRepositoryBase: Context.ServiceClass<LeaseRepository, typeof KEY, LeaseRepositoryShape> = Context.Service<
  LeaseRepository,
  LeaseRepositoryShape
>()(KEY);

/** The lease repository port; `sqliteLeaseRepository`, `fileLeaseRepository` and `memoryLeaseRepository` provide it. */
export class LeaseRepository extends LeaseRepositoryBase {}
