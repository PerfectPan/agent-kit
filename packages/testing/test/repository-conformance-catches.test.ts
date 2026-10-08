import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, expect, it } from "vitest";

import {
  aggregateRepositoryConformance,
  type AggregateRepository,
  type AggregateRepositoryFixtures,
  type AggregateRepositorySession
} from "../src/effect.js";

// Each broken repository differs from the correct one in a single way; the named check must reject it.

interface Snapshot {
  readonly key: string;
  readonly revision: number;
}

const KEY = "task:1";
const SCHEMA_VERSION = 1;

const sample = (revision: number): Snapshot => ({ key: KEY, revision });

interface Envelope {
  readonly schemaVersion: number;
  readonly snapshot: Snapshot;
}

/** How the broken repositories write when a correct one refuses. */
type Defect = "no-comparison" | "compares-too-loosely" | "write-then-conflict" | "ignores-schema";

const conflict = (expectedRevision: number | undefined, storedRevision: number | undefined): Error =>
  Object.assign(new Error("conflict"), { _tag: "RevisionConflict", expectedRevision, storedRevision });

const unsupportedSchema = (): Error => Object.assign(new Error("unsupported schema"), { _tag: "UnsupportedSchema" });

function makeStore(defect: Defect | undefined) {
  const records = new Map<string, Envelope>();
  const repository: AggregateRepository<string, Snapshot> = {
    load: (id) =>
      Effect.suspend(() => {
        const stored = records.get(id);
        if (stored === undefined) {
          return Effect.succeed(undefined);
        }
        // A correct repository refuses a record of an unknown schema version; only the schema-ignoring one serves it.
        if (stored.schemaVersion !== SCHEMA_VERSION && defect !== "ignores-schema") {
          return Effect.fail(unsupportedSchema());
        }
        return Effect.succeed(stored.snapshot);
      }),
    save: (id, snapshot, expectedRevision) =>
      Effect.suspend(() => {
        const stored = records.get(id);
        const storedRevision = stored?.snapshot.revision;
        if (stored !== undefined && stored.schemaVersion !== SCHEMA_VERSION && defect !== "ignores-schema") {
          return Effect.fail(unsupportedSchema());
        }
        const write = () => {
          records.set(id, { schemaVersion: SCHEMA_VERSION, snapshot });
        };
        // The ways a repository can get compare-and-set wrong.
        if (defect === "no-comparison") {
          write();
          return Effect.void;
        }
        if (
          defect === "compares-too-loosely" &&
          (expectedRevision === undefined || expectedRevision <= (storedRevision ?? -1))
        ) {
          write();
          return Effect.void;
        }
        if (storedRevision !== expectedRevision) {
          return Effect.fail(conflict(expectedRevision, storedRevision));
        }
        write();
        return defect === "write-then-conflict" ? Effect.fail(conflict(expectedRevision, storedRevision)) : Effect.void;
      })
  };
  const writeUnknownSchemaVersion = () =>
    Effect.sync(() => {
      records.set(KEY, { schemaVersion: SCHEMA_VERSION + 1, snapshot: sample(1) });
    });
  return { repository, writeUnknownSchemaVersion };
}

function fixturesFor(defect: Defect | undefined): AggregateRepositoryFixtures<string, Snapshot> {
  const { repository, writeUnknownSchemaVersion } = makeStore(defect);
  return {
    id: KEY,
    sample,
    persistent: false,
    refusesUnknownSchemaVersion: defect === undefined || defect === "ignores-schema",
    open: <A>(
      steps: readonly ((session: AggregateRepositorySession<string, Snapshot>) => Effect.Effect<A, unknown>)[]
    ) =>
      // One in-memory storage serves every step; there is nothing to reopen.
      Effect.forEach(steps, (step) => step({ repository, writeUnknownSchemaVersion }))
  };
}

async function outcome(defect: Defect | undefined, name: string): Promise<string> {
  const check = aggregateRepositoryConformance(fixturesFor(defect)).find((candidate) => candidate.name === name);
  expect(check).toBeDefined();
  const exit = await Effect.runPromiseExit(check!.run);
  if (Exit.isSuccess(exit)) {
    return "passed";
  }
  const error = Cause.squash(exit.cause);
  return error instanceof Error ? error.message : "failed";
}

describe("aggregateRepositoryConformance", () => {
  const correct = aggregateRepositoryConformance(fixturesFor(undefined));

  it("passes every case for a correct repository", async () => {
    for (const check of correct) {
      expect(await outcome(undefined, check.name)).toBe("passed");
    }
  });

  it.each<[string, Defect, string, string]>([
    [
      "no comparison at all",
      "no-comparison",
      "a save over a stale revision fails with RevisionConflict and changes nothing",
      "did not fail with RevisionConflict"
    ],
    [
      "a comparison that is too loose",
      "compares-too-loosely",
      "a save over a stale revision fails with RevisionConflict and changes nothing",
      "did not fail with RevisionConflict"
    ],
    [
      "a write that reports a conflict",
      "write-then-conflict",
      "the first save writes over no revision and reads back",
      "conflict"
    ],
    [
      "a repository that serves an unknown schemaVersion",
      "ignores-schema",
      "refuses a record of an unknown schemaVersion and keeps it stored",
      "served or overwrote"
    ]
  ])("rejects %s through the check that owns it", async (_defect, mode, name, message) => {
    expect(await outcome(undefined, name)).toBe("passed");
    expect(await outcome(mode, name)).toContain(message);
  });
});
