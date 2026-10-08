import { cpSync, mkdirSync, rmSync, symlinkSync } from "node:fs";

import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { applyInstall } from "../src/application/apply-install.js";
import { inventory } from "../src/application/inventory.js";
import { planInstall } from "../src/application/plan-install.js";
import { uninstall } from "../src/application/uninstall.js";
import { demoBundle } from "./support/bundles.js";
import { FAKE_CODEX } from "./support/fake-codex.js";
import { removeTestHomes, testHome, type TestHome } from "./support/home.js";

afterEach(removeTestHomes);

const cache = ".codex/plugins/cache/demo-app/demo-app";
const copy = `${cache}/local/hooks/hooks.json`;
const initial = demoBundle("1", {
  artifacts: [{ type: "hooks", command: "/opt/demo-hook", timeoutSeconds: 5, events: { codex: ["Stop"] } }]
});
const upgrade = demoBundle("2", {
  artifacts: [{ type: "hooks", command: "/opt/demo-hook", timeoutSeconds: 6, events: { codex: ["Stop"] } }]
});

function replaceWithLink(home: TestHome, location: "ancestor" | "directory" | "installed-copy"): void {
  const relative = location === "ancestor" ? ".codex/plugins/cache" : location === "directory" ? cache : copy;
  home.write("outside/personal.txt", "user data");
  if (location === "installed-copy") {
    home.write("outside/hooks.json", home.read(copy) ?? "user hooks");
    rmSync(home.path(copy), { force: true });
    mkdirSync(home.path(`${cache}/local/hooks`), { recursive: true });
    symlinkSync(home.path("outside/hooks.json"), home.path(copy));
  } else {
    if (home.read(copy) !== undefined) {
      cpSync(home.path(relative), home.path("outside"), { recursive: true });
    }
    rmSync(home.path(relative), { recursive: true, force: true });
    mkdirSync(home.path(relative.slice(0, relative.lastIndexOf("/"))), { recursive: true });
    symlinkSync(home.path("outside"), home.path(relative));
  }
}

describe("CLI registration side-effect paths", () => {
  for (const stage of ["initial", "upgrade", "uninstall"] as const) {
    for (const location of ["ancestor", "directory", "installed-copy"] as const) {
      it.effect(`S95: protects ${location} symlinks during CLI ${stage}`, () => {
        const home = testHome();
        home.command("codex", FAKE_CODEX);
        return Effect.gen(function* () {
          if (stage !== "initial") {
            yield* applyInstall(yield* planInstall(initial, { agents: ["codex"] }));
          }
          const before = yield* inventory();
          const calls = home.read("codex-calls.log") ?? "";
          replaceWithLink(home, location);
          const config = home.read(".codex/config.toml");
          const outsideHooks = home.read("outside/hooks.json");
          if (stage === "uninstall") {
            const report = yield* uninstall("demo-app");
            expect(report.plan.steps).toContainEqual(
              expect.objectContaining({
                locator: expect.objectContaining({ pointer: "/plugins/demo-app@demo-app" }),
                removal: "keep",
                note: "symlinked-target"
              })
            );
            expect((home.read("codex-calls.log") ?? "").slice(calls.length)).not.toContain(
              "plugin remove demo-app@demo-app"
            );
            expect(home.read(".codex/config.toml")).toContain('[plugins."demo-app@demo-app"]');
          } else {
            const failure = yield* Effect.flip(
              planInstall(stage === "initial" ? initial : upgrade, { agents: ["codex"] })
            );
            expect(failure).toMatchObject({ _tag: "PlanConflict" });
            expect(failure._tag === "PlanConflict" && failure.conflicts).toContainEqual(
              expect.objectContaining({
                step: expect.objectContaining({ conflict: "symlinked-target" }),
                choices: []
              })
            );
            expect(home.read("codex-calls.log") ?? "").toBe(calls);
            expect(home.read(".codex/config.toml")).toBe(config);
            expect(yield* inventory()).toEqual(before);
          }
          expect(home.read("outside/personal.txt")).toBe("user data");
          expect(home.read("outside/hooks.json")).toBe(outsideHooks);
          if (stage === "initial") {
            expect(home.read("outside/demo-app/demo-app/local/hooks/hooks.json")).toBeUndefined();
            expect(home.read("outside/local/hooks/hooks.json")).toBeUndefined();
          }
        }).pipe(Effect.provide(home.layer()));
      });
    }
  }

  for (const stage of ["initial", "upgrade", "uninstall"] as const) {
    it.effect(`S95: rejects a cache ancestor substituted after planning CLI ${stage}`, () => {
      const home = testHome();
      home.command("codex", FAKE_CODEX);
      return Effect.gen(function* () {
        if (stage !== "initial") {
          yield* applyInstall(yield* planInstall(initial, { agents: ["codex"] }));
        }
        const plan = yield* planInstall(
          stage === "initial" ? initial : stage === "upgrade" ? upgrade : demoBundle("2", { artifacts: [] }),
          { agents: ["codex"] }
        );
        const before = yield* inventory();
        const calls = home.read("codex-calls.log") ?? "";
        replaceWithLink(home, "ancestor");
        const failure = yield* Effect.flip(applyInstall(plan));
        expect(failure).toMatchObject({ _tag: "TargetChanged", completed: 0 });
        expect(home.read("outside/personal.txt")).toBe("user data");
        expect(home.read("codex-calls.log") ?? "").toBe(calls);
        expect(yield* inventory()).toEqual(before);
      }).pipe(Effect.provide(home.layer()));
    });
  }

  it.effect("S95: rechecks copies after pending is persisted before calling the CLI", () => {
    const home = testHome();
    home.command("codex", FAKE_CODEX);
    let armed = false;
    let injected = false;
    const platform = {
      ...home.platform,
      fs: {
        ...home.platform.fs,
        async writeAtomic(path, content, options) {
          if (armed && !injected && path.endsWith("/ledger.json")) {
            injected = true;
            replaceWithLink(home, "ancestor");
          }
          return home.platform.fs.writeAtomic(path, content, options);
        }
      }
    } satisfies typeof home.platform;
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(initial, { agents: ["codex"] }));
      const plan = yield* planInstall(upgrade, { agents: ["codex"] });
      const calls = home.read("codex-calls.log") ?? "";
      armed = true;
      const failure = yield* Effect.flip(applyInstall(plan));
      expect(injected).toBe(true);
      expect(failure).toMatchObject({ _tag: "TargetChanged" });
      expect(home.read("outside/personal.txt")).toBe("user data");
      expect(home.read("codex-calls.log") ?? "").toBe(calls);
    }).pipe(Effect.provide(home.layer(platform)));
  });

  for (const destination of ["dotfiles/codex", ".agents/codex"]) {
    it.effect(
      `S95: supports a resolved agent home at ${destination} for CLI installation, upgrade and fallback uninstall`,
      () => {
        const home = testHome();
        home.command("codex", FAKE_CODEX);
        home.write(`${destination}/config.toml`, 'model = "user-model"\n');
        symlinkSync(home.path(destination), home.path(".codex"));
        return Effect.gen(function* () {
          yield* applyInstall(yield* planInstall(initial, { agents: ["codex"] }));
          yield* applyInstall(yield* planInstall(upgrade, { agents: ["codex"] }));
          expect(home.read(copy)).toContain('"timeout": 6');
          rmSync(home.path("bin/codex"));
          yield* uninstall("demo-app");
          expect(home.read(copy)).toBeUndefined();
          expect(home.read(`${destination}/config.toml`)?.trim()).toBe('model = "user-model"');
        }).pipe(Effect.provide(home.layer()));
      }
    );
  }

  it.effect("S95: rechecks registration targets between the unregister and register commands", () => {
    const home = testHome();
    home.command("codex", FAKE_CODEX);
    let armed = false;
    const platform = {
      ...home.platform,
      process: {
        ...home.platform.process,
        async run(command, args, options) {
          const result = await home.platform.process.run(command, args, options);
          if (armed && args?.join(" ") === "plugin remove demo-app@demo-app") {
            replaceWithLink(home, "ancestor");
          }
          return result;
        }
      }
    } satisfies typeof home.platform;
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(initial, { agents: ["codex"] }));
      const plan = yield* planInstall(upgrade, { agents: ["codex"] });
      const calls = home.read("codex-calls.log") ?? "";
      armed = true;
      const failure = yield* Effect.flip(applyInstall(plan));
      expect(failure).toMatchObject({ _tag: "ApplyFailed", cause: { _tag: "ArtifactIoFailure" } });
      expect((home.read("codex-calls.log") ?? "").slice(calls.length)).toBe("plugin remove demo-app@demo-app\n");
      expect(home.read("outside/personal.txt")).toBe("user data");
      expect(home.read("outside/demo-app/demo-app/local/hooks/hooks.json")).toBeUndefined();
    }).pipe(Effect.provide(home.layer(platform)));
  });

  it.effect("S95: detects a changed agent home link after planning instead of calling the CLI in the new home", () => {
    const home = testHome();
    home.command("codex", FAKE_CODEX);
    home.write("dotfiles/codex/config.toml", 'model = "user-model"\n');
    symlinkSync(home.path("dotfiles/codex"), home.path(".codex"));
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(initial, { agents: ["codex"] }));
      const plan = yield* planInstall(upgrade, { agents: ["codex"] });
      const calls = home.read("codex-calls.log");
      cpSync(home.path("dotfiles/codex"), home.path("outside"), { recursive: true });
      rmSync(home.path(".codex"));
      symlinkSync(home.path("outside"), home.path(".codex"));
      home.write("outside/plugins/cache/demo-app/demo-app/personal.txt", "user data");
      const failure = yield* Effect.flip(applyInstall(plan));
      expect(failure).toMatchObject({ _tag: "TargetChanged", completed: 0 });
      expect(home.read("outside/plugins/cache/demo-app/demo-app/personal.txt")).toBe("user data");
      expect(home.read("codex-calls.log")).toBe(calls);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("S95: another allowed root cannot mask redirection of the CLI's specific home after planning", () => {
    const home = testHome();
    home.command("codex", FAKE_CODEX);
    home.write(".agents/codex/config.toml", 'model = "user-model"\n');
    symlinkSync(home.path(".agents/codex"), home.path(".codex"));
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(initial, { agents: ["codex"] }));
      const plan = yield* planInstall(upgrade, { agents: ["codex"] });
      const before = yield* inventory();
      const calls = home.read("codex-calls.log");
      cpSync(home.path(".agents/codex"), home.path("outside"), { recursive: true });
      rmSync(home.path(".codex"));
      symlinkSync(home.path("outside"), home.path(".codex"));
      home.write("outside/plugins/cache/demo-app/demo-app/personal.txt", "user data");
      const config = home.read("outside/config.toml");
      const result = yield* Effect.result(applyInstall(plan));
      expect(home.read("outside/plugins/cache/demo-app/demo-app/personal.txt")).toBe("user data");
      expect(home.read("outside/config.toml")).toBe(config);
      expect(home.read("codex-calls.log")).toBe(calls);
      expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "TargetChanged", completed: 0 } });
      expect(yield* inventory()).toEqual(before);
    }).pipe(Effect.provide(home.layer()));
  });
});
