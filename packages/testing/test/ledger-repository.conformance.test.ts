import { LEDGER_SCHEMA_VERSION, type LedgerSnapshot } from "@rivus/agent-kit-harness";
import { FileLedgerRepositoryLive, LedgerRepository, type LedgerScope } from "@rivus/agent-kit-harness/public";
import type { Platform } from "@rivus/agent-kit-platform";
import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vite-plus/test";

import { aggregateRepositoryConformance, type AggregateRepositoryFixtures } from "../src/effect.js";
import { createMemoryPlatform } from "../src/memory-platform.js";

const SCOPE: LedgerScope = { key: "user", scope: "user" };
const LEDGER_PATH = "/state/agent-kit/harness/user/ledger.json";
const UNKNOWN_SCHEMA_VERSION = LEDGER_SCHEMA_VERSION + 1;

const sample = (revision: number): LedgerSnapshot => ({
  schemaVersion: LEDGER_SCHEMA_VERSION,
  lineage: "conformance",
  revision,
  entries: {},
  pending: []
});

const fixtures = (): AggregateRepositoryFixtures<LedgerScope, LedgerSnapshot> => ({
  id: SCOPE,
  sample,
  persistent: true,
  refusesUnknownSchemaVersion: true,
  open: (steps) => {
    // A fresh in-memory file system per case; every step provides its own Layer over the same platform, so it opens
    // the same storage again, as the next process would.
    const platform = createMemoryPlatform({ env: { XDG_STATE_HOME: "/state" }, home: "/u/me" });
    // The repository reads only `env`, `home` and `fs`, which the memory platform implements; `spawn` and `sqlite`
    // stay unreachable for it, as in the other tests that hand a partial platform to code typed as `Platform`.
    const service = platform as unknown as Platform;
    return Effect.forEach(steps, (step, index) =>
      Effect.flatMap(LedgerRepository, (repository) =>
        step({
          repository,
          ...(index === 0
            ? {
                // Bypassing the repository, replaces the ledger file with one of a schema version a newer kit
                // would have written.
                writeUnknownSchemaVersion: () =>
                  Effect.tryPromise(() =>
                    platform.fs.writeAtomic(
                      LEDGER_PATH,
                      `${JSON.stringify({ schemaVersion: UNKNOWN_SCHEMA_VERSION, lineage: "newer", entries: {} })}\n`
                    )
                  )
              }
            : {})
        })
      ).pipe(Effect.provide(FileLedgerRepositoryLive.pipe(Layer.provide(Layer.succeed(PlatformService, service)))))
    );
  }
});

describe("file ledger repository conformance", () => {
  for (const conformance of aggregateRepositoryConformance(fixtures())) {
    it(`${conformance.name}`, async () => {
      await expect(Effect.runPromise(conformance.run)).resolves.toBeUndefined();
    });
  }
});
