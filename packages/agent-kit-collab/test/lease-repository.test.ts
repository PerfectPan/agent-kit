import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "@effect/vitest";
import { PlatformService } from "@rivus/agent-kit/platform/effect";
import { aggregateRepositoryConformance, type AggregateRepositoryFixtures } from "@rivus/agent-kit/testing/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  fileLeaseRepository,
  LeaseRepository,
  type LeaseSnapshot,
  sqliteLeaseRepository
} from "../src/lease/public.js";
import { isProcessLockHeld } from "../src/process-lock/public.js";
import { removeTempDirs, tempDir, testPlatform, withoutIdentity } from "./support/platform.js";
import { storeCases, type StoreCase } from "./support/stores.js";

const KEY = "task:1";
const UNKNOWN_SCHEMA_VERSION = 99;

afterEach(removeTempDirs);

const sample = (revision: number): LeaseSnapshot => ({
  key: KEY,
  generation: revision,
  revision,
  holder: null,
  holderId: null,
  renewedAt: 0
});

/** Replaces the record of `KEY` in the storage with one of a schema version this package does not know. */
function corruptSchema(storeCase: StoreCase, location: string): void {
  if (storeCase.name === "sqlite") {
    const db = new DatabaseSync(location);
    db.exec(`PRAGMA user_version = ${UNKNOWN_SCHEMA_VERSION}`);
    db.close();
    return;
  }
  writeFileSync(
    join(location, "task%3A1.lease.json"),
    JSON.stringify({ schemaVersion: UNKNOWN_SCHEMA_VERSION, record: {} })
  );
}

function fixturesFor(storeCase: StoreCase): AggregateRepositoryFixtures<string, LeaseSnapshot> {
  const { persistent, make } = storeCase;
  return {
    id: KEY,
    sample,
    persistent,
    refusesUnknownSchemaVersion: persistent,
    open: (steps) => {
      const { layer, reopen, location } = make();
      return Effect.forEach(steps, (step, index) =>
        Effect.flatMap(LeaseRepository, (store) =>
          step({
            repository: store,
            writeUnknownSchemaVersion:
              index === 0 && persistent ? () => Effect.sync(() => corruptSchema(storeCase, location)) : undefined
          })
        ).pipe(Effect.provide(index === 0 ? layer : reopen()))
      );
    }
  };
}

describe.each(storeCases)("lease repository conformance with the $name repository", (storeCase) => {
  for (const conformance of aggregateRepositoryConformance(fixturesFor(storeCase))) {
    it.live(conformance.name, () => conformance.run);
  }
});

describe("file lease record storage", () => {
  it.live("reports a stored record without its record field as an invalid record, not an unknown schema", () => {
    const dir = tempDir();
    writeFileSync(join(dir, `${encodeURIComponent(KEY)}.lease.json`), JSON.stringify({ schemaVersion: 1 }));
    return Effect.gen(function* () {
      const failure = yield* Effect.flip(Effect.flatMap(LeaseRepository, (store) => store.load(KEY)));
      expect(failure).toMatchObject({ _tag: "LeaseRepositoryFailure", reason: "invalid-record" });
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          fileLeaseRepository({ dir }),
          Layer.succeed(PlatformService, testPlatform({ sqlite: false }))
        )
      )
    );
  });
});

describe("lease fences when the process cannot read its identity", () => {
  it.live("S114: holds the SQLite repository's fence, a SQLite process lock, without a holder record", () => {
    const platform = testPlatform();
    const path = join(tempDir(), "leases.db");
    const fence = `${path}.${encodeURIComponent(KEY)}.fence`;
    const held = Effect.promise(() => isProcessLockHeld(platform, fence));
    return Effect.gen(function* () {
      const store = yield* LeaseRepository;
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* store.fence(KEY);
          expect(yield* held).toBe(true);
          expect(existsSync(`${fence}.holder`)).toBe(false);
        })
      );
      expect(yield* held).toBe(false);
    }).pipe(
      Effect.provide(
        Layer.provideMerge(sqliteLeaseRepository({ path }), Layer.succeed(PlatformService, withoutIdentity(platform)))
      )
    );
  });

  it.live("S114: fails the file repository's fence, a lock file, as io and leaves no file", () => {
    const dir = tempDir();
    return Effect.gen(function* () {
      const store = yield* LeaseRepository;
      const failure = yield* Effect.flip(Effect.scoped(store.fence(KEY)));
      expect(failure).toMatchObject({ _tag: "LeaseRepositoryFailure", reason: "io" });
      expect(readdirSync(dir)).toEqual([]);
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          fileLeaseRepository({ dir }),
          Layer.succeed(PlatformService, withoutIdentity(testPlatform({ sqlite: false })))
        )
      )
    );
  });
});
