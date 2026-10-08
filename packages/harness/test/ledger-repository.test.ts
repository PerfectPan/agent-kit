import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { LedgerRepository } from "../src/application/ports.js";
import { Ledger, LEDGER_SCHEMA_VERSION } from "../src/domain/ledger/index.js";
import { removeTestHomes, testHome } from "./support/home.js";

afterEach(removeTestHomes);

const scope = { key: "user", scope: "user" } as const;

describe("FileLedgerRepositoryLive", () => {
  it.effect(
    "keeps ledgers under XDG_STATE_HOME, reads back what it wrote, and refuses a write over another revision",
    () => {
      const home = testHome({ XDG_STATE_HOME: "" });
      const state = home.path("state");
      const platform = { ...home.platform, env: { ...home.env, XDG_STATE_HOME: state } };
      return Effect.gen(function* () {
        const repository = yield* LedgerRepository;
        expect(yield* repository.load(scope)).toBeUndefined();
        const ledger = Ledger.create("lineage-1");
        if (!ledger.ok) {
          throw new Error("create failed");
        }
        yield* repository.save(scope, ledger.value.toSnapshot(), undefined);
        expect(JSON.parse(readFileSync(`${state}/agent-kit/harness/user/ledger.json`, "utf8"))).toMatchObject({
          lineage: "lineage-1",
          revision: 0
        });
        expect(yield* repository.load(scope)).toEqual(ledger.value.toSnapshot());
        expect(yield* Effect.flip(repository.save(scope, ledger.value.toSnapshot(), 3))).toEqual({
          _tag: "RevisionConflict",
          scope: "user",
          expected: 3,
          stored: 0
        });
        expect(yield* Effect.flip(repository.save(scope, ledger.value.toSnapshot(), undefined))).toMatchObject({
          _tag: "RevisionConflict",
          stored: 0
        });
        const blob = yield* repository.putPreImage(scope, { "SKILL.md": "before" });
        expect(yield* repository.getPreImage(scope, blob)).toEqual({ "SKILL.md": "before" });
      }).pipe(Effect.provide(home.layer(platform)));
    }
  );

  it.effect("refuses a ledger of an unknown schema version and never writes over it", () => {
    const home = testHome();
    const stored = `${JSON.stringify({ schemaVersion: LEDGER_SCHEMA_VERSION + 1, lineage: "newer", entries: "?" })}\n`;
    home.write(".local/state/agent-kit/harness/user/ledger.json", stored);
    return Effect.gen(function* () {
      const repository = yield* LedgerRepository;
      expect(yield* Effect.flip(repository.load(scope))).toMatchObject({
        _tag: "LedgerVersionUnsupported",
        schemaVersion: LEDGER_SCHEMA_VERSION + 1
      });
      const ledger = Ledger.create("mine");
      expect(
        yield* Effect.flip(
          repository.save(scope, ledger.ok ? ledger.value.toSnapshot() : (undefined as never), undefined)
        )
      ).toMatchObject({
        _tag: "LedgerVersionUnsupported"
      });
      expect(home.read(".local/state/agent-kit/harness/user/ledger.json")).toBe(stored);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("refuses a ledger whose shape is wrong without clearing it", () => {
    const home = testHome();
    const stored = `${JSON.stringify({ schemaVersion: LEDGER_SCHEMA_VERSION, lineage: "x", revision: 1, entries: [], pending: [] })}\n`;
    home.write(".local/state/agent-kit/harness/user/ledger.json", stored);
    return Effect.gen(function* () {
      expect(yield* Effect.flip((yield* LedgerRepository).load(scope))).toMatchObject({ _tag: "InvalidLedger" });
      expect(home.read(".local/state/agent-kit/harness/user/ledger.json")).toBe(stored);
    }).pipe(Effect.provide(home.layer()));
  });
});
