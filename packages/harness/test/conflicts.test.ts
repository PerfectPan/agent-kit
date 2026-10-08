import { mkdirSync, readFileSync, symlinkSync } from "node:fs";

import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { applyInstall } from "../src/application/apply-install.js";
import { inventory } from "../src/application/inventory.js";
import { planInstall } from "../src/application/plan-install.js";
import { uninstall } from "../src/application/uninstall.js";
import { locatorKey } from "../src/domain/install-plan/index.js";
import { demoBundle, SHIM } from "./support/bundles.js";
import { removeTestHomes, testHome } from "./support/home.js";

afterEach(removeTestHomes);

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
const sharedConfig = { strategies: { "claude-code": { hooks: "shared-config" } } } as const;

describe("conflicts and foreign owners", () => {
  it.effect(
    "S32: refuses a plan with an unrecorded skill in the way until a backup choice, then restores it on uninstall",
    () => {
      const home = testHome();
      home.write(".claude/skills/demo-skill/SKILL.md", "the user's own skill\n");
      return Effect.gen(function* () {
        const failure = yield* Effect.flip(planInstall(demoBundle(), { agents: ["claude-code"] }));
        expect(failure._tag).toBe("PlanConflict");
        const conflict = failure._tag === "PlanConflict" ? failure.conflicts[0] : undefined;
        expect(conflict).toMatchObject({ step: { conflict: "unmanaged-exists" }, choices: ["adopt", "backup"] });
        const key = locatorKey(conflict!.step.locator);
        const plan = yield* planInstall(demoBundle(), { agents: ["claude-code"], choices: { [key]: "backup" } });
        yield* applyInstall(plan);
        expect(home.read(".claude/skills/demo-skill/SKILL.md")).toContain("name: demo-skill");
        yield* uninstall("demo-app");
        expect(home.read(".claude/skills/demo-skill/SKILL.md")).toBe("the user's own skill\n");
      }).pipe(Effect.provide(home.layer()));
    }
  );

  it.effect("S33: uninstall keeps an Artifact the user changed and reports it", () => {
    const home = testHome();
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(demoBundle(), { agents: ["grok"] }));
      home.write(".grok/hooks/demo-app.json", '{ "hooks": {} }\n');
      const removed = yield* uninstall("demo-app");
      expect(removed.kept.map((locator) => locator.path)).toEqual([home.path(".grok/hooks/demo-app.json")]);
      expect(home.read(".grok/hooks/demo-app.json")).toBe('{ "hooks": {} }\n');
      expect(home.read(".agents/skills/demo-skill/SKILL.md")).toBeUndefined();
      expect((yield* inventory()).entries).toEqual([]);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect(
    "S33: a file kept as the user's is never taken for an older version's later, though it carries a marker",
    () => {
      const home = testHome();
      const markers = ["demo-hook --agent"];
      const plugin = ".config/opencode/plugins/demo-app.js";
      return Effect.gen(function* () {
        yield* applyInstall(yield* planInstall(demoBundle(), { agents: ["opencode"] }));
        home.write(plugin, `${home.read(plugin) ?? ""}// the user's change\n`);
        const edited = home.read(plugin);
        const first = yield* uninstall("demo-app", { legacyMarkers: markers });
        expect(first.kept.map((locator) => locator.path)).toEqual([home.path(plugin)]);
        expect((yield* inventory()).entries).toEqual([]);

        const second = yield* uninstall("demo-app", { agents: ["opencode"], legacyMarkers: markers });
        expect(second.plan.steps).toEqual([]);
        expect(home.read(plugin)).toBe(edited);
        const reinstall = yield* Effect.flip(
          planInstall(demoBundle("1.0.0", { legacyMarkers: markers }), { agents: ["opencode"] })
        );
        expect(reinstall).toMatchObject({
          _tag: "PlanConflict",
          conflicts: [{ step: { conflict: "unmanaged-exists" } }]
        });
      }).pipe(Effect.provide(home.layer()));
    }
  );

  it.effect("S95: refuses to write through a symlinked settings file, which an atomic write would replace", () => {
    const home = testHome();
    home.write("dotfiles/claude-settings.json", fixture("claude-settings.json"));
    mkdirSync(home.path(".claude"));
    symlinkSync(home.path("dotfiles/claude-settings.json"), home.path(".claude/settings.json"));
    return Effect.gen(function* () {
      const failure = yield* Effect.flip(planInstall(demoBundle(), { agents: ["claude-code"], ...sharedConfig }));
      expect(failure).toMatchObject({ _tag: "PlanConflict" });
      expect(
        failure._tag === "PlanConflict" && failure.conflicts.map(({ step, choices }) => [step.conflict, choices])
      ).toEqual([
        ["symlinked-target", []],
        ["symlinked-target", []],
        ["symlinked-target", []]
      ]);
      // The skills-dir plugin needs no write to the linked file.
      yield* applyInstall(yield* planInstall(demoBundle(), { agents: ["claude-code"] }));
      expect(home.read("dotfiles/claude-settings.json")).toBe(fixture("claude-settings.json"));
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("S95: resolves a symlinked agent home and writes into the directory it points to", () => {
    const home = testHome();
    mkdirSync(home.path("dotfiles/claude"), { recursive: true });
    symlinkSync(home.path("dotfiles/claude"), home.path(".claude"));
    return Effect.gen(function* () {
      const plan = yield* planInstall(demoBundle(), { agents: ["claude-code"] });
      expect(plan.steps.every((step) => step.locator.path.startsWith(home.path("dotfiles/claude/")))).toBe(true);
      yield* applyInstall(plan);
      expect(home.read("dotfiles/claude/skills/demo-app/hooks/hooks.json")).toContain(
        SHIM.replace("{agent}", "claude-code")
      );
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("S95: leaves a path chezmoi manages alone: a write there is a conflict no choice resolves", () => {
    const home = testHome();
    home.write(".claude/settings.json", fixture("claude-settings.json"));
    home.command(
      "chezmoi",
      `if (process.argv[2] === "managed") console.log(${JSON.stringify(home.path(".claude/settings.json"))});`
    );
    return Effect.gen(function* () {
      const failure = yield* Effect.flip(planInstall(demoBundle(), { agents: ["claude-code"], ...sharedConfig }));
      expect(
        failure._tag === "PlanConflict" && failure.conflicts.map(({ step, choices }) => [step.conflict, choices])
      ).toEqual([
        ["dotfiles-managed", []],
        ["dotfiles-managed", []],
        ["dotfiles-managed", []]
      ]);
    }).pipe(Effect.provide(home.layer()));
  });
});

describe("chezmoi behind a symlinked agent home", () => {
  it.effect("S95: matches what chezmoi lists under the home with the resolved path the plan writes", () => {
    const home = testHome();
    home.write("dotfiles/claude/settings.json", fixture("claude-settings.json"));
    symlinkSync(home.path("dotfiles/claude"), home.path(".claude"));
    home.command(
      "chezmoi",
      `if (process.argv[2] === "managed") console.log(${JSON.stringify(home.path(".claude/settings.json"))});`
    );
    return Effect.gen(function* () {
      const failure = yield* Effect.flip(planInstall(demoBundle(), { agents: ["claude-code"], ...sharedConfig }));
      expect(failure._tag === "PlanConflict" && failure.conflicts.map(({ step }) => step.conflict)).toEqual([
        "dotfiles-managed",
        "dotfiles-managed",
        "dotfiles-managed"
      ]);
    }).pipe(Effect.provide(home.layer()));
  });
});

describe("agents that run other agents' hooks", () => {
  it.effect("S94: registers each event once per agent when Claude Code's settings file is the strategy", () => {
    const home = testHome();
    const bundle = demoBundle("1.0.0", {
      artifacts: [
        {
          type: "hooks",
          command: SHIM,
          events: {
            "claude-code": ["SessionStart", "Stop"],
            grok: ["SessionStart", "Stop"],
            cursor: ["sessionStart", "stop"]
          }
        }
      ]
    });
    return Effect.gen(function* () {
      const plan = yield* planInstall(bundle, { agents: ["claude-code", "grok", "cursor"], ...sharedConfig });
      expect(
        plan.droppedHooks.map(({ agent, firedBy }) => `${agent} ${firedBy.agent} ${firedBy.event}`).toSorted()
      ).toEqual([
        "cursor claude-code SessionStart",
        "cursor claude-code Stop",
        "grok claude-code SessionStart",
        "grok claude-code Stop"
      ]);
      yield* applyInstall(plan);
      // Grok and Cursor get no files of their own: they run Claude Code's registrations.
      expect(home.read(".grok/hooks/demo-app.json")).toBeUndefined();
      expect(home.read(".cursor/plugins/local/demo-app/hooks/hooks.json")).toBeUndefined();
      const entries = (yield* inventory()).entries;
      expect(entries.map((entry) => [entry.locator.pointer, entry.agents])).toEqual([
        ["/hooks/SessionStart", ["claude-code", "cursor", "grok"]],
        ["/hooks/Stop", ["claude-code", "cursor", "grok"]]
      ]);
      // Uninstalling for Grok alone releases its use of the registrations; they stay for the others.
      const partial = yield* uninstall("demo-app", { agents: ["grok"] });
      expect(partial.plan.steps.map((step) => step.removal)).toEqual(["release", "release"]);
      expect(home.read(".claude/settings.json")).toContain("demo-hook --agent claude-code");
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect(
    "agent-presence#89: refuses an observer on PreToolUse in Claude Code's settings file, a Cursor gate",
    () => {
      const home = testHome();
      const bundle = demoBundle("1.0.0", {
        artifacts: [{ type: "hooks", command: SHIM, events: { "claude-code": ["PreToolUse"] } }]
      });
      return Effect.gen(function* () {
        const failure = yield* Effect.flip(planInstall(bundle, { agents: ["claude-code"], ...sharedConfig }));
        expect(failure).toMatchObject({
          _tag: "HookSpecRejected",
          agent: "claude-code",
          event: "PreToolUse",
          reason: "blocking-gate",
          runBy: { agent: "cursor", event: "preToolUse" }
        });
        // In the skills-dir plugin, which Cursor does not run, it is only Claude Code's own PreToolUse.
        yield* applyInstall(yield* planInstall(bundle, { agents: ["claude-code"] }));
        expect(home.read(".claude/skills/demo-app/hooks/hooks.json")).toContain('"PreToolUse"');
      }).pipe(Effect.provide(home.layer()));
    }
  );
});
