import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, it } from "@effect/vitest";
import {
  aggregateRepositoryConformance,
  type AggregateRepositoryFixtures
} from "@rivus/agent-kit-testing/public/effect";
import * as Effect from "effect/Effect";

import { LeaseRepository, type LeaseSnapshot } from "../src/lease/public.js";
import { removeTempDirs } from "./support/platform.js";
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

describe.each(storeCases)("lease repository conformance with the $name repository", (storeCase) => {
  for (const conformance of aggregateRepositoryConformance(fixturesFor(storeCase))) {
    it.live(conformance.name, () => conformance.run);
  }
});
