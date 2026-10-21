import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { LedgerRepository } from "../src/application/ports.js";
import { loadLedger } from "../src/application/services/ledger-session.js";
import type { LedgerSnapshot } from "../src/domain/ledger/aggregates/ledger.js";

const scope = { key: "user", scope: "user" } as const;
const snapshot = { schemaVersion: 1, lineage: "fixture", revision: 0, entries: {}, pending: [] };

describe("loadLedger", () => {
  it.effect.each([
    ["null snapshot", null],
    ["array snapshot", []],
    ["non-object snapshot", "invalid"],
    ["null entries", { ...snapshot, entries: null }],
    ["array entries", { ...snapshot, entries: [] }],
    ["non-object entries", { ...snapshot, entries: 1 }],
    ["null pending", { ...snapshot, pending: null }],
    ["object pending", { ...snapshot, pending: {} }],
    ["non-object pending", { ...snapshot, pending: "invalid" }]
  ])("rejects an external repository's %s as InvalidLedger", (_, value) =>
    Effect.gen(function* () {
      expect(yield* Effect.exit(loadLedger(scope))).toEqual(
        Exit.fail({ _tag: "InvalidLedger", reason: "entries or pending are missing" })
      );
    }).pipe(
      Effect.provideService(LedgerRepository, {
        // Simulate a JavaScript repository that does not honor the port's declared return type.
        load: () => Effect.succeed(value as unknown as LedgerSnapshot),
        save: () => Effect.die("unexpected save"),
        putPreImage: () => Effect.die("unexpected putPreImage"),
        getPreImage: () => Effect.die("unexpected getPreImage")
      })
    )
  );
});
