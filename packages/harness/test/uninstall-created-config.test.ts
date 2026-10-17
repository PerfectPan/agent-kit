import { existsSync } from "node:fs";

import { parse as parseToml } from "@decimalturn/toml-patch";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ArtifactFiles, LedgerRepository } from "../src/application/ports.js";
import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { inventory } from "../src/application/use-cases/inventory.js";
import { planInstall, type PlanInstallOptions } from "../src/application/use-cases/plan-install.js";
import { uninstall } from "../src/application/use-cases/uninstall.js";
import { verify } from "../src/application/use-cases/verify.js";
import type { Bundle } from "../src/domain/bundle/index.js";
import { demoBundle } from "./support/bundles.js";
import { removeTestHomes, type TestHome, testHome } from "./support/home.js";

afterEach(removeTestHomes);

const EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"];
const LEDGER_PATH = ".local/state/agent-kit/harness/user/ledger.json";

interface ConfigCase {
  readonly agent: "codex" | "claude-code";
  readonly path: string;
  readonly strategies?: PlanInstallOptions["strategies"];
  readonly emptySeeds: readonly string[];
  readonly userSeed: string;
  readonly additions: readonly { readonly name: string; readonly before?: string; readonly after?: string }[];
}

const cases: readonly ConfigCase[] = [
  {
    agent: "codex",
    path: ".codex/config.toml",
    emptySeeds: ["", " \n\t\n"],
    userSeed: 'model = "custom"\n\n[user]\n',
    additions: [
      { name: "data", before: 'model = "custom"\n' },
      { name: "a comment", before: "# User notes survive uninstall.\n" },
      { name: "an empty table", after: "\n[user]\n" },
      { name: "an empty inline table", before: "user = {}\n" }
    ]
  },
  {
    agent: "claude-code",
    path: ".claude/settings.json",
    strategies: { "claude-code": { hooks: "shared-config" } },
    emptySeeds: ["", " \n\t\n", "{}\n"],
    userSeed: '{"theme":"dark","user":{}}\n',
    additions: [
      { name: "data", before: '"theme":"dark",' },
      { name: "a comment", before: "// User notes survive uninstall.\n" },
      { name: "an empty object", before: '"user":{},' },
      { name: "an empty array", before: '"user":[],' }
    ]
  }
];

function isolatedLayer(home: TestHome, platform = home.platform) {
  return home.layer({
    ...platform,
    clock: { now: () => 0, monotonic: () => 0 },
    process: {
      run: () => Promise.reject(new Error("Unexpected external command")),
      spawn: () => {
        throw new Error("Unexpected external command");
      },
      self: { host: "test", bootId: "test", pid: 1, startTime: 0 },
      identify: () => undefined
    }
  });
}

function hooksBundle(testCase: ConfigCase, owner = "demo-app", events: readonly string[] = EVENTS): Bundle {
  return demoBundle("1.0.0", {
    owner,
    legacyMarkers: [],
    artifacts: [
      {
        type: "hooks",
        command: `/opt/${owner}/bin/hook --agent {agent}`,
        timeoutSeconds: 5,
        events: { [testCase.agent]: events }
      }
    ]
  });
}

function install(testCase: ConfigCase, bundle = hooksBundle(testCase)) {
  return Effect.gen(function* () {
    const plan = yield* planInstall(bundle, {
      agents: [testCase.agent],
      ...(testCase.strategies === undefined ? {} : { strategies: testCase.strategies })
    });
    expect(plan.commands).toEqual([]);
    yield* applyInstall(plan);
  });
}

describe("uninstall of configuration files created by install", () => {
  for (const testCase of cases) {
    it.effect(`${testCase.agent}: deletes the created file after removing all four hook groups without a CLI`, () => {
      const home = testHome();
      return Effect.gen(function* () {
        yield* install(testCase);
        const entries = (yield* inventory()).entries.filter((entry) => entry.locator.path === home.path(testCase.path));
        expect(entries).toHaveLength(4);
        expect(home.read(testCase.path)).toContain("/opt/demo-app/bin/hook");

        const removed = yield* uninstall("demo-app");
        expect(removed.kept).toEqual([]);
        expect(home.read(testCase.path)).toBeUndefined();
        expect((yield* inventory()).entries).toEqual([]);
        expect((yield* uninstall("demo-app")).steps).toEqual([]);
      }).pipe(Effect.provide(isolatedLayer(home)));
    });

    for (const [index, seed] of testCase.emptySeeds.entries()) {
      it.effect(`${testCase.agent}: retains a pre-existing empty configuration file (${index})`, () => {
        const home = testHome();
        home.write(testCase.path, seed);
        return Effect.gen(function* () {
          yield* install(testCase);
          expect((yield* inventory()).entries.every((entry) => entry.preImage.existed === false)).toBe(true);
          yield* uninstall("demo-app");
          expect(home.read(testCase.path)).toBeDefined();
          expect((yield* inventory()).entries).toEqual([]);
        }).pipe(Effect.provide(isolatedLayer(home)));
      });
    }

    it.effect(`${testCase.agent}: retains a pre-existing configuration file with other data`, () => {
      const home = testHome();
      home.write(testCase.path, testCase.userSeed);
      return Effect.gen(function* () {
        yield* install(testCase);
        yield* uninstall("demo-app");
        const remaining = home.read(testCase.path);
        expect(remaining).toBeDefined();
        if (testCase.agent === "codex") {
          expect(parseToml(remaining ?? "")).toEqual(parseToml(testCase.userSeed));
        } else {
          expect(JSON.parse(remaining ?? "null")).toEqual(JSON.parse(testCase.userSeed));
        }
      }).pipe(Effect.provide(isolatedLayer(home)));
    });

    for (const addition of testCase.additions) {
      it.effect(`${testCase.agent}: retains a created file after the user adds ${addition.name}`, () => {
        const home = testHome();
        return Effect.gen(function* () {
          yield* install(testCase);
          const installed = home.read(testCase.path) ?? "";
          const before = addition.before ?? "";
          const edited =
            testCase.agent === "claude-code" && before.startsWith('"')
              ? installed.replace("{", `{${before}`)
              : `${before}${installed}${addition.after ?? ""}`;
          home.write(testCase.path, edited);

          const removed = yield* uninstall("demo-app");
          expect(removed.kept).toEqual([]);
          const remaining = home.read(testCase.path);
          expect(remaining).toBeDefined();
          if (testCase.agent === "claude-code" && before.startsWith('"')) {
            expect(JSON.parse(remaining ?? "null")).toEqual(JSON.parse(`{${before.replace(/,$/, "")}}`));
          } else {
            expect(remaining).toContain((addition.before ?? addition.after ?? "").trim());
          }
          expect(remaining).not.toContain("/opt/demo-app/bin/hook");
        }).pipe(Effect.provide(isolatedLayer(home)));
      });
    }

    for (const firstRemoved of ["first-app", "second-app"]) {
      it.effect(
        `${testCase.agent}: retains the created file until the last owner leaves (${firstRemoved} first)`,
        () => {
          const home = testHome();
          return Effect.gen(function* () {
            yield* install(testCase, hooksBundle(testCase, "first-app"));
            yield* install(testCase, hooksBundle(testCase, "second-app"));
            const lastRemoved = firstRemoved === "first-app" ? "second-app" : "first-app";

            yield* uninstall(firstRemoved);
            expect(home.read(testCase.path)).toContain(`/opt/${lastRemoved}/bin/hook`);
            expect(home.read(testCase.path)).not.toContain(`/opt/${firstRemoved}/bin/hook`);
            yield* uninstall(lastRemoved);
            expect(home.read(testCase.path)).toBeUndefined();
            expect((yield* inventory()).entries).toEqual([]);
          }).pipe(Effect.provide(isolatedLayer(home)));
        }
      );
    }

    it.effect(`${testCase.agent}: retains file provenance through a no-op reinstall and an added hook event`, () => {
      const home = testHome();
      return Effect.gen(function* () {
        yield* install(testCase, hooksBundle(testCase, "demo-app", ["Stop"]));
        yield* install(testCase, hooksBundle(testCase, "demo-app", ["Stop"]));
        yield* install(testCase, hooksBundle(testCase, "demo-app", ["Stop", "SessionStart"]));
        yield* uninstall("demo-app");
        expect(home.read(testCase.path)).toBeUndefined();
      }).pipe(Effect.provide(isolatedLayer(home)));
    });

    it.effect(
      `${testCase.agent}: conservatively retains a file recorded by a v1 ledger without file provenance`,
      () => {
        const home = testHome();
        return Effect.gen(function* () {
          yield* install(testCase);
          const oldLedger: unknown = JSON.parse(home.read(LEDGER_PATH) ?? "null", (key: string, value: unknown) =>
            key === "createdConfigFile" ? undefined : value
          );
          home.write(LEDGER_PATH, `${JSON.stringify(oldLedger)}\n`);

          yield* uninstall("demo-app");
          expect(home.read(testCase.path)).toBeDefined();
          expect(home.read(testCase.path)).not.toContain("/opt/demo-app/bin/hook");
          expect((yield* inventory()).entries).toEqual([]);
        }).pipe(Effect.provide(isolatedLayer(home)));
      }
    );

    it.effect(`${testCase.agent}: retains a file after an ambiguous pending creation is recovered`, () => {
      const home = testHome();
      const base = isolatedLayer(home);
      const uncertainWrite = Layer.effect(
        ArtifactFiles,
        Effect.gen(function* () {
          const files = yield* ArtifactFiles;
          return {
            ...files,
            write: (locator, content) =>
              Effect.gen(function* () {
                yield* files.write(locator, content);
                return yield* Effect.fail({
                  _tag: "ArtifactIoFailure" as const,
                  path: locator.path,
                  operation: "write" as const,
                  message: "write outcome unknown"
                });
              })
          } satisfies typeof files;
        })
      ).pipe(Layer.provide(base));
      return Effect.gen(function* () {
        const failure = yield* Effect.flip(
          install(testCase, hooksBundle(testCase, "demo-app", ["Stop"])).pipe(
            Effect.provide(Layer.merge(base, uncertainWrite))
          )
        );
        expect(failure).toMatchObject({ _tag: "ApplyFailed", completed: 0 });
        expect(home.read(testCase.path)).toContain("/opt/demo-app/bin/hook");
        yield* Effect.gen(function* () {
          expect((yield* inventory()).pending).toHaveLength(1);
          yield* uninstall("demo-app");
          expect(home.read(testCase.path)).toBeDefined();
          expect(home.read(testCase.path)).not.toContain("/opt/demo-app/bin/hook");
          expect((yield* inventory()).pending).toEqual([]);
          expect((yield* inventory()).entries).toEqual([]);
        }).pipe(Effect.provide(base));
      });
    });

    it.effect(
      `${testCase.agent}: refuses ownership when another writer creates the file before the first write`,
      () => {
        const home = testHome();
        const base = isolatedLayer(home);
        const concurrentCreation = Layer.effect(
          LedgerRepository,
          Effect.gen(function* () {
            const repository = yield* LedgerRepository;
            let created = false;
            return {
              ...repository,
              save: (scope, snapshot, expectedRevision) =>
                Effect.gen(function* () {
                  yield* repository.save(scope, snapshot, expectedRevision);
                  if (!created && snapshot.pending.length > 0) {
                    created = true;
                    home.write(testCase.path, "");
                  }
                })
            } satisfies typeof repository;
          })
        ).pipe(Layer.provide(base));
        return Effect.gen(function* () {
          const failure = yield* Effect.flip(install(testCase, hooksBundle(testCase, "demo-app", ["Stop"])));
          expect(failure).toMatchObject({ _tag: "TargetChanged", completed: 0 });
          expect(home.read(testCase.path)).toBe("");
          expect((yield* inventory()).entries).toEqual([]);
          expect((yield* inventory()).pending).toEqual([]);
        }).pipe(Effect.provide(Layer.merge(base, concurrentCreation)));
      }
    );

    it.effect(
      `${testCase.agent}: preserves hooks when deleting the empty result fails and retries after recovery`,
      () => {
        const home = testHome();
        const failingPlatform = {
          ...home.platform,
          fs: {
            ...home.platform.fs,
            remove: async (path: string) => {
              if (path === home.path(testCase.path)) {
                throw new Error("remove failed");
              }
              return home.platform.fs.remove(path);
            }
          }
        };
        return Effect.gen(function* () {
          yield* install(testCase, hooksBundle(testCase, "demo-app", ["Stop"])).pipe(
            Effect.provide(isolatedLayer(home))
          );
          const installed = home.read(testCase.path);
          const failure = yield* Effect.flip(
            uninstall("demo-app").pipe(Effect.provide(isolatedLayer(home, failingPlatform)))
          );
          expect(failure).toMatchObject({
            _tag: "ApplyFailed",
            completed: 0,
            cause: { _tag: "ArtifactIoFailure", message: "remove failed" }
          });
          expect(home.read(testCase.path)).toBe(installed);
          yield* Effect.gen(function* () {
            expect((yield* inventory()).pending).toHaveLength(1);
            yield* uninstall("demo-app");
            expect(home.read(testCase.path)).toBeUndefined();
            expect((yield* inventory()).entries).toEqual([]);
            expect((yield* inventory()).pending).toEqual([]);
          }).pipe(Effect.provide(isolatedLayer(home)));
        });
      }
    );

    it.effect(`${testCase.agent}: retains a created file when the user changes its owned hooks`, () => {
      const home = testHome();
      return Effect.gen(function* () {
        yield* install(testCase);
        const installed = home.read(testCase.path) ?? "";
        const edited = installed.replaceAll(/\b5\b/g, "9");
        expect(edited).not.toBe(installed);
        home.write(testCase.path, edited);
        expect((yield* uninstall("demo-app")).kept).toHaveLength(4);
        expect(home.read(testCase.path)).toBe(edited);
        expect((yield* inventory()).entries).toEqual([]);
      }).pipe(Effect.provide(isolatedLayer(home)));
    });
  }

  it.effect(
    "round-trips a seven-agent bundle, removes owned directories and retains user files and untracked parents",
    () => {
      const home = testHome();
      const agents = ["claude-code", "codex", "gemini-cli", "grok", "cursor", "opencode", "pi"] as const;
      return Effect.gen(function* () {
        const plan = yield* planInstall(demoBundle(), { agents });
        expect(plan.commands).toEqual([]);
        yield* applyInstall(plan);
        expect(new Set((yield* inventory()).entries.flatMap((entry) => entry.agents))).toEqual(new Set(agents));
        expect(
          new Set((yield* verify("demo-app", { bundle: demoBundle(), agents })).artifacts.map((entry) => entry.status))
        ).toEqual(new Set(["in-sync"]));
        const userDirectory = ".gemini/extensions/demo-app";
        home.write(`${userDirectory}/notes.txt`, "User notes.\n");

        const removed = yield* uninstall("demo-app");
        expect(removed.kept).toEqual([{ kind: "dir", path: home.path(userDirectory) }]);
        expect(home.read(`${userDirectory}/notes.txt`)).toBe("User notes.\n");
        expect(home.read(".codex/config.toml")).toBeUndefined();
        for (const path of [
          ".claude/skills/demo-app",
          ".claude/skills/demo-skill",
          ".cursor/plugins/local/demo-app",
          ".agents/skills/demo-skill",
          ".grok/hooks/demo-app.json",
          ".config/opencode/plugins/demo-app.js",
          ".pi/agent/extensions/demo-app.ts"
        ]) {
          expect(existsSync(home.path(path))).toBe(false);
        }
        // Ancestor directories have no creation records, so their cleanup remains deferred.
        for (const path of [
          ".claude/skills",
          ".codex",
          ".gemini/extensions",
          ".grok/hooks",
          ".cursor/plugins/local",
          ".agents/skills",
          ".config/opencode/plugins",
          ".pi/agent/extensions"
        ]) {
          expect(existsSync(home.path(path))).toBe(true);
        }
        expect((yield* inventory()).entries).toEqual([]);
      }).pipe(Effect.provide(isolatedLayer(home)));
    }
  );
});
