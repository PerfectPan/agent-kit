import { writeFileSync } from "node:fs";

import { afterEach, describe, it } from "@effect/vitest";
import { aggregateRepositoryConformance, type AggregateRepositoryFixtures } from "@rivus/agent-kit/testing/effect";
import * as Effect from "effect/Effect";

import { LedgerRepository, type LedgerScope } from "../src/application/ports.js";
import { LEDGER_SCHEMA_VERSION, type LedgerSnapshot } from "../src/domain/ledger/index.js";
import { removeTestHomes, type TestHome, testHome } from "./support/home.js";

const scope: LedgerScope = { key: "user", scope: "user" };
const UNKNOWN_SCHEMA_VERSION = LEDGER_SCHEMA_VERSION + 1;

afterEach(removeTestHomes);

const sample = (revision: number): LedgerSnapshot => ({
  schemaVersion: LEDGER_SCHEMA_VERSION,
  lineage: "conformance",
  revision,
  entries: {},
  pending: []
});

/** Replaces the scope's ledger file with one of a schema version this package does not know, as a newer kit would. */
function corruptSchema(home: TestHome): void {
  writeFileSync(
    home.path(".local/state/agent-kit/harness/user/ledger.json"),
    `${JSON.stringify({ schemaVersion: UNKNOWN_SCHEMA_VERSION, lineage: "newer", entries: {} })}\n`
  );
}

const fixtures = (): AggregateRepositoryFixtures<LedgerScope, LedgerSnapshot> => ({
  id: scope,
  sample,
  persistent: true,
  refusesUnknownSchemaVersion: true,
  open: (steps) => {
    const home = testHome();
    // Every step provides a fresh Layer over the same home, so it opens the state directory again, as the next
    // process would.
    return Effect.forEach(steps, (step, index) =>
      Effect.flatMap(LedgerRepository, (repository) =>
        step({
          repository,
          ...(index === 0 ? { writeUnknownSchemaVersion: () => Effect.sync(() => corruptSchema(home)) } : {})
        })
      ).pipe(Effect.provide(home.layer()))
    );
  }
});

describe("file ledger repository conformance", () => {
  for (const conformance of aggregateRepositoryConformance(fixtures())) {
    it.live(conformance.name, () => conformance.run);
  }
});
