import { builtinInstallAdapters as testInstall } from "../src/public.js";
import { builtinHookDialects as testHooks } from "../src/events.js";
import { readdirSync, readFileSync, statSync } from "node:fs";

import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PlatformService } from "@rivus/agent-kit-platform/effect";

import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { findLegacy, type LegacyEntry } from "../src/application/use-cases/find-legacy.js";
import { inventory } from "../src/application/use-cases/inventory.js";
import {
  type PlanInstallError,
  type PlanInstallOptions,
  planInstall
} from "../src/application/use-cases/plan-install.js";
import { uninstall } from "../src/application/use-cases/uninstall.js";
import { LedgerRepository } from "../src/application/ports.js";
import type { Bundle } from "../src/domain/bundle/index.js";
import { locatorKey, type PlanStep } from "../src/domain/install-plan/index.js";
import type { LedgerSnapshot } from "../src/domain/ledger/index.js";
import { PlatformArtifactFilesLive } from "../src/infra/adapters/platform-artifact-files.js";
import { FileLedgerRepositoryLive } from "../src/infra/repository/file-ledger-repository.js";
import { demoBundle, SHIM } from "./support/bundles.js";
import { removeTestHomes, type TestHome, testHome } from "./support/home.js";

afterEach(removeTestHomes);

const LEGACY = "npx --yes legacy-demo hook";
const OTHER_COMMAND = "/usr/local/bin/other-tool hook --event Stop";
const legacyCommand = (event: string): string => `${LEGACY} --event ${event}`;
// "demo-hook" is a substring of the current command, so the ledger-recorded entries are marker matches too: only the
// ledger keeps them off the listing. The path markers match the old plugin and extension references.
const MARKERS = ["legacy-demo hook", "demo-hook", "plugins/legacy-demo.js", "extensions/legacy-demo.ts"];

const OWNER = "demo-app";
const bundle = (): Bundle => demoBundle("2.0.0", { legacyMarkers: MARKERS });

const SHARED_CLAUDE: PlanInstallOptions["strategies"] = { "claude-code": { hooks: "shared-config" } };
const SHARED_GEMINI: PlanInstallOptions["strategies"] = { "gemini-cli": { hooks: "shared-config" } };

interface HookRegistration {
  readonly type: string;
  readonly command: string;
  readonly timeout?: number;
}

interface Group {
  readonly hooks: readonly HookRegistration[];
}

const claudeGrouped = (hooks: Record<string, Group[]>): string => `${JSON.stringify({ hooks }, null, 2)}\n`;
const hook = (command: string, timeout?: number): Group => ({
  hooks: [{ type: "command", command, ...(timeout === undefined ? {} : { timeout }) }]
});
const legacyGroup = (event: string): Group[] => [hook(legacyCommand(event))];
const otherGroup = (): Group[] => [hook(OTHER_COMMAND)];
/** The hook registration the install recorded, with the timeout in the agent's unit, so a rewrite still hashes as recorded. */
const recordedHook = (agent: string, timeout: number): HookRegistration => ({
  type: "command",
  command: SHIM.replaceAll("{agent}", agent),
  timeout
});

const codexStopGroup = (command: string): string =>
  `[[hooks.Stop]]\n\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(command)}\n`;

/** An older version of the owner whose only Claude Code hook is PostToolUse, which the scanned bundle never fires. */
const olderClaudeBundle = (): Bundle => ({
  ...demoBundle("1.9.0", { legacyMarkers: MARKERS }),
  artifacts: [{ type: "hooks", command: SHIM, events: { "claude-code": ["PostToolUse"] } }]
});

/** Installs the owner once, so the fixture holds ledger entries in the files the scan reads. */
const recordFor = (
  record: CodingAgentId,
  strategies?: PlanInstallOptions["strategies"],
  installed: Bundle = bundle()
) =>
  Effect.gen(function* () {
    const plan = yield* planInstall(installed, {
      agents: [record],
      ...(strategies === undefined ? {} : { strategies }),
      providers: { install: testInstall, hooks: testHooks }
    });
    yield* applyInstall(plan);
  });

/**
 * The replace fixture per adapter: the owner is installed first, then the older version's leftovers are planted, so
 * the home holds a legacy hook entry (where the adapter scans for one), a legacy plugin or extension file and
 * configuration reference (where it has those), another owner's entry, and the owner's own recorded entries.
 */
const replaceFixture = (home: TestHome, agent: CodingAgentId, installed: Bundle = bundle()) =>
  Effect.gen(function* () {
    switch (agent) {
      case "claude-code": {
        yield* recordFor("claude-code", SHARED_CLAUDE, installed);
        const shim = hook(SHIM.replaceAll("{agent}", "claude-code"), 5);
        home.write(
          ".claude/settings.json",
          claudeGrouped({
            SessionStart: [shim, ...otherGroup()],
            UserPromptSubmit: [shim],
            Stop: [shim, ...otherGroup(), ...legacyGroup("Stop")]
          })
        );
        return;
      }
      case "codex": {
        yield* recordFor("codex");
        home.write(".codex/hooks.json", claudeGrouped({ SessionStart: legacyGroup("SessionStart") }));
        // The install wrote the hooks as a static `[hooks]` table; the rewrite keeps its records and adds the older
        // version's Stop group beside the recorded one.
        const shim = recordedHook("codex", 5);
        const group = (registration: HookRegistration): string =>
          `{ hooks = [ { type = "command", command = ${JSON.stringify(registration.command)}${
            registration.timeout === undefined ? "" : `, timeout = ${registration.timeout}`
          } } ] }`;
        home.write(
          ".codex/config.toml",
          [
            "[hooks]",
            `SessionStart = [${group(shim)}]`,
            `Stop = [${group(shim)}, ${group({ type: "command", command: legacyCommand("Stop") })}]`,
            `UserPromptSubmit = [${group(shim)}]`,
            ""
          ].join("\n")
        );
        return;
      }
      case "gemini-cli": {
        yield* recordFor("gemini-cli", SHARED_GEMINI);
        const shim = hook(SHIM.replaceAll("{agent}", "gemini-cli"), 5000);
        home.write(
          ".gemini/settings.json",
          claudeGrouped({
            SessionStart: [shim, ...otherGroup()],
            BeforeAgent: [shim],
            AfterAgent: [shim],
            Stop: legacyGroup("Stop")
          })
        );
        return;
      }
      // Cursor declares no own legacy source; both runners scan Claude Code's settings file under their own event
      // names. The recorded PostToolUse hook does not fire in the scanned bundle's runner, so the plan may install
      // beside it. Grok's own hook file is covered separately.
      case "cursor":
      case "grok": {
        yield* recordFor("claude-code", SHARED_CLAUDE, olderClaudeBundle());
        home.write(
          ".claude/settings.json",
          claudeGrouped({
            PostToolUse: [hook(SHIM.replaceAll("{agent}", "claude-code"), 5)],
            SessionStart: otherGroup(),
            Stop: [...otherGroup(), ...legacyGroup("Stop")]
          })
        );
        return;
      }
      case "opencode": {
        yield* recordFor("opencode");
        home.write(
          ".config/opencode/plugins/legacy-demo.js",
          "// legacy-demo hook setup, shelling out on every event\n"
        );
        home.write(
          ".config/opencode/opencode.json",
          `${JSON.stringify({ plugin: ["./plugins/legacy-demo.js", "some-other-plugin"] }, null, 2)}\n`
        );
        return;
      }
      case "pi": {
        yield* recordFor("pi");
        home.write(".pi/agent/extensions/legacy-demo.ts", "// legacy-demo hook setup, forwarding every event\n");
        home.write(
          ".pi/agent/settings.json",
          `${JSON.stringify({ extensions: ["./extensions/legacy-demo.ts", "some-other-extension"] }, null, 2)}\n`
        );
        return;
      }
    }
  });

/** One listed entry as the tests view it: the locator reduced to its file, position and member. */
interface ExpectedEntry {
  readonly file: string;
  readonly pointer?: string;
  readonly member?: string;
  readonly kind: LegacyEntry["kind"];
  readonly event?: string;
  readonly command?: string;
  readonly treatment: LegacyEntry["treatment"];
}

/** What each adapter's replace fixture must list. Cursor and Grok see the event under their own name. */
const expectedReplace: Readonly<Record<CodingAgentId, readonly ExpectedEntry[]>> = {
  "claude-code": [
    {
      file: "/.claude/settings.json",
      pointer: "/hooks/Stop",
      member: legacyCommand("Stop"),
      kind: "json-entry",
      event: "Stop",
      command: legacyCommand("Stop"),
      treatment: "replace"
    }
  ],
  codex: [
    {
      file: "/.codex/config.toml",
      pointer: "/hooks/Stop",
      member: legacyCommand("Stop"),
      kind: "toml-entry",
      event: "Stop",
      command: legacyCommand("Stop"),
      treatment: "replace"
    },
    {
      file: "/.codex/hooks.json",
      pointer: "/hooks/SessionStart",
      member: legacyCommand("SessionStart"),
      kind: "json-entry",
      event: "SessionStart",
      command: legacyCommand("SessionStart"),
      treatment: "replace"
    }
  ],
  "gemini-cli": [
    {
      file: "/.gemini/settings.json",
      pointer: "/hooks/Stop",
      member: legacyCommand("Stop"),
      kind: "json-entry",
      event: "Stop",
      command: legacyCommand("Stop"),
      treatment: "replace"
    }
  ],
  cursor: [
    {
      file: "/.claude/settings.json",
      pointer: "/hooks/Stop",
      member: legacyCommand("Stop"),
      kind: "json-entry",
      event: "stop",
      command: legacyCommand("Stop"),
      treatment: "replace"
    }
  ],
  grok: [
    {
      file: "/.claude/settings.json",
      pointer: "/hooks/Stop",
      member: legacyCommand("Stop"),
      kind: "json-entry",
      event: "Stop",
      command: legacyCommand("Stop"),
      treatment: "replace"
    }
  ],
  opencode: [
    { file: "/.config/opencode/plugins/legacy-demo.js", kind: "file", treatment: "replace" },
    {
      file: "/.config/opencode/opencode.json",
      pointer: "/plugin",
      member: "./plugins/legacy-demo.js",
      kind: "json-entry",
      treatment: "replace"
    }
  ],
  pi: [
    { file: "/.pi/agent/extensions/legacy-demo.ts", kind: "file", treatment: "replace" },
    {
      file: "/.pi/agent/settings.json",
      pointer: "/extensions",
      member: "./extensions/legacy-demo.ts",
      kind: "json-entry",
      treatment: "replace"
    }
  ]
};

const rel = (home: TestHome, path: string): string =>
  path.startsWith(`${home.home}/`) ? path.slice(home.home.length) : path;

const asView = (home: TestHome, entries: readonly LegacyEntry[]) =>
  entries.map((entry) => ({
    file: rel(home, entry.locator.path),
    pointer: entry.locator.pointer,
    member: entry.locator.member,
    kind: entry.kind,
    event: entry.event,
    command: entry.command,
    treatment: entry.treatment
  }));

const replaceKeys = (entries: readonly LegacyEntry[]): readonly string[] =>
  entries
    .filter((entry) => entry.treatment === "replace")
    .map((entry) => locatorKey(entry.locator))
    .toSorted();

const protectKeys = (entries: readonly LegacyEntry[]): readonly string[] =>
  entries
    .filter((entry) => entry.treatment === "protect")
    .map((entry) => locatorKey(entry.locator))
    .toSorted();

const legacyStepKeys = (steps: readonly PlanStep[]): readonly string[] =>
  steps
    .filter((step) => step.legacy === true)
    .map((step) => locatorKey(step.locator))
    .toSorted();

const conflictKeys = (failure: PlanInstallError): readonly string[] =>
  failure._tag === "PlanConflict" ? failure.conflicts.map(({ step }) => locatorKey(step.locator)).toSorted() : [];

describe("findLegacy: an owner's untracked legacy entries (issue #97)", () => {
  for (const agent of Object.keys(expectedReplace) as CodingAgentId[]) {
    const strategies = agent === "claude-code" ? SHARED_CLAUDE : agent === "gemini-cli" ? SHARED_GEMINI : undefined;
    it.effect(`lists exactly what the ${agent} plan replaces, and nothing else`, () =>
      Effect.gen(function* () {
        const home = testHome();
        const run = Effect.gen(function* () {
          yield* replaceFixture(home, agent);
          const entries = yield* findLegacy(OWNER, {
            agents: [agent],
            legacyMarkers: MARKERS,
            providers: { install: testInstall, hooks: testHooks }
          });
          const expected = expectedReplace[agent] ?? [];
          expect(asView(home, entries).toSorted((a, b) => a.file.localeCompare(b.file))).toEqual(
            [...expected].toSorted((a, b) => a.file.localeCompare(b.file))
          );
          // Parity: the replace entries are exactly the legacy steps `planInstall` produces for the same input.
          const plan = yield* planInstall(bundle(), {
            agents: [agent],
            ...(strategies === undefined ? {} : { strategies }),
            providers: { install: testInstall, hooks: testHooks }
          });
          expect(replaceKeys(entries)).toEqual(legacyStepKeys(plan.steps));
        });
        yield* run.pipe(Effect.provide(home.layer()));
      })
    );
  }

  it.effect(
    "claude-code: a hook the ledger holds at its event is protected, and the plan preserves it as a conflict",
    () =>
      Effect.gen(function* () {
        const home = testHome();
        const run = Effect.gen(function* () {
          yield* recordFor("claude-code", SHARED_CLAUDE);
          // The recorded Stop hook disappears from the file and a marked hook takes the event: a renamed hook cannot
          // be told apart from the deleted one, so the listing says protected and the plan keeps it, unresolvable.
          home.write(".claude/settings.json", claudeGrouped({ Stop: legacyGroup("Stop") }));
          const entries = yield* findLegacy(OWNER, {
            agents: ["claude-code"],
            legacyMarkers: MARKERS,
            providers: { install: testInstall, hooks: testHooks }
          });
          expect(asView(home, entries)).toEqual([
            {
              file: "/.claude/settings.json",
              pointer: "/hooks/Stop",
              member: legacyCommand("Stop"),
              kind: "json-entry",
              event: "Stop",
              command: legacyCommand("Stop"),
              treatment: "protect"
            }
          ]);
          const failure = yield* Effect.flip(
            planInstall(bundle(), {
              agents: ["claude-code"],
              strategies: SHARED_CLAUDE,
              providers: { install: testInstall, hooks: testHooks }
            })
          );
          expect(conflictKeys(failure)).toEqual(protectKeys(entries));
        });
        yield* run.pipe(Effect.provide(home.layer()));
      })
  );

  for (const [agent, event, strategies] of [
    ["codex", "Stop", undefined],
    ["gemini-cli", "SessionStart", SHARED_GEMINI],
    ["cursor", "stop", undefined],
    ["grok", "Stop", undefined]
  ] as const) {
    it.effect(`${agent}: a hook the ledger holds at its event is protected, and the plan preserves it`, () =>
      Effect.gen(function* () {
        const home = testHome();
        const run = Effect.gen(function* () {
          if (agent === "codex") {
            yield* recordFor("codex");
            home.write(".codex/config.toml", codexStopGroup(legacyCommand("Stop")));
          } else if (agent === "gemini-cli") {
            yield* recordFor("gemini-cli", SHARED_GEMINI);
            home.write(".gemini/settings.json", claudeGrouped({ SessionStart: legacyGroup("SessionStart") }));
          } else {
            // Cursor and Grok scan Claude Code's settings file, so the recorded hook and the marked one sit there.
            yield* recordFor("claude-code", SHARED_CLAUDE);
            home.write(".claude/settings.json", claudeGrouped({ Stop: legacyGroup("Stop") }));
          }
          const entries = yield* findLegacy(OWNER, {
            agents: [agent],
            legacyMarkers: MARKERS,
            providers: { install: testInstall, hooks: testHooks }
          });
          expect(entries.map((entry) => [rel(home, entry.locator.path), entry.event, entry.treatment])).toEqual([
            [
              agent === "codex"
                ? "/.codex/config.toml"
                : agent === "gemini-cli"
                  ? "/.gemini/settings.json"
                  : "/.claude/settings.json",
              event,
              "protect"
            ]
          ]);
          const failure = yield* Effect.flip(
            planInstall(bundle(), {
              agents: [agent],
              ...(strategies === undefined ? {} : { strategies }),
              providers: { install: testInstall, hooks: testHooks }
            })
          );
          expect(conflictKeys(failure)).toEqual(protectKeys(entries));
        });
        yield* run.pipe(Effect.provide(home.layer()));
      })
    );
  }

  it.effect("opencode and pi: a plugin the user kept is protected, and the plan refuses to overwrite it", () =>
    Effect.gen(function* () {
      for (const agent of ["opencode", "pi"] as const) {
        const home = testHome();
        const run = Effect.gen(function* () {
          yield* recordFor(agent);
          const bridge =
            agent === "opencode" ? ".config/opencode/plugins/demo-app.js" : ".pi/agent/extensions/demo-app.ts";
          home.write(bridge, `${home.read(bridge) ?? ""}\n// the user's edit, still carrying the demo-hook command\n`);
          const removed = yield* uninstall("demo-app", {
            agents: [agent],
            providers: { install: testInstall, hooks: testHooks }
          });
          expect(removed.kept.map((locator) => locator.path)).toEqual([home.path(bridge)]);
          const entries = yield* findLegacy(OWNER, {
            agents: [agent],
            legacyMarkers: MARKERS,
            providers: { install: testInstall, hooks: testHooks }
          });
          expect(entries.map((entry) => [rel(home, entry.locator.path), entry.kind, entry.treatment])).toEqual([
            [`/${bridge}`, "file", "protect"]
          ]);
          // The plan produces no legacy step for the kept file: it is the user's, and the plan conflicts there instead.
          const failure = yield* Effect.flip(
            planInstall(bundle(), {
              agents: [agent],
              providers: { install: testInstall, hooks: testHooks }
            })
          );
          expect(failure._tag).toBe("PlanConflict");
          if (failure._tag === "PlanConflict") {
            expect(
              failure.conflicts.map(({ step }) => [rel(home, step.locator.path), step.conflict, step.legacy === true])
            ).toEqual([[`/${bridge}`, "unmanaged-exists", false]]);
          }
        });
        yield* run.pipe(Effect.provide(home.layer()));
      }
    })
  );

  it.effect("reads without the LedgerLock: the home and the ledger are byte-identical after the call", () =>
    Effect.gen(function* () {
      const home = testHome();
      const snapshot = (): Record<string, string> => {
        const files: Record<string, string> = {};
        const walk = (dir: string): void => {
          for (const name of readdirSync(dir)) {
            const path = `${dir}/${name}`;
            if (statSync(path).isDirectory()) {
              walk(path);
            } else {
              files[path.slice(home.home.length)] = readFileSync(path, "utf8");
            }
          }
        };
        walk(home.home);
        return files;
      };
      yield* replaceFixture(home, "claude-code").pipe(Effect.provide(home.layer()));
      const before = snapshot();
      // The listing runs in an environment with no LedgerLock, no AgentCli and no ExternalOwner — outside the full
      // layer, so a call that reached for one of those would die for lack of the service.
      const minimal = Layer.mergeAll(PlatformArtifactFilesLive, FileLedgerRepositoryLive).pipe(
        Layer.provideMerge(Layer.succeed(PlatformService, home.platform))
      );
      const revision = (yield* inventory().pipe(Effect.provide(minimal))).revision;
      const listing = yield* findLegacy(OWNER, {
        agents: ["claude-code"],
        legacyMarkers: MARKERS,
        providers: { install: testInstall, hooks: testHooks }
      }).pipe(Effect.provide(minimal));
      expect(listing.map(({ treatment }) => treatment)).toEqual(["replace"]);
      expect(snapshot()).toEqual(before);
      expect((yield* inventory().pipe(Effect.provide(minimal))).revision).toBe(revision);
    })
  );

  it.effect.each([
    ["demo-app", ".grok"],
    ["@demo/app", ".custom-grok"]
  ] as const)(
    "grok: lists the canonical file for %s under %s with the same legacy treatment as planning",
    ([owner, dir]) =>
      Effect.gen(function* () {
        const home = testHome();
        const platform =
          dir === ".grok" ? home.platform : { ...home.platform, env: { ...home.env, GROK_HOME: home.path(dir) } };
        const run = Effect.gen(function* () {
          const path = `${dir}/hooks/demo-app.json`;
          home.write(path, claudeGrouped({ Stop: legacyGroup("Stop") }));
          const entries = yield* findLegacy(owner, {
            agents: ["grok"],
            legacyMarkers: MARKERS,
            providers: { install: testInstall, hooks: testHooks }
          });
          const plan = yield* planInstall(demoBundle("2.0.0", { owner, legacyMarkers: MARKERS }), {
            agents: ["grok"],
            providers: { install: testInstall, hooks: testHooks }
          });
          expect(
            plan.steps.filter((step) => step.legacy === true).map((step) => [step.action, rel(home, step.locator.path)])
          ).toEqual([["adopt", `/${path}`]]);
          expect(asView(home, entries)).toEqual([{ file: `/${path}`, kind: "file", treatment: "replace" }]);
          expect(replaceKeys(entries)).toEqual(legacyStepKeys(plan.steps));
          yield* applyInstall(plan);
          expect(home.read(path)).toContain("demo-hook --agent grok");
          expect(home.read(path)).not.toContain(LEGACY);
        });
        yield* run.pipe(Effect.provide(home.layer(platform)));
      })
  );

  it.effect("grok: a kept hook file is listed as protected and planning refuses to overwrite it", () =>
    Effect.gen(function* () {
      const home = testHome();
      const run = Effect.gen(function* () {
        yield* recordFor("grok");
        const path = ".grok/hooks/demo-app.json";
        const edited = claudeGrouped({ Stop: [...legacyGroup("Stop"), ...otherGroup()] });
        home.write(path, edited);
        const removed = yield* uninstall(OWNER, {
          agents: ["grok"],
          providers: { install: testInstall, hooks: testHooks }
        });
        expect(removed.kept.map((locator) => locator.path)).toEqual([home.path(path)]);
        const entries = yield* findLegacy(OWNER, {
          agents: ["grok"],
          legacyMarkers: MARKERS,
          providers: { install: testInstall, hooks: testHooks }
        });
        expect(asView(home, entries)).toEqual([{ file: `/${path}`, kind: "file", treatment: "protect" }]);
        const failure = yield* Effect.flip(
          planInstall(bundle(), {
            agents: ["grok"],
            providers: { install: testInstall, hooks: testHooks }
          })
        );
        expect(conflictKeys(failure)).toEqual(protectKeys(entries));
        expect(failure._tag).toBe("PlanConflict");
        if (failure._tag === "PlanConflict") {
          expect(failure.conflicts.map(({ step }) => [step.conflict, step.legacy === true])).toEqual([
            ["unmanaged-exists", false]
          ]);
        }
        expect(home.read(path)).toBe(edited);
      });
      yield* run.pipe(Effect.provide(home.layer()));
    })
  );

  it.effect("markers come from the options: an install bundle without markers still lists what the options mark", () =>
    Effect.gen(function* () {
      const home = testHome();
      const run = Effect.gen(function* () {
        // The installed bundle carries no legacyMarkers, as an upgrading application's may not.
        yield* replaceFixture(home, "claude-code", demoBundle("2.0.0", { legacyMarkers: undefined }));
        const entries = yield* findLegacy(OWNER, {
          agents: ["claude-code"],
          legacyMarkers: MARKERS,
          providers: { install: testInstall, hooks: testHooks }
        });
        expect(asView(home, entries)).toEqual([...expectedReplace["claude-code"]]);
        // The plan agrees when it is given the same markers.
        const plan = yield* planInstall(bundle(), {
          agents: ["claude-code"],
          strategies: SHARED_CLAUDE,
          providers: { install: testInstall, hooks: testHooks }
        });
        expect(replaceKeys(entries)).toEqual(legacyStepKeys(plan.steps));
      });
      yield* run.pipe(Effect.provide(home.layer()));
    })
  );

  it.effect("a target an interrupted apply left pending is not listed, like a recorded entry", () =>
    Effect.gen(function* () {
      const home = testHome();
      const run = Effect.gen(function* () {
        const pending = legacyCommand("Stop");
        const shim = hook(SHIM.replaceAll("{agent}", "claude-code"), 5);
        home.write(
          ".claude/settings.json",
          claudeGrouped({
            SessionStart: [shim],
            UserPromptSubmit: [shim],
            Stop: [...otherGroup(), ...legacyGroup("Stop")]
          })
        );
        // The owner's own crashed apply recorded its target as pending: the marker-carrying hook it just wrote sits
        // in a legacy source location, and the listing, which cannot settle the operation, must stay silent on it.
        const snapshot: LedgerSnapshot = {
          schemaVersion: 1,
          lineage: "lineage-1",
          revision: 1,
          entries: {},
          pending: [
            {
              planId: "plan-crashed",
              owner: OWNER,
              bundleVersion: "2.0.0",
              toolVersion: "0.15.0",
              locator: {
                kind: "json-entry",
                path: home.path(".claude/settings.json"),
                pointer: "/hooks/Stop",
                member: pending,
                memberIn: "hook-group"
              },
              action: "adopt",
              agents: ["claude-code"],
              precondition: { hash: `sha256:${"0".repeat(64)}` },
              legacy: true,
              startedAt: "2026-10-15T00:00:00.000Z"
            }
          ]
        };
        yield* (yield* LedgerRepository).save({ key: "user", scope: "user" }, snapshot, undefined);
        // Only the pending hook carries a marker here ("demo-hook" would also match the recorded-looking commands).
        expect(
          yield* findLegacy(OWNER, {
            agents: ["claude-code"],
            legacyMarkers: ["legacy-demo hook"],
            providers: { install: testInstall, hooks: testHooks }
          })
        ).toEqual([]);
      });
      yield* run.pipe(Effect.provide(home.layer()));
    })
  );

  it.effect("validates the owner and the markers the way uninstall does", () =>
    Effect.gen(function* () {
      const home = testHome();
      const run = Effect.gen(function* () {
        const badOwner = yield* Effect.flip(
          findLegacy("Demo App", {
            agents: ["claude-code"],
            legacyMarkers: MARKERS,
            providers: { install: testInstall, hooks: testHooks }
          })
        );
        expect(badOwner._tag).toBe("InvalidBundle");
        const blankMarker = yield* Effect.flip(
          findLegacy(OWNER, {
            agents: ["claude-code"],
            legacyMarkers: [" "],
            providers: { install: testInstall, hooks: testHooks }
          })
        );
        expect(blankMarker._tag).toBe("InvalidBundle");
      });
      yield* run.pipe(Effect.provide(home.layer()));
    })
  );
});
