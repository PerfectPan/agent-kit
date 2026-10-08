import { isEqual } from "es-toolkit";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

/**
 * The part of an aggregate repository's calling convention that every aggregate shares: `load` reads the stored
 * snapshot or `undefined`, and `save` writes atomically only over the revision it is shown, failing with a
 * `RevisionConflict`-tagged error instead of writing when the stored revision differs. Aggregate-specific
 * operations, such as Lease's `fence` or Ledger's pre-image blobs, are outside this suite.
 */
export interface AggregateRepository<Id, S extends { readonly revision: number }> {
  load(id: Id): Effect.Effect<S | undefined, unknown>;
  save(id: Id, snapshot: S, expectedRevision: number | undefined): Effect.Effect<void, unknown>;
}

/** One open repository over a storage location, with what the conformance cases reach for besides it. */
export interface AggregateRepositorySession<Id, S extends { readonly revision: number }> {
  readonly repository: AggregateRepository<Id, S>;
  /**
   * Bypassing the repository, replaces what the storage holds for the fixtures' id with a record of an unknown
   * schema version, as a newer version would leave it. Present only when the fixtures declare
   * `refusesUnknownSchemaVersion`.
   */
  readonly writeUnknownSchemaVersion?: () => Effect.Effect<void, unknown>;
}

export interface AggregateRepositoryFixtures<Id, S extends { readonly revision: number }> {
  /** The id every case stores under. */
  readonly id: Id;
  /** The snapshot stored for `revision`; the suite stores successive samples under increasing revisions. */
  readonly sample: (revision: number) => S;
  /**
   * Runs `steps` against one fresh storage location: the first step's repository creates it, and each later step
   * opens the same location again after the previous repository has closed, as the next process would. A step whose
   * repository cannot open the location fails the whole call; the unknown-schema case reads that as the refusal.
   */
  readonly open: <A>(
    steps: readonly ((session: AggregateRepositorySession<Id, S>) => Effect.Effect<A, unknown>)[]
  ) => Effect.Effect<readonly A[], unknown>;
  /** Whether the storage outlives the repository; the suite then also runs the reopen case. */
  readonly persistent: boolean;
  /**
   * Whether the storage carries a schema version that the repository refuses when it does not know it, so that the
   * sessions carry `writeUnknownSchemaVersion`; the suite then also runs the unknown-schema case. A storage without
   * a schema version, such as a process-local map, declares `false`.
   */
  readonly refusesUnknownSchemaVersion: boolean;
}

/** One named case; wire it into the test runner, for example `for (const c of cases) it.live(c.name, () => c.run)`. */
export interface AggregateRepositoryCase {
  readonly name: string;
  readonly run: Effect.Effect<void, Error>;
}

/**
 * The checks every aggregate repository implementation must pass, independent of a test runner. Generic cases run
 * for every implementation; the reopen case runs for a persistent one and the unknown-schema case for a storage
 * that carries a schema version.
 */
export function aggregateRepositoryConformance<Id, S extends { readonly revision: number }>(
  fixtures: AggregateRepositoryFixtures<Id, S>
): AggregateRepositoryCase[] {
  const { id, sample, open } = fixtures;
  const describeSnapshot = (snapshot: unknown): string => JSON.stringify(snapshot) ?? String(snapshot);
  const describeError = (error: unknown): string =>
    error instanceof Error ? error.message : (JSON.stringify(error) ?? String(error));

  /** Reports every failure of `effect` as an `Error`, so a case's error channel stays `Error`. */
  const asCase = (effect: Effect.Effect<void, unknown>): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(effect);
      if (Exit.isSuccess(exit)) {
        return;
      }
      const error = Cause.squash(exit.cause);
      return yield* Effect.fail(
        error instanceof Error ? error : new Error(`the fixtures failed: ${describeError(error)}`)
      );
    });

  /** The error a failed effect failed with, or `undefined` when it succeeded. */
  const errorOf = <A>(effect: Effect.Effect<A, unknown>): Effect.Effect<unknown, never> =>
    Effect.map(Effect.exit(effect), (exit) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined));

  const isConflict = (error: unknown): boolean =>
    typeof error === "object" && error !== null && (error as { readonly _tag?: unknown })._tag === "RevisionConflict";

  const cases: AggregateRepositoryCase[] = [];

  cases.push({
    name: "load of a missing id is undefined",
    run: Effect.suspend(() =>
      asCase(
        Effect.flatMap(open([(session) => session.repository.load(id)]), ([loaded]) =>
          loaded === undefined
            ? Effect.void
            : Effect.fail(new Error(`load returned ${describeSnapshot(loaded)}, not undefined`))
        )
      )
    )
  });

  cases.push({
    name: "the first save writes over no revision and reads back",
    run: Effect.suspend(() =>
      asCase(
        Effect.flatMap(
          open([
            (session) =>
              Effect.gen(function* () {
                yield* session.repository.save(id, sample(1), undefined);
                return yield* session.repository.load(id);
              })
          ]),
          ([stored]) =>
            isEqual(stored, sample(1))
              ? Effect.void
              : Effect.fail(new Error(`load returned ${describeSnapshot(stored)}, not the saved sample`))
        )
      )
    )
  });

  cases.push({
    name: "a save over a revision that is not the stored one fails with RevisionConflict and changes nothing",
    run: Effect.suspend(() =>
      asCase(
        Effect.flatMap(
          open([
            (session) =>
              Effect.gen(function* () {
                yield* session.repository.save(id, sample(1), undefined);
                const stale = yield* errorOf(session.repository.save(id, sample(2), 9));
                if (!isConflict(stale)) {
                  return yield* Effect.fail(new Error("a save over revision 9 did not fail with RevisionConflict"));
                }
                const missing = yield* errorOf(session.repository.save(id, sample(2), undefined));
                if (!isConflict(missing)) {
                  return yield* Effect.fail(
                    new Error("a save that requires no record did not fail with RevisionConflict")
                  );
                }
                return yield* session.repository.load(id);
              })
          ]),
          ([stored]) =>
            isEqual(stored, sample(1))
              ? Effect.void
              : Effect.fail(new Error(`the stored snapshot changed to ${describeSnapshot(stored)}`))
        )
      )
    )
  });

  cases.push({
    name: "revisions strictly increase while each save writes over the revision it read",
    run: Effect.suspend(() =>
      asCase(
        Effect.map(
          open([
            (session) =>
              Effect.gen(function* () {
                let expected: number | undefined;
                for (const revision of [1, 2, 3]) {
                  const saved = yield* errorOf(session.repository.save(id, sample(revision), expected));
                  if (saved !== undefined) {
                    return yield* Effect.fail(
                      new Error(`the save of revision ${revision} failed with ${describeError(saved)}`)
                    );
                  }
                  const stored = yield* session.repository.load(id);
                  if (
                    stored === undefined ||
                    stored.revision <= (expected ?? -1) ||
                    !isEqual(stored, sample(revision))
                  ) {
                    return yield* Effect.fail(
                      new Error(`load returned ${describeSnapshot(stored)} after revision ${revision}`)
                    );
                  }
                  expected = stored.revision;
                }
              })
          ]),
          () => undefined
        )
      )
    )
  });

  if (fixtures.persistent) {
    cases.push({
      name: "reads back what it wrote after the repository is reopened",
      run: Effect.suspend(() =>
        asCase(
          Effect.flatMap(
            open([
              (session) => session.repository.save(id, sample(7), undefined),
              (session) => session.repository.load(id)
            ]),
            (results) => {
              const stored = results[results.length - 1];
              return isEqual(stored, sample(7))
                ? Effect.void
                : Effect.fail(new Error(`the reopened repository read ${describeSnapshot(stored)}`));
            }
          )
        )
      )
    });
  }

  if (fixtures.refusesUnknownSchemaVersion) {
    cases.push({
      name: "refuses a record of an unknown schemaVersion and keeps it stored",
      run: Effect.gen(function* () {
        // Every step records its own outcome and cannot fail, so a failure of the whole call can only be a later
        // step's repository refusing to open the corrupted storage, which is the refusal for an implementation that
        // checks the schema when it opens. A repository that served the record instead would have opened.
        const problems: string[] = [];
        const served: string[] = [];
        const outcome = yield* Effect.exit(
          open([
            (session) =>
              Effect.gen(function* () {
                const saved = yield* Effect.exit(session.repository.save(id, sample(1), undefined));
                const corrupted = yield* Effect.exit(
                  session.writeUnknownSchemaVersion?.() ??
                    Effect.fail(new Error("the session has no writeUnknownSchemaVersion hook"))
                );
                if (Exit.isFailure(saved)) {
                  problems.push("the sample could not be stored");
                }
                if (Exit.isFailure(corrupted)) {
                  problems.push(`the storage could not be corrupted: ${String(Cause.squash(corrupted.cause))}`);
                }
              }),
            (session) =>
              Effect.gen(function* () {
                const read = yield* Effect.exit(session.repository.load(id));
                const written = yield* Effect.exit(session.repository.save(id, sample(2), 1));
                if (Exit.isSuccess(read)) {
                  served.push("read");
                }
                if (Exit.isSuccess(written)) {
                  served.push("written");
                }
              }),
            (session) =>
              Effect.gen(function* () {
                const read = yield* Effect.exit(session.repository.load(id));
                if (Exit.isSuccess(read)) {
                  served.push("kept-read");
                }
              })
          ])
        );
        if (problems.length > 0) {
          return yield* Effect.fail(new Error(problems.join("; ")));
        }
        if (Exit.isSuccess(outcome) && served.length > 0) {
          return yield* Effect.fail(
            new Error(
              `the repository served or overwrote the record of an unknown schemaVersion (${served.join(", ")})`
            )
          );
        }
        return Effect.void;
      })
    });
  }

  return cases;
}
