import { builtinInstallAdapters as testInstall } from "./support/providers.js";
import { builtinHookDialects as testHooks } from "./support/providers.js";
import { chmodSync, existsSync, statSync } from "node:fs";

import { parse as parseToml } from "@decimalturn/toml-patch";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import { ArtifactFiles, LedgerRepository } from "../src/application/ports.js";
import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { inventory } from "../src/application/use-cases/inventory.js";
import { planInstall, type PlanInstallOptions } from "../src/application/use-cases/plan-install.js";
import { uninstall } from "../src/application/use-cases/uninstall.js";
import { verify } from "../src/application/use-cases/verify.js";
import type { Bundle } from "../src/domain/bundle/value-objects/bundle.js";
import { parseJsonc } from "../src/infra/adapters/jsonc-editor.js";
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

function hooksBundle(
  testCase: ConfigCase,
  owner = "demo-app",
  events: readonly string[] = EVENTS,
  timeoutSeconds = 5
): Bundle {
  return demoBundle("1.0.0", {
    owner,
    legacyMarkers: [],
    artifacts: [
      {
        type: "hooks",
        command: `/opt/${owner}/bin/hook --agent {agent}`,
        timeoutSeconds,
        events: { [testCase.agent]: events }
      }
    ]
  });
}

function install(testCase: ConfigCase, bundle = hooksBundle(testCase)) {
  return Effect.gen(function* () {
    const plan = yield* planInstall(bundle, {
      agents: [testCase.agent],
      ...(testCase.strategies === undefined ? {} : { strategies: testCase.strategies }),
      providers: { install: testInstall, hooks: testHooks }
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

        const removed = yield* uninstall("demo-app", {
          providers: { install: testInstall, hooks: testHooks }
        });
        expect(removed.kept).toEqual([]);
        expect(home.read(testCase.path)).toBeUndefined();
        expect((yield* inventory()).entries).toEqual([]);
        expect(
          (yield* uninstall("demo-app", {
            providers: { install: testInstall, hooks: testHooks }
          })).steps
        ).toEqual([]);
      }).pipe(Effect.provide(isolatedLayer(home)));
    });

    for (const [index, seed] of testCase.emptySeeds.entries()) {
      it.effect(`${testCase.agent}: retains an empty file when cleanup targets an absent hook (${index})`, () => {
        const home = testHome();
        home.write(testCase.path, seed);
        return Effect.gen(function* () {
          yield* (yield* ArtifactFiles).remove(
            {
              kind: testCase.agent === "codex" ? "toml-entry" : "json-entry",
              path: home.path(testCase.path),
              pointer: "/hooks/Stop",
              member: `/opt/demo-app/bin/hook --agent ${testCase.agent}`,
              memberIn: "hook-group"
            },
            { removeEmptyFile: true }
          );
          expect(home.read(testCase.path)).toBe(seed);
        }).pipe(Effect.provide(isolatedLayer(home)));
      });

      it.effect(`${testCase.agent}: retains a pre-existing empty configuration file (${index})`, () => {
        const home = testHome();
        home.write(testCase.path, seed);
        return Effect.gen(function* () {
          yield* install(testCase);
          expect((yield* inventory()).entries.every((entry) => entry.preImage.existed === false)).toBe(true);
          yield* uninstall("demo-app", {
            providers: { install: testInstall, hooks: testHooks }
          });
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
        yield* uninstall("demo-app", { providers: { install: testInstall, hooks: testHooks } });
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

          const removed = yield* uninstall("demo-app", {
            providers: { install: testInstall, hooks: testHooks }
          });
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

            yield* uninstall(firstRemoved, {
              providers: { install: testInstall, hooks: testHooks }
            });
            expect(home.read(testCase.path)).toContain(`/opt/${lastRemoved}/bin/hook`);
            expect(home.read(testCase.path)).not.toContain(`/opt/${firstRemoved}/bin/hook`);
            yield* uninstall(lastRemoved, {
              providers: { install: testInstall, hooks: testHooks }
            });
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
        yield* uninstall("demo-app", { providers: { install: testInstall, hooks: testHooks } });
        expect(home.read(testCase.path)).toBeUndefined();
      }).pipe(Effect.provide(isolatedLayer(home)));
    });

    it.effect(`${testCase.agent}: inherits file provenance while another proven hook still matches`, () => {
      const home = testHome();
      return Effect.gen(function* () {
        yield* install(testCase, hooksBundle(testCase, "first-app"));
        const installed = home.read(testCase.path) ?? "";
        const edited = installed.replace(/\b5\b/, "9");
        expect(edited).not.toBe(installed);
        home.write(testCase.path, edited);

        yield* install(testCase, hooksBundle(testCase, "second-app"));
        const inherited = (yield* inventory()).entries.filter((entry) => entry.owners.includes("second-app"));
        expect(inherited).toHaveLength(4);
        expect(inherited.every((entry) => entry.createdConfigFile === true)).toBe(true);
        yield* uninstall("second-app", {
          providers: { install: testInstall, hooks: testHooks }
        });
        expect(
          (yield* uninstall("first-app", {
            providers: { install: testInstall, hooks: testHooks }
          })).kept
        ).toHaveLength(1);
        expect(home.read(testCase.path)).toContain("/opt/first-app/bin/hook");
        expect(home.read(testCase.path)).not.toContain("/opt/second-app/bin/hook");
        expect((yield* inventory()).entries).toEqual([]);
      }).pipe(Effect.provide(isolatedLayer(home)));
    });

    for (const malformedEvent of ["SessionStart", "Stop"]) {
      for (const stage of ["fresh install", "direct uninstall"]) {
        it.effect(
          `${testCase.agent}: tolerates another owner's malformed ${malformedEvent} hook during ${stage}`,
          () => {
            const home = testHome();
            const goodEvent = malformedEvent === "SessionStart" ? "Stop" : "SessionStart";
            return Effect.gen(function* () {
              if (stage === "fresh install") {
                yield* install(testCase, hooksBundle(testCase, "other-app", ["SessionStart", "Stop"]));
              } else {
                const otherBundle = hooksBundle(testCase, "other-app", [malformedEvent]);
                const ourBundle = hooksBundle(testCase, "demo-app", [goodEvent]);
                if (malformedEvent === "SessionStart") {
                  yield* install(testCase, otherBundle);
                  yield* install(testCase, ourBundle);
                } else {
                  yield* install(testCase, ourBundle);
                  yield* install(testCase, otherBundle);
                }
              }
              const pointers = (yield* inventory()).entries.map((entry) => entry.locator.pointer);
              expect(pointers.indexOf(`/hooks/${malformedEvent}`) < pointers.indexOf(`/hooks/${goodEvent}`)).toBe(
                malformedEvent === "SessionStart"
              );
              const goodOwner = stage === "fresh install" ? "other-app" : "demo-app";
              const command = `/opt/${goodOwner}/bin/hook --agent ${testCase.agent}`;
              home.write(
                testCase.path,
                testCase.agent === "codex"
                  ? `hooks.${malformedEvent} = { user = true }\n\n[[hooks.${goodEvent}]]\n[[hooks.${goodEvent}.hooks]]\ntype = "command"\ncommand = "${command}"\ntimeout = 5\n`
                  : `${JSON.stringify(
                      {
                        hooks: {
                          [malformedEvent]: { user: true },
                          [goodEvent]: [{ hooks: [{ type: "command", command, timeout: 5 }] }]
                        }
                      },
                      null,
                      2
                    )}\n`
              );

              if (stage === "fresh install") {
                yield* install(testCase, hooksBundle(testCase, "demo-app", [goodEvent]));
              }
              expect(
                (yield* uninstall("demo-app", {
                  providers: { install: testInstall, hooks: testHooks }
                })).kept
              ).toEqual([]);
              const remaining = home.read(testCase.path);
              expect(remaining).toBeDefined();
              if (testCase.agent === "codex") {
                expect(parseToml(remaining ?? "")).toMatchObject({ hooks: { [malformedEvent]: { user: true } } });
              } else {
                const parsed = parseJsonc(remaining ?? "");
                expect(parsed.ok).toBe(true);
                expect(parsed.ok ? parsed.value : undefined).toMatchObject({
                  hooks: { [malformedEvent]: { user: true } }
                });
              }
              expect(remaining).not.toContain("/opt/demo-app/bin/hook");
              expect((yield* inventory()).entries.every((entry) => !entry.owners.includes("demo-app"))).toBe(true);
            }).pipe(Effect.provide(isolatedLayer(home)));
          }
        );
      }
    }

    it.effect(`${testCase.agent}: revokes file provenance when the only other owner's hook is malformed`, () => {
      const home = testHome();
      return Effect.gen(function* () {
        yield* install(testCase, hooksBundle(testCase, "other-app", ["Stop"]));
        home.write(
          testCase.path,
          testCase.agent === "codex"
            ? "hooks.Stop = { user = true }\n"
            : `${JSON.stringify({ hooks: { Stop: { user: true } } }, null, 2)}\n`
        );

        yield* install(testCase, hooksBundle(testCase, "demo-app", ["SessionStart"]));
        const entries = (yield* inventory()).entries;
        expect(entries).toHaveLength(2);
        expect(entries.every((entry) => entry.createdConfigFile !== true)).toBe(true);
        yield* uninstall("demo-app", { providers: { install: testInstall, hooks: testHooks } });
        const remaining = home.read(testCase.path);
        expect(remaining).toBeDefined();
        expect(remaining).not.toContain("/opt/demo-app/bin/hook");
        if (testCase.agent === "codex") {
          expect(parseToml(remaining ?? "")).toEqual({ hooks: { Stop: { user: true } } });
        } else {
          const parsed = parseJsonc(remaining ?? "");
          expect(parsed.ok).toBe(true);
          expect(parsed.ok ? parsed.value : undefined).toEqual({ hooks: { Stop: { user: true } } });
        }
      }).pipe(Effect.provide(isolatedLayer(home)));
    });

    it.effect(`${testCase.agent}: deletes the new file after reinstall recreates a removed configuration file`, () => {
      const home = testHome();
      return Effect.gen(function* () {
        const bundle = hooksBundle(testCase, "demo-app", ["Stop"]);
        yield* install(testCase, bundle);
        yield* Effect.promise(() => home.platform.fs.remove(home.path(testCase.path)));
        yield* install(testCase, bundle);
        const reinstalled = (yield* inventory()).entries;
        expect(home.read(testCase.path)).toContain("/opt/demo-app/bin/hook");
        yield* uninstall("demo-app", { providers: { install: testInstall, hooks: testHooks } });
        expect(home.read(testCase.path)).toBeUndefined();
        expect(reinstalled.every((entry) => entry.createdConfigFile === true)).toBe(true);
        expect((yield* inventory()).entries).toEqual([]);
      }).pipe(Effect.provide(isolatedLayer(home)));
    });

    if (testCase.agent === "claude-code") {
      it.effect("propagates defects from the optional file-provenance observation", () => {
        const home = testHome();
        const base = isolatedLayer(home);
        const defectiveRead = Layer.effect(
          ArtifactFiles,
          Effect.gen(function* () {
            const files = yield* ArtifactFiles;
            return {
              ...files,
              read: (locator) =>
                locator.member?.includes("/opt/other-app/") === true
                  ? Effect.die("proof observation defect")
                  : files.read(locator)
            } satisfies typeof files;
          })
        ).pipe(Layer.provide(base));
        return Effect.gen(function* () {
          yield* install(testCase, hooksBundle(testCase, "other-app", ["Stop"]));
          const before = home.read(testCase.path);
          const plan = yield* planInstall(hooksBundle(testCase, "demo-app", ["SessionStart"]), {
            agents: [testCase.agent],
            strategies: testCase.strategies,
            providers: { install: testInstall, hooks: testHooks }
          });
          const result = yield* Effect.exit(applyInstall(plan).pipe(Effect.provide(Layer.merge(base, defectiveRead))));
          expect(Exit.isFailure(result) && Cause.hasDies(result.cause)).toBe(true);
          expect(home.read(testCase.path)).toBe(before);
        }).pipe(Effect.provide(base));
      });

      it.effect("propagates an own-target malformed-hook read failure", () => {
        const home = testHome();
        return Effect.gen(function* () {
          yield* install(testCase, hooksBundle(testCase, "demo-app", ["Stop"]));
          const changed = `${JSON.stringify({ hooks: { Stop: { user: true } } }, null, 2)}\n`;
          home.write(testCase.path, changed);
          expect(
            yield* Effect.flip(uninstall("demo-app", { providers: { install: testInstall, hooks: testHooks } }))
          ).toMatchObject({
            _tag: "UnexpectedShape",
            detail: "/hooks/Stop is not a list"
          });
          expect(home.read(testCase.path)).toBe(changed);
        }).pipe(Effect.provide(isolatedLayer(home)));
      });
    }

    it.effect(`${testCase.agent}: retains a replacement file after verify acknowledges a new hook hash`, () => {
      const home = testHome();
      return Effect.gen(function* () {
        yield* install(testCase, hooksBundle(testCase, "demo-app", ["Stop"]));
        const installed = home.read(testCase.path) ?? "";
        const replacement = installed.replace(/\b5\b/, "9");
        expect(replacement).not.toBe(installed);
        yield* Effect.promise(() => home.platform.fs.remove(home.path(testCase.path)));
        home.write(testCase.path, replacement);

        const report = yield* verify("demo-app", {
          bundle: hooksBundle(testCase, "demo-app", ["Stop"], 9),
          agents: [testCase.agent],
          ...(testCase.strategies === undefined ? {} : { strategies: testCase.strategies }),
          providers: { install: testInstall, hooks: testHooks }
        });
        expect(report.acknowledged).toHaveLength(1);
        const acknowledged = (yield* inventory()).entries;
        yield* uninstall("demo-app", { providers: { install: testInstall, hooks: testHooks } });
        expect(home.read(testCase.path)).toBeDefined();
        expect(home.read(testCase.path)).not.toContain("/opt/demo-app/bin/hook");
        expect(acknowledged.every((entry) => entry.createdConfigFile !== true)).toBe(true);
        expect((yield* inventory()).entries).toEqual([]);
      }).pipe(Effect.provide(isolatedLayer(home)));
    });

    it.effect(`${testCase.agent}: retains a replacement file after recovering a failed hook update`, () => {
      const home = testHome();
      const base = isolatedLayer(home);
      const beforeWriteFailure = Layer.effect(
        ArtifactFiles,
        Effect.gen(function* () {
          const files = yield* ArtifactFiles;
          return {
            ...files,
            write: (locator) =>
              Effect.fail({
                _tag: "ArtifactIoFailure" as const,
                path: locator.path,
                operation: "write" as const,
                message: "failed before writing"
              })
          } satisfies typeof files;
        })
      ).pipe(Layer.provide(base));
      return Effect.gen(function* () {
        yield* install(testCase, hooksBundle(testCase, "demo-app", ["Stop"]));
        const installed = home.read(testCase.path) ?? "";
        const replacement = installed.replace(/\b5\b/, "9");
        expect(replacement).not.toBe(installed);
        const failure = yield* Effect.flip(
          install(testCase, hooksBundle(testCase, "demo-app", ["Stop"], 9)).pipe(
            Effect.provide(Layer.merge(base, beforeWriteFailure))
          )
        );
        expect(failure).toMatchObject({ _tag: "ApplyFailed", completed: 0 });
        expect(home.read(testCase.path)).toBe(installed);
        expect((yield* inventory()).pending).toHaveLength(1);
        yield* Effect.promise(() => home.platform.fs.remove(home.path(testCase.path)));
        home.write(testCase.path, replacement);

        yield* uninstall("demo-app", { providers: { install: testInstall, hooks: testHooks } });
        expect(home.read(testCase.path)).toBeDefined();
        expect(home.read(testCase.path)).not.toContain("/opt/demo-app/bin/hook");
        expect((yield* inventory()).pending).toEqual([]);
        expect((yield* inventory()).entries).toEqual([]);
      }).pipe(Effect.provide(base));
    });

    for (const [index, seed] of testCase.emptySeeds.entries()) {
      it.effect(
        `${testCase.agent}: S1 retains a user-recreated empty file after the same owner reinstalls (${index})`,
        () => {
          const home = testHome();
          return Effect.gen(function* () {
            yield* install(testCase);
            yield* Effect.promise(() => home.platform.fs.remove(home.path(testCase.path)));
            home.write(testCase.path, seed);

            yield* install(testCase);
            const reinstalled = (yield* inventory()).entries;
            yield* uninstall("demo-app", {
              providers: { install: testInstall, hooks: testHooks }
            });
            expect(home.read(testCase.path)).toBeDefined();
            expect(home.read(testCase.path)).not.toContain("/opt/demo-app/bin/hook");
            expect(reinstalled.every((entry) => entry.createdConfigFile !== true)).toBe(true);
            expect((yield* inventory()).entries).toEqual([]);
          }).pipe(Effect.provide(isolatedLayer(home)));
        }
      );

      for (const firstRemoved of ["first-app", "second-app"]) {
        it.effect(
          `${testCase.agent}: S2 retains a user-recreated empty file after another owner installs (${index}, ${firstRemoved} first)`,
          () => {
            const home = testHome();
            return Effect.gen(function* () {
              yield* install(testCase, hooksBundle(testCase, "first-app"));
              yield* Effect.promise(() => home.platform.fs.remove(home.path(testCase.path)));
              home.write(testCase.path, seed);

              yield* install(testCase, hooksBundle(testCase, "second-app"));
              const reinstalled = (yield* inventory()).entries;
              const lastRemoved = firstRemoved === "first-app" ? "second-app" : "first-app";
              yield* uninstall(firstRemoved, {
                providers: { install: testInstall, hooks: testHooks }
              });
              expect(home.read(testCase.path)).toBeDefined();
              yield* uninstall(lastRemoved, {
                providers: { install: testInstall, hooks: testHooks }
              });
              expect(home.read(testCase.path)).toBeDefined();
              expect(home.read(testCase.path)).not.toContain("/bin/hook");
              expect(reinstalled.every((entry) => entry.createdConfigFile !== true)).toBe(true);
              expect((yield* inventory()).entries).toEqual([]);
            }).pipe(Effect.provide(isolatedLayer(home)));
          }
        );
      }

      for (const change of ["recreate", "truncate"] as const) {
        it.effect(`${testCase.agent}: retains a user-${change}d empty file without a reinstall (${index})`, () => {
          const home = testHome();
          return Effect.gen(function* () {
            yield* install(testCase);
            if (change === "recreate") {
              yield* Effect.promise(() => home.platform.fs.remove(home.path(testCase.path)));
            }
            home.write(testCase.path, seed);

            yield* uninstall("demo-app", {
              providers: { install: testInstall, hooks: testHooks }
            });
            expect(home.read(testCase.path)).toBe(seed);
            expect((yield* inventory()).entries).toEqual([]);
          }).pipe(Effect.provide(isolatedLayer(home)));
        });
      }
    }

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

          yield* uninstall("demo-app", {
            providers: { install: testInstall, hooks: testHooks }
          });
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
          yield* uninstall("demo-app", {
            providers: { install: testInstall, hooks: testHooks }
          });
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
      `${testCase.agent}: revokes old proof when another writer recreates a deleted file before reinstall writes`,
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
          const bundle = hooksBundle(testCase, "demo-app", ["Stop"]);
          yield* install(testCase, bundle);
          expect((yield* inventory()).entries).toEqual([expect.objectContaining({ createdConfigFile: true })]);
          yield* Effect.promise(() => home.platform.fs.remove(home.path(testCase.path)));
          const plan = yield* planInstall(bundle, {
            agents: [testCase.agent],
            ...(testCase.strategies === undefined ? {} : { strategies: testCase.strategies }),
            providers: { install: testInstall, hooks: testHooks }
          });
          const failure = yield* Effect.flip(
            applyInstall(plan).pipe(Effect.provide(Layer.merge(base, concurrentCreation)))
          );
          expect(failure).toMatchObject({ _tag: "TargetChanged", completed: 0 });
          expect(home.read(testCase.path)).toBe("");
          expect((yield* inventory()).pending).toEqual([]);
          expect(home.read(LEDGER_PATH)).not.toContain('"createdConfigFile"');

          yield* install(testCase, bundle);
          expect((yield* inventory()).entries).toHaveLength(1);
          expect(home.read(LEDGER_PATH)).not.toContain('"createdConfigFile"');
          yield* uninstall("demo-app", {
            providers: { install: testInstall, hooks: testHooks }
          });
          expect(home.read(testCase.path)).toBeDefined();
          expect(home.read(testCase.path)).not.toContain("/opt/demo-app/bin/hook");
          expect((yield* inventory()).entries).toEqual([]);
        }).pipe(Effect.provide(base));
      }
    );

    for (const stage of ["install", "uninstall"]) {
      it.effect(`${testCase.agent}: propagates a real own-target permission read failure during ${stage}`, () => {
        const home = testHome();
        const base = isolatedLayer(home);
        return Effect.gen(function* () {
          yield* install(testCase, hooksBundle(testCase, "demo-app", ["Stop"]));
          const installed = home.read(testCase.path);
          const plan =
            stage === "install"
              ? yield* planInstall(hooksBundle(testCase, "demo-app", ["Stop"], 9), {
                  agents: [testCase.agent],
                  ...(testCase.strategies === undefined ? {} : { strategies: testCase.strategies }),
                  providers: { install: testInstall, hooks: testHooks }
                })
              : undefined;
          const path = home.path(testCase.path);
          const mode = statSync(path).mode & 0o777;
          let previewed = false;
          const denyAfterPreview = Layer.effect(
            ArtifactFiles,
            Effect.gen(function* () {
              const files = yield* ArtifactFiles;
              return {
                ...files,
                preview: (previewPath, format, changes) =>
                  Effect.gen(function* () {
                    const result = yield* files.preview(previewPath, format, changes);
                    if (previewPath === path) {
                      previewed = true;
                      chmodSync(path, 0o000);
                    }
                    return result;
                  })
              } satisfies typeof files;
            })
          ).pipe(Layer.provide(base));
          if (stage === "install") {
            chmodSync(path, 0o000);
          }
          const operation =
            plan === undefined
              ? uninstall("demo-app", {
                  providers: { install: testInstall, hooks: testHooks }
                }).pipe(Effect.provide(Layer.merge(base, denyAfterPreview)))
              : applyInstall(plan);
          const failure = yield* Effect.flip(operation).pipe(Effect.ensuring(Effect.sync(() => chmodSync(path, mode))));
          expect(previewed).toBe(stage === "uninstall");
          expect(failure).toMatchObject({
            _tag: "ArtifactIoFailure",
            path,
            operation: "read",
            cause: { code: "EACCES" }
          });
          expect(home.read(testCase.path)).toBe(installed);
          expect((yield* inventory()).entries).toEqual([expect.objectContaining({ createdConfigFile: true })]);
          expect((yield* inventory()).pending).toEqual([]);
        }).pipe(Effect.provide(base));
      });
    }

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
            uninstall("demo-app", {
              providers: { install: testInstall, hooks: testHooks }
            }).pipe(Effect.provide(isolatedLayer(home, failingPlatform)))
          );
          expect(failure).toMatchObject({
            _tag: "ApplyFailed",
            completed: 0,
            cause: { _tag: "ArtifactIoFailure", message: "remove failed" }
          });
          expect(home.read(testCase.path)).toBe(installed);
          yield* Effect.gen(function* () {
            expect((yield* inventory()).pending).toHaveLength(1);
            yield* uninstall("demo-app", {
              providers: { install: testInstall, hooks: testHooks }
            });
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
        expect(
          (yield* uninstall("demo-app", {
            providers: { install: testInstall, hooks: testHooks }
          })).kept
        ).toHaveLength(4);
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
        const plan = yield* planInstall(demoBundle(), {
          agents,
          providers: { install: testInstall, hooks: testHooks }
        });
        expect(plan.commands).toEqual([]);
        yield* applyInstall(plan);
        expect(new Set((yield* inventory()).entries.flatMap((entry) => entry.agents))).toEqual(new Set(agents));
        expect(
          new Set(
            (yield* verify("demo-app", {
              bundle: demoBundle(),
              agents,
              providers: { install: testInstall, hooks: testHooks }
            })).artifacts.map((entry) => entry.status)
          )
        ).toEqual(new Set(["in-sync"]));
        const userDirectory = ".gemini/extensions/demo-app";
        home.write(`${userDirectory}/notes.txt`, "User notes.\n");

        const removed = yield* uninstall("demo-app", {
          providers: { install: testInstall, hooks: testHooks }
        });
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
