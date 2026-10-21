import { builtinInstallAdapters as testInstall } from "./support/providers.js";
import { builtinHookDialects as testHooks } from "./support/providers.js";
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { findNodeAtLocation, parseTree } from "jsonc-parser";

import { LedgerLock } from "../src/application/ports.js";
import { hashContent } from "../src/application/services/content-hash.js";
import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { planInstall } from "../src/application/use-cases/plan-install.js";
import { verify } from "../src/application/use-cases/verify.js";
import type { Bundle } from "../src/domain/bundle/value-objects/bundle.js";
import { type ArtifactLocator, locatorKey } from "../src/domain/install-plan/value-objects/artifact-locator.js";
import type { LedgerSnapshot } from "../src/domain/ledger/aggregates/ledger.js";
import { decodeLedger, encodeLedger } from "../src/infra/models/ledger-file.js";
import { demoBundle, SHIM } from "./support/bundles.js";
import { removeTestHomes, testHome, type TestHome } from "./support/home.js";

afterEach(removeTestHomes);

const LEDGER_FILE = ".local/state/agent-kit/harness/user/ledger.json";
const CLAUDE_PLUGIN = ".claude/skills/demo-app";
const GROK_HOOKS = ".grok/hooks/demo-app.json";
const SHARED_SKILL = ".agents/skills/demo-skill";

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

function skillsBundle(version = "1.0.0", text = "shared skill\n"): Bundle {
  return demoBundle(version, {
    artifacts: [{ type: "skill", name: "demo-skill", files: { "SKILL.md": text } }],
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

function storedEntryBytes(text: string, locator: ArtifactLocator): Buffer {
  const tree = parseTree(text);
  const node = tree === undefined ? undefined : findNodeAtLocation(tree, ["entries", locatorKey(locator)]);
  if (node === undefined) {
    throw new Error("Missing ledger entry in fixture");
  }
  return Buffer.from(text.slice(node.offset, node.offset + node.length), "utf8");
}

function entryBytes(home: TestHome, locator: ArtifactLocator): Buffer {
  return storedEntryBytes(readFileSync(home.path(LEDGER_FILE), "utf8"), locator);
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
        yield* applyInstall(
          yield* planInstall(hooksBundle(), {
            agents: ["claude-code", "grok"],
            providers: { install: testInstall, hooks: testHooks }
          })
        );
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
          bundle: state === "ledger-behind" ? hooksBundle("2.0.0", 10) : hooksBundle(),
          providers: { install: testInstall, hooks: testHooks }
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

  it.effect("acknowledges a still-desired locator after its recorded agents change under the lock", () => {
    const home = testHome();
    let atLock: (() => void) | undefined;
    const lock = Layer.succeed(LedgerLock, {
      acquire: () => Effect.sync(() => atLock?.()),
      holder: () => Effect.succeed(undefined as string | undefined)
    });
    return Effect.gen(function* () {
      yield* applyInstall(
        yield* planInstall(hooksBundle(), {
          agents: ["claude-code", "grok"],
          providers: { install: testInstall, hooks: testHooks }
        })
      );
      advanceClaudeHooks(home);
      const claude = { kind: "dir", path: home.path(CLAUDE_PLUGIN) } as const;
      const grok = { kind: "file", path: home.path(GROK_HOOKS) } as const;
      const grokBefore = entryBytes(home, grok);
      let changedEntry: Buffer | undefined;
      let changedSnapshot: LedgerSnapshot | undefined;
      atLock = () => {
        const snapshot = ledgerSnapshot(home);
        const key = locatorKey(claude);
        const entry = snapshot.entries[key];
        if (entry === undefined) {
          throw new Error("Missing Claude Code fixture");
        }
        // Another writer changed the recorded agent, but Claude Code still wants this locator.
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
        changedSnapshot = ledgerSnapshot(home);
      };

      const report = yield* verify("demo-app", {
        agents: ["claude-code"],
        bundle: hooksBundle("2.0.0", 10),
        providers: { install: testInstall, hooks: testHooks }
      });

      expect(changedEntry).toBeDefined();
      expect(report.artifacts).toEqual([{ locator: claude, agents: ["claude-code"], status: "in-sync" }]);
      expect(report.acknowledged).toEqual([claude]);
      expect(entryBytes(home, claude)).not.toEqual(changedEntry);
      expect(entryBytes(home, grok)).toEqual(grokBefore);
      if (changedSnapshot === undefined) {
        throw new Error("Expected a ledger change under the lock");
      }
      const after = ledgerSnapshot(home);
      const key = locatorKey(claude);
      expect(after.revision).toBe(changedSnapshot.revision + 1);
      expect(after.entries[key]).toEqual({
        ...changedSnapshot.entries[key],
        contentHash: expect.any(String),
        appliedAt: new Date(0).toISOString(),
        entryRevision: after.revision
      });
      expect(after.entries[key]?.contentHash).not.toBe(changedSnapshot.entries[key]?.contentHash);
    }).pipe(Effect.provide(Layer.merge(home.layer(isolatedPlatform(home)), lock)));
  });

  it.effect.each(["gemini-cli", "grok"] as const)("includes a shared entry when selecting %s alone", (agent) => {
    const home = testHome();
    const bundle = skillsBundle();
    return Effect.gen(function* () {
      yield* applyInstall(
        yield* planInstall(bundle, {
          agents: ["claude-code", "gemini-cli", "grok"],
          providers: { install: testInstall, hooks: testHooks }
        })
      );
      const before = readFileSync(home.path(LEDGER_FILE));

      const report = yield* verify("demo-app", {
        agents: [agent],
        bundle,
        providers: { install: testInstall, hooks: testHooks }
      });

      expect(report.artifacts).toEqual([
        {
          locator: { kind: "dir", path: home.path(SHARED_SKILL) },
          agents: ["gemini-cli", "grok"],
          status: "in-sync"
        }
      ]);
      expect(report.acknowledged).toEqual([]);
      expect(readFileSync(home.path(LEDGER_FILE))).toEqual(before);
    }).pipe(Effect.provide(home.layer(isolatedPlatform(home))));
  });

  it.effect.each(["in-sync", "outdated", "ledger-behind"] as const)(
    "compares a Gemini-only shared skill as %s when selecting Grok",
    (state) => {
      const home = testHome();
      return Effect.gen(function* () {
        const bundle = skillsBundle();
        yield* applyInstall(
          yield* planInstall(bundle, {
            agents: ["gemini-cli"],
            providers: { install: testInstall, hooks: testHooks }
          })
        );
        const shared = { kind: "dir", path: home.path(SHARED_SKILL) } as const;
        const key = locatorKey(shared);
        const snapshot = ledgerSnapshot(home);
        const entry = snapshot.entries[key];
        if (entry === undefined) {
          throw new Error("Missing shared skill fixture");
        }
        expect(entry.agents).toEqual(["gemini-cli"]);
        const before = readFileSync(home.path(LEDGER_FILE));
        const desiredText = state === "in-sync" ? "shared skill\n" : "updated shared skill\n";
        if (state === "ledger-behind") {
          home.write(`${SHARED_SKILL}/SKILL.md`, desiredText);
        }
        const diskBefore = readFileSync(home.path(`${SHARED_SKILL}/SKILL.md`));
        const expected = encodeLedger({
          ...snapshot,
          revision: snapshot.revision + 1,
          entries: {
            ...snapshot.entries,
            [key]: {
              ...entry,
              contentHash: yield* hashContent("dir", { "SKILL.md": desiredText }),
              appliedAt: new Date(0).toISOString(),
              entryRevision: snapshot.revision + 1
            }
          }
        });

        const report = yield* verify("demo-app", {
          agents: ["grok"],
          bundle: state === "in-sync" ? bundle : skillsBundle("2.0.0", desiredText),
          providers: { install: testInstall, hooks: testHooks }
        });

        expect(report.artifacts).toEqual([
          { locator: shared, agents: ["gemini-cli"], status: state === "outdated" ? "outdated" : "in-sync" }
        ]);
        expect(report.acknowledged).toEqual(state === "ledger-behind" ? [shared] : []);
        expect(readFileSync(home.path(`${SHARED_SKILL}/SKILL.md`))).toEqual(diskBefore);
        if (state === "ledger-behind") {
          expect(entryBytes(home, shared)).toEqual(storedEntryBytes(expected, shared));
          expect(ledgerSnapshot(home).revision).toBe(snapshot.revision + 1);
        } else {
          expect(readFileSync(home.path(LEDGER_FILE))).toEqual(before);
        }
      }).pipe(Effect.provide(home.layer(isolatedPlatform(home))));
    }
  );

  it.effect("keeps all owner entries in the report when agents is omitted", () => {
    const home = testHome();
    return Effect.gen(function* () {
      yield* applyInstall(
        yield* planInstall(hooksBundle(), {
          agents: ["claude-code", "grok"],
          providers: { install: testInstall, hooks: testHooks }
        })
      );
      home.write(GROK_HOOKS, "{}\n");
      const before = readFileSync(home.path(LEDGER_FILE));

      const report = yield* verify("demo-app", {
        bundle: hooksBundle(),
        providers: { install: testInstall, hooks: testHooks }
      });

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
      yield* applyInstall(
        yield* planInstall(hooksBundle(), {
          agents: ["claude-code", "grok"],
          providers: { install: testInstall, hooks: testHooks }
        })
      );
      home.write(GROK_HOOKS, "{}\n");
      const before = readFileSync(home.path(LEDGER_FILE));

      const report = yield* verify("demo-app", {
        agents: ["claude-code"],
        providers: { install: testInstall, hooks: testHooks }
      });

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
      yield* applyInstall(
        yield* planInstall(hooksBundle(), {
          agents: ["claude-code", "grok"],
          providers: { install: testInstall, hooks: testHooks }
        })
      );
      advanceClaudeHooks(home);
      const before = readFileSync(home.path(LEDGER_FILE));

      const report = yield* verify("demo-app", {
        agents: [],
        bundle: hooksBundle("2.0.0", 10),
        providers: { install: testInstall, hooks: testHooks }
      });

      expect(report).toEqual({ artifacts: [], acknowledged: [] });
      expect(readFileSync(home.path(LEDGER_FILE))).toEqual(before);
    }).pipe(Effect.provide(home.layer(isolatedPlatform(home))));
  });
});
