import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { findNodeAtLocation, parseTree } from "jsonc-parser";

import { LedgerLock } from "../src/application/ports.js";
import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { planInstall } from "../src/application/use-cases/plan-install.js";
import { verify } from "../src/application/use-cases/verify.js";
import type { Bundle } from "../src/domain/bundle/index.js";
import { type ArtifactLocator, locatorKey } from "../src/domain/install-plan/index.js";
import type { LedgerSnapshot } from "../src/domain/ledger/index.js";
import { decodeLedger, encodeLedger } from "../src/infra/models/ledger-file.js";
import { demoBundle, SHIM } from "./support/bundles.js";
import { removeTestHomes, testHome, type TestHome } from "./support/home.js";

afterEach(removeTestHomes);

const LEDGER_FILE = ".local/state/agent-kit/harness/user/ledger.json";
const CLAUDE_PLUGIN = ".claude/skills/demo-app";
const GROK_HOOKS = ".grok/hooks/demo-app.json";

function hooksBundle(version = "1.0.0", timeoutSeconds = 5): Bundle {
  return demoBundle(version, {
    artifacts: [
      {
        type: "hooks",
        command: SHIM,
        timeoutSeconds,
        events: { "claude-code": ["Stop"], grok: ["Stop"] }
      }
    ],
    legacyMarkers: []
  });
}

function isolatedPlatform(home: TestHome): typeof home.platform {
  return {
    ...home.platform,
    clock: { now: () => 0, monotonic: () => 0 },
    process: {
      run: () => Promise.reject(new Error("Unexpected external command")),
      spawn: () => {
        throw new Error("Unexpected external command");
      },
      self: { host: "test", bootId: "test", pid: 1, startTime: 0 },
      identify: () => undefined
    }
  };
}

function ledgerSnapshot(home: TestHome): LedgerSnapshot {
  const decoded = decodeLedger(readFileSync(home.path(LEDGER_FILE), "utf8"));
  if (!decoded.ok) {
    throw new Error("Invalid ledger fixture");
  }
  return decoded.value;
}

function entryBytes(home: TestHome, locator: ArtifactLocator): Buffer {
  const text = readFileSync(home.path(LEDGER_FILE), "utf8");
  const tree = parseTree(text);
  const node = tree === undefined ? undefined : findNodeAtLocation(tree, ["entries", locatorKey(locator)]);
  if (node === undefined) {
    throw new Error("Missing ledger entry in fixture");
  }
  return Buffer.from(text.slice(node.offset, node.offset + node.length), "utf8");
}

function advanceClaudeHooks(home: TestHome): void {
  const file = `${CLAUDE_PLUGIN}/hooks/hooks.json`;
  home.write(file, readFileSync(home.path(file), "utf8").replace('"timeout": 5', '"timeout": 10'));
}

describe("verify agent scope", () => {
  it.effect.each(["in-sync", "ledger-behind"] as const)(
    "compares only Claude Code and preserves Grok's ledger bytes when Claude Code is %s",
    (state) => {
      const home = testHome();
      return Effect.gen(function* () {
        yield* applyInstall(yield* planInstall(hooksBundle(), { agents: ["claude-code", "grok"] }));
        const grok = { kind: "file", path: home.path(GROK_HOOKS) } as const;
        const claude = { kind: "dir", path: home.path(CLAUDE_PLUGIN) } as const;
        const before = readFileSync(home.path(LEDGER_FILE));
        const grokBefore = entryBytes(home, grok);
        const revision = ledgerSnapshot(home).revision;
        if (state === "ledger-behind") {
          advanceClaudeHooks(home);
        }

        const report = yield* verify("demo-app", {
          agents: ["claude-code"],
          bundle: state === "ledger-behind" ? hooksBundle("2.0.0", 10) : hooksBundle()
        });

        expect(report.artifacts).toEqual([{ locator: claude, agents: ["claude-code"], status: "in-sync" }]);
        expect(report.acknowledged).toEqual(state === "ledger-behind" ? [claude] : []);
        expect(entryBytes(home, grok)).toEqual(grokBefore);
        expect(ledgerSnapshot(home).revision).toBe(revision + (state === "ledger-behind" ? 1 : 0));
        if (state === "in-sync") {
          expect(readFileSync(home.path(LEDGER_FILE))).toEqual(before);
        }
      }).pipe(Effect.provide(home.layer(isolatedPlatform(home))));
    }
  );

  it.effect("rechecks agent ownership under the lock before acknowledging a ledger-behind entry", () => {
    const home = testHome();
    let atLock: (() => void) | undefined;
    const lock = Layer.succeed(LedgerLock, {
      acquire: () => Effect.sync(() => atLock?.()),
      holder: () => Effect.succeed(undefined as string | undefined)
    });
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(hooksBundle(), { agents: ["claude-code", "grok"] }));
      advanceClaudeHooks(home);
      const claude = { kind: "dir", path: home.path(CLAUDE_PLUGIN) } as const;
      const grok = { kind: "file", path: home.path(GROK_HOOKS) } as const;
      const grokBefore = entryBytes(home, grok);
      let changedEntry: Buffer | undefined;
      let changedLedger: Buffer | undefined;
      atLock = () => {
        const snapshot = ledgerSnapshot(home);
        const key = locatorKey(claude);
        const entry = snapshot.entries[key];
        if (entry === undefined) {
          throw new Error("Missing Claude Code fixture");
        }
        // A writer that held the lock first handed this artifact to another agent.
        home.write(
          LEDGER_FILE,
          encodeLedger({
            ...snapshot,
            revision: snapshot.revision + 1,
            entries: {
              ...snapshot.entries,
              [key]: { ...entry, agents: ["grok"], entryRevision: snapshot.revision + 1 }
            }
          })
        );
        changedEntry = entryBytes(home, claude);
        changedLedger = readFileSync(home.path(LEDGER_FILE));
      };

      const report = yield* verify("demo-app", { agents: ["claude-code"], bundle: hooksBundle("2.0.0", 10) });

      expect(changedEntry).toBeDefined();
      expect(report.artifacts).toEqual([{ locator: claude, agents: ["claude-code"], status: "ledger-behind" }]);
      expect(report.acknowledged).toEqual([]);
      expect(entryBytes(home, claude)).toEqual(changedEntry);
      expect(entryBytes(home, grok)).toEqual(grokBefore);
      expect(readFileSync(home.path(LEDGER_FILE))).toEqual(changedLedger);
    }).pipe(Effect.provide(Layer.merge(home.layer(isolatedPlatform(home)), lock)));
  });

  it.effect.each(["gemini-cli", "grok"] as const)("includes a shared entry when selecting %s alone", (agent) => {
    const home = testHome();
    const bundle = demoBundle("1.0.0", {
      artifacts: [{ type: "skill", name: "demo-skill", files: { "SKILL.md": "shared skill\n" } }],
      legacyMarkers: []
    });
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(bundle, { agents: ["claude-code", "gemini-cli", "grok"] }));
      const before = readFileSync(home.path(LEDGER_FILE));

      const report = yield* verify("demo-app", { agents: [agent], bundle });

      expect(report.artifacts).toEqual([
        {
          locator: { kind: "dir", path: home.path(".agents/skills/demo-skill") },
          agents: ["gemini-cli", "grok"],
          status: "in-sync"
        }
      ]);
      expect(report.acknowledged).toEqual([]);
      expect(readFileSync(home.path(LEDGER_FILE))).toEqual(before);
    }).pipe(Effect.provide(home.layer(isolatedPlatform(home))));
  });

  it.effect("keeps all owner entries in the report when agents is omitted", () => {
    const home = testHome();
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(hooksBundle(), { agents: ["claude-code", "grok"] }));
      home.write(GROK_HOOKS, "{}\n");
      const before = readFileSync(home.path(LEDGER_FILE));

      const report = yield* verify("demo-app", { bundle: hooksBundle() });

      expect(report.artifacts).toEqual([
        {
          locator: { kind: "dir", path: home.path(CLAUDE_PLUGIN) },
          agents: ["claude-code"],
          status: "in-sync"
        },
        { locator: { kind: "file", path: home.path(GROK_HOOKS) }, agents: ["grok"], status: "user-modified" }
      ]);
      expect(report.acknowledged).toEqual([]);
      expect(readFileSync(home.path(LEDGER_FILE))).toEqual(before);
    }).pipe(Effect.provide(home.layer(isolatedPlatform(home))));
  });

  it.effect("scopes ledger-only verification without a bundle", () => {
    const home = testHome();
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(hooksBundle(), { agents: ["claude-code", "grok"] }));
      home.write(GROK_HOOKS, "{}\n");
      const before = readFileSync(home.path(LEDGER_FILE));

      const report = yield* verify("demo-app", { agents: ["claude-code"] });

      expect(report.artifacts).toEqual([
        {
          locator: { kind: "dir", path: home.path(CLAUDE_PLUGIN) },
          agents: ["claude-code"],
          status: "in-sync"
        }
      ]);
      expect(report.acknowledged).toEqual([]);
      expect(readFileSync(home.path(LEDGER_FILE))).toEqual(before);
    }).pipe(Effect.provide(home.layer(isolatedPlatform(home))));
  });

  it.effect("reports and acknowledges nothing when agents is empty", () => {
    const home = testHome();
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(hooksBundle(), { agents: ["claude-code", "grok"] }));
      advanceClaudeHooks(home);
      const before = readFileSync(home.path(LEDGER_FILE));

      const report = yield* verify("demo-app", { agents: [], bundle: hooksBundle("2.0.0", 10) });

      expect(report).toEqual({ artifacts: [], acknowledged: [] });
      expect(readFileSync(home.path(LEDGER_FILE))).toEqual(before);
    }).pipe(Effect.provide(home.layer(isolatedPlatform(home))));
  });
});
