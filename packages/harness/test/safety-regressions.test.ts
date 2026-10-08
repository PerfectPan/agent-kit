import { cpSync, lstatSync, rmSync, symlinkSync } from "node:fs";

import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { parse } from "jsonc-parser";

import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { doctor } from "../src/application/use-cases/doctor.js";
import { inventory } from "../src/application/use-cases/inventory.js";
import { planInstall } from "../src/application/use-cases/plan-install.js";
import { uninstall } from "../src/application/use-cases/uninstall.js";
import { verify } from "../src/application/use-cases/verify.js";
import { locatorKey } from "../src/domain/install-plan/index.js";
import { demoBundle } from "./support/bundles.js";
import { FAKE_CODEX } from "./support/fake-codex.js";
import { removeTestHomes, testHome } from "./support/home.js";

afterEach(removeTestHomes);

const sharedConfig = { strategies: { "claude-code": { hooks: "shared-config" } } } as const;
const skill = (version: string, extra = false) =>
  demoBundle(version, {
    artifacts: [
      {
        type: "skill",
        name: "demo-skill",
        files: extra ? { "SKILL.md": "skill", "extras/keep.txt": "replacement" } : { "SKILL.md": "skill" }
      }
    ]
  });

describe("directory write safety", () => {
  it.effect("S95: refuses creation through a parent replaced by a symlink after planning", () => {
    const home = testHome();
    return Effect.gen(function* () {
      const plan = yield* planInstall(skill("1"), { agents: ["claude-code"] });
      home.write(".claude/skills/placeholder", "unchanged");
      home.write("outside/demo-skill/SKILL.md", "user data");
      rmSync(home.path(".claude/skills"), { recursive: true });
      symlinkSync(home.path("outside"), home.path(".claude/skills"));
      const failure = yield* Effect.flip(applyInstall(plan));
      expect(failure).toMatchObject({ _tag: "TargetChanged", completed: 0 });
      expect(home.read("outside/demo-skill/SKILL.md")).toBe("user data");
      expect(lstatSync(home.path(".claude/skills")).isSymbolicLink()).toBe(true);
      expect((yield* inventory()).entries).toEqual([]);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("S95: a nested symlink makes an upgrade a conflict and leaves outside data and the link intact", () => {
    const home = testHome();
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(skill("1"), { agents: ["claude-code"] }));
      const before = yield* inventory();
      home.write("outside/keep.txt", "user data");
      symlinkSync(home.path("outside"), home.path(".claude/skills/demo-skill/extras"));

      const failure = yield* Effect.flip(planInstall(skill("2", true), { agents: ["claude-code"] }));
      expect(failure).toMatchObject({
        _tag: "PlanConflict",
        conflicts: [{ step: { conflict: "symlinked-target" }, choices: [] }]
      });
      expect(home.read("outside/keep.txt")).toBe("user data");
      expect(home.read(".claude/skills/demo-skill/SKILL.md")).toBe("skill");
      expect(lstatSync(home.path(".claude/skills/demo-skill/extras")).isSymbolicLink()).toBe(true);
      expect(yield* inventory()).toEqual(before);
    }).pipe(Effect.provide(home.layer()));
  });

  for (const location of ["nested", "artifact"] as const) {
    it.effect(
      `S95: refuses a ${location} symlink introduced after planning, even when the content hash stays the same`,
      () => {
        const home = testHome();
        return Effect.gen(function* () {
          const initial =
            location === "artifact"
              ? demoBundle("1", {
                  artifacts: [
                    {
                      type: "skill",
                      name: "demo-skill",
                      files: { "SKILL.md": "skill", "extras/keep.txt": "user data" }
                    }
                  ]
                })
              : skill("1");
          yield* applyInstall(yield* planInstall(initial, { agents: ["claude-code"] }));
          const plan = yield* planInstall(skill("2", true), { agents: ["claude-code"] });
          const before = yield* inventory();
          const installed = home.path(".claude/skills/demo-skill");
          if (location === "artifact") {
            cpSync(installed, home.path("outside"), { recursive: true });
            rmSync(installed, { recursive: true });
            symlinkSync(home.path("outside"), installed);
          } else {
            home.write("outside/keep.txt", "user data");
            symlinkSync(home.path("outside"), `${installed}/extras`);
          }
          const failure = yield* Effect.flip(applyInstall(plan));
          expect(failure).toMatchObject({ _tag: "TargetChanged", completed: 0 });
          expect(home.read(location === "artifact" ? "outside/extras/keep.txt" : "outside/keep.txt")).toBe("user data");
          expect(lstatSync(location === "artifact" ? installed : `${installed}/extras`).isSymbolicLink()).toBe(true);
          expect(yield* inventory()).toEqual(before);
        }).pipe(Effect.provide(home.layer()));
      }
    );
  }

  it.effect("S95: rechecks nested symlinks at the step boundary after persisting pending", () => {
    const home = testHome();
    let armed = false;
    let injected = false;
    const platform = {
      ...home.platform,
      fs: {
        ...home.platform.fs,
        async writeAtomic(path, content, options) {
          if (armed && !injected && path.endsWith("/ledger.json")) {
            injected = true;
            symlinkSync(home.path("outside"), home.path(".claude/skills/demo-skill/extras"));
          }
          return home.platform.fs.writeAtomic(path, content, options);
        }
      }
    } satisfies typeof home.platform;
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(skill("1"), { agents: ["claude-code"] }));
      const plan = yield* planInstall(skill("2", true), { agents: ["claude-code"] });
      home.write("outside/keep.txt", "user data");
      armed = true;
      const failure = yield* Effect.flip(applyInstall(plan));
      expect(injected).toBe(true);
      expect(failure).toMatchObject({ _tag: "TargetChanged", completed: 0 });
      expect(home.read("outside/keep.txt")).toBe("user data");
      expect(home.read(".claude/skills/demo-skill/SKILL.md")).toBe("skill");
    }).pipe(Effect.provide(home.layer(platform)));
  });

  for (const removal of ["delete", "restore-pre-image"] as const) {
    it.effect(`S95: keeps a directory containing a symlink instead of performing ${removal}`, () => {
      const home = testHome();
      if (removal === "restore-pre-image") {
        home.write(".claude/skills/demo-skill/SKILL.md", "previous user skill");
      }
      return Effect.gen(function* () {
        const choices =
          removal === "restore-pre-image"
            ? { [locatorKey({ kind: "dir", path: home.path(".claude/skills/demo-skill") })]: "backup" as const }
            : undefined;
        const plan = yield* planInstall(skill("1"), {
          agents: ["claude-code"],
          ...(choices === undefined ? {} : { choices })
        });
        yield* applyInstall(plan);
        home.write("outside/keep.txt", "user data");
        symlinkSync(home.path("outside"), home.path(".claude/skills/demo-skill/extras"));
        const report = yield* uninstall("demo-app");
        expect(report.plan.steps).toMatchObject([{ action: "remove", removal: "keep", note: "symlinked-target" }]);
        expect(home.read("outside/keep.txt")).toBe("user data");
        expect(home.read(".claude/skills/demo-skill/SKILL.md")).toBe("skill");
        expect(lstatSync(home.path(".claude/skills/demo-skill/extras")).isSymbolicLink()).toBe(true);
        expect((yield* inventory()).entries).toEqual([]);
      }).pipe(Effect.provide(home.layer()));
    });
  }
});

describe("hook ownership and execution safety", () => {
  it.effect("S33: protects renamed commands when the first uninstall already supplies legacy markers", () => {
    const home = testHome();
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(demoBundle(), { agents: ["claude-code"], ...sharedConfig }));
      const edited = (home.read(".claude/settings.json") ?? "").replaceAll(
        "demo-hook --agent",
        "demo-hook --verbose --agent"
      );
      home.write(".claude/settings.json", edited);
      for (let attempt = 0; attempt < 2; attempt++) {
        yield* uninstall("demo-app", { legacyMarkers: ["demo-hook"] });
        expect(home.read(".claude/settings.json")).toBe(edited);
        expect((yield* inventory()).entries).toEqual([]);
      }
    }).pipe(Effect.provide(home.layer()));
  });

  for (const agent of ["claude-code", "codex"] as const) {
    it.effect(`S33: keeps ${agent} hook command edits through repeated legacy cleanup`, () => {
      const home = testHome();
      const file = agent === "codex" ? ".codex/config.toml" : ".claude/settings.json";
      return Effect.gen(function* () {
        yield* applyInstall(yield* planInstall(demoBundle(), { agents: [agent], ...sharedConfig }));
        const edited = (home.read(file) ?? "").replaceAll("demo-hook --agent", "demo-hook --verbose --agent");
        home.write(file, edited);
        const unsafeUpgrade = yield* Effect.flip(
          planInstall(demoBundle("2", { legacyMarkers: [] }), { agents: [agent] })
        );
        expect(
          unsafeUpgrade._tag === "PlanConflict" &&
            unsafeUpgrade.conflicts.map(({ step, choices }) => [step.conflict, choices])
        ).toEqual([
          ["user-modified", []],
          ["user-modified", []],
          ["user-modified", []]
        ]);
        yield* uninstall("demo-app");
        expect(home.read(file)).toBe(edited);
        expect((yield* inventory()).entries).toEqual([]);
        for (let attempt = 0; attempt < 2; attempt++) {
          const removed = yield* uninstall("demo-app", { legacyMarkers: ["demo-hook"] });
          expect(removed.plan.steps).toEqual([]);
          expect(home.read(file)).toBe(edited);
        }
        const reinstall = yield* Effect.flip(planInstall(demoBundle("2", { legacyMarkers: [] }), { agents: [agent] }));
        expect(
          reinstall._tag === "PlanConflict" && reinstall.conflicts.map(({ step, choices }) => [step.conflict, choices])
        ).toEqual([
          ["user-modified", []],
          ["user-modified", []],
          ["user-modified", []]
        ]);
        expect(home.read(file)).toBe(edited);
      }).pipe(Effect.provide(home.layer()));
    });
  }

  for (const agent of ["grok", "cursor"] as const) {
    it.effect(
      `S91: migrating only ${agent} removes Claude hooks it executes and preserves unrelated user hooks`,
      () => {
        const home = testHome();
        home.write(
          ".claude/settings.json",
          JSON.stringify(
            {
              hooks: {
                Stop: [
                  {
                    hooks: [
                      { type: "command", command: "legacy-demo hook" },
                      { type: "command", command: "/opt/user/notify" }
                    ]
                  }
                ]
              }
            },
            null,
            2
          )
        );
        return Effect.gen(function* () {
          const plan = yield* planInstall(demoBundle(), { agents: [agent] });
          expect(
            plan.steps
              .filter((step) => step.legacy)
              .map((step) => [step.action, step.locator.path, step.locator.member])
          ).toEqual([["remove", home.path(".claude/settings.json"), "legacy-demo hook"]]);
          yield* applyInstall(plan);
          expect(parse(home.read(".claude/settings.json") ?? "{}")).toEqual({
            hooks: { Stop: [{ hooks: [{ type: "command", command: "/opt/user/notify" }] }] }
          });
          expect(
            (yield* doctor({ agents: [agent], markers: ["legacy-demo hook", "demo-hook"] })).filter(
              (check) => check.name === "duplicate-hook"
            )
          ).toEqual([]);
        }).pipe(Effect.provide(home.layer()));
      }
    );
  }

  it.effect(
    "S91: Grok migration scans foreign local settings and flat Cursor hooks, preserving unrelated commands",
    () => {
      const home = testHome();
      home.write(
        ".claude/settings.local.json",
        JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "legacy-demo hook --local" }] }] } })
      );
      home.write(
        ".cursor/hooks.json",
        JSON.stringify({ hooks: { stop: [{ command: "legacy-demo hook --cursor" }, { command: "/opt/user/notify" }] } })
      );
      return Effect.gen(function* () {
        const plan = yield* planInstall(demoBundle(), { agents: ["grok"] });
        expect(plan.steps.filter((step) => step.legacy)).toHaveLength(2);
        yield* applyInstall(plan);
        expect(home.read(".claude/settings.local.json")).not.toContain("legacy-demo");
        expect(parse(home.read(".cursor/hooks.json") ?? "{}")).toEqual({
          hooks: { stop: [{ command: "/opt/user/notify" }] }
        });
        expect(
          (yield* doctor({ agents: ["grok"], markers: ["legacy-demo hook", "demo-hook"] })).filter(
            (check) => check.name === "duplicate-hook"
          )
        ).toEqual([]);
      }).pipe(Effect.provide(home.layer()));
    }
  );

  it.effect("S91: leaves a foreign legacy file alone when its execution is explicitly disabled", () => {
    const home = testHome();
    const settings = JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "legacy-demo hook" }] }] } });
    home.write(".claude/settings.json", settings);
    return Effect.gen(function* () {
      const plan = yield* planInstall(demoBundle(), {
        agents: ["grok"],
        compat: [{ runner: "grok", agent: "claude-code", enabled: false }]
      });
      expect(plan.steps.some((step) => step.legacy)).toBe(false);
      yield* applyInstall(plan);
      expect(home.read(".claude/settings.json")).toBe(settings);
      expect(home.read(".grok/hooks/demo-app.json")).toContain("demo-hook --agent grok");
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("S94: a Grok-only replacement conflicts when a tracked Claude hook must stay for Claude", () => {
    const home = testHome();
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(demoBundle(), { agents: ["claude-code"], ...sharedConfig }));
      const settings = home.read(".claude/settings.json");
      const before = yield* inventory();
      const failure = yield* Effect.flip(planInstall(demoBundle("2"), { agents: ["grok"] }));
      expect(
        failure._tag === "PlanConflict" && failure.conflicts.map(({ step, choices }) => [step.locator.path, choices])
      ).toEqual([
        [home.path(".claude/settings.json"), []],
        [home.path(".claude/settings.json"), []],
        [home.path(".claude/settings.json"), []]
      ]);
      expect(home.read(".claude/settings.json")).toBe(settings);
      expect(home.read(".grok/hooks/demo-app.json")).toBeUndefined();
      expect(yield* inventory()).toEqual(before);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("S91: foreign legacy hooks managed by chezmoi block a Grok-only replacement before any writes", () => {
    const home = testHome();
    const settings = JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "legacy-demo hook" }] }] }
    });
    home.write(".claude/settings.json", settings);
    home.command("chezmoi", `console.log(${JSON.stringify(home.path(".claude/settings.json"))});`);
    return Effect.gen(function* () {
      const failure = yield* Effect.flip(planInstall(demoBundle(), { agents: ["grok"] }));
      expect(failure).toMatchObject({
        _tag: "PlanConflict",
        conflicts: [{ step: { conflict: "dotfiles-managed" }, choices: [] }]
      });
      expect(home.read(".claude/settings.json")).toBe(settings);
      expect(home.read(".grok/hooks/demo-app.json")).toBeUndefined();
      expect((yield* inventory()).entries).toEqual([]);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect(
    "S95: a tracked hook in chezmoi-managed settings blocks replacement and remains uninstallable without duplication",
    () => {
      const home = testHome();
      return Effect.gen(function* () {
        yield* applyInstall(yield* planInstall(demoBundle(), { agents: ["claude-code"], ...sharedConfig }));
        const settings = home.read(".claude/settings.json");
        const before = yield* inventory();
        home.command("chezmoi", `console.log(${JSON.stringify(home.path(".claude/settings.json"))});`);
        const failure = yield* Effect.flip(planInstall(demoBundle("2"), { agents: ["claude-code"] }));
        expect(
          failure._tag === "PlanConflict" && failure.conflicts.map(({ step, choices }) => [step.conflict, choices])
        ).toEqual([
          ["dotfiles-managed", []],
          ["dotfiles-managed", []],
          ["dotfiles-managed", []]
        ]);
        expect(home.read(".claude/settings.json")).toBe(settings);
        expect(home.read(".claude/skills/demo-app/hooks/hooks.json")).toBeUndefined();
        expect(yield* inventory()).toEqual(before);
        expect((yield* doctor({ agents: ["claude-code"] })).filter((check) => check.name === "duplicate-hook")).toEqual(
          []
        );
        yield* uninstall("demo-app");
        expect(home.read(".claude/settings.json")).toBe(settings);
        expect((yield* inventory()).entries).toEqual([]);
      }).pipe(Effect.provide(home.layer()));
    }
  );

  it.effect(
    "S99: a disabled Codex plugin is user-modified, cannot be silently acknowledged, and re-enabling it restores sync",
    () => {
      const home = testHome();
      home.command("codex", FAKE_CODEX);
      return Effect.gen(function* () {
        const bundle = demoBundle();
        yield* applyInstall(yield* planInstall(bundle, { agents: ["codex"] }));
        const enabled = home.read(".codex/config.toml") ?? "";
        expect(enabled).toContain("enabled = true");
        home.write(".codex/config.toml", enabled.replace("enabled = true", "enabled = false"));
        const before = yield* inventory();
        for (const options of [{}, { bundle }] as const) {
          const report = yield* verify("demo-app", options);
          expect(
            report.artifacts.find((artifact) => artifact.locator.pointer === "/plugins/demo-app@demo-app")?.status
          ).toBe("user-modified");
          expect(report.acknowledged).toEqual([]);
          expect(yield* inventory()).toEqual(before);
        }
        home.write(".codex/config.toml", enabled);
        expect((yield* verify("demo-app")).artifacts.every((artifact) => artifact.status === "in-sync")).toBe(true);
      }).pipe(Effect.provide(home.layer()));
    }
  );
});
