import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { parse } from "jsonc-parser";

import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { inventory } from "../src/application/use-cases/inventory.js";
import { planInstall } from "../src/application/use-cases/plan-install.js";
import { uninstall } from "../src/application/use-cases/uninstall.js";
import { demoBundle } from "./support/bundles.js";
import { removeTestHomes, type TestHome, testHome } from "./support/home.js";

afterEach(removeTestHomes);

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
const MARKERS = ["legacy-demo hook", "plugins/legacy-demo.js"];

interface Group {
  readonly hooks: readonly { readonly command: string }[];
}

/**
 * Every command Claude Code runs for each event: its settings file plus every skills-dir plugin's hooks file. An event
 * that fires once has one command of the application's.
 */
function claudeRuns(home: TestHome): Record<string, string[]> {
  const runs: Record<string, string[]> = {};
  const add = (hooks: Record<string, readonly Group[]> | undefined) => {
    for (const [event, groups] of Object.entries(hooks ?? {})) {
      runs[event] = [...(runs[event] ?? []), ...groups.flatMap((group) => group.hooks.map((hook) => hook.command))];
    }
  };
  add((parse(home.read(".claude/settings.json") ?? "{}") as { hooks?: Record<string, Group[]> }).hooks);
  add(
    (parse(home.read(".claude/skills/demo-app/hooks/hooks.json") ?? "{}") as { hooks?: Record<string, Group[]> }).hooks
  );
  return runs;
}

const ours = (runs: Record<string, string[]>, event: string) =>
  (runs[event] ?? []).filter((command) => command.includes("demo-hook") || command.includes("legacy-demo hook"));

/** What the older version's setup did: drop its own hooks from the settings file, then add one per event. */
function oldSetup(home: TestHome): void {
  const settings = parse(home.read(".claude/settings.json") ?? "{}") as { hooks?: Record<string, Group[]> };
  const hooks: Record<string, Group[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = groups
      .map((group) => ({ ...group, hooks: group.hooks.filter((hook) => !hook.command.includes("legacy-demo hook")) }))
      .filter((group) => group.hooks.length > 0);
    hooks[event] = kept;
  }
  for (const event of ["SessionStart", "Stop"]) {
    hooks[event] = [
      ...(hooks[event] ?? []),
      {
        hooks: [
          { command: `npx --yes legacy-demo hook --source claude --event ${event} >/dev/null 2>/dev/null || true` }
        ]
      }
    ];
  }
  home.write(".claude/settings.json", `${JSON.stringify({ ...settings, hooks }, null, 2)}\n`);
}

describe("hooks an older version installed without a ledger (plan 3.10)", () => {
  it.effect("S91: are replaced by the plugin's, not installed a second time, and the user's own hook stays", () => {
    const home = testHome();
    home.write(".claude/settings.json", fixture("legacy-claude-settings.json"));
    return Effect.gen(function* () {
      const plan = yield* planInstall(demoBundle("2.0.0", { legacyMarkers: MARKERS }), { agents: ["claude-code"] });
      expect(
        plan.steps.filter((step) => step.legacy === true).map((step) => [step.action, step.locator.pointer])
      ).toEqual([
        ["remove", "/hooks/Stop"],
        ["remove", "/hooks/SessionStart"]
      ]);
      yield* applyInstall(plan);
      const runs = claudeRuns(home);
      for (const event of ["SessionStart", "UserPromptSubmit", "Stop"]) {
        expect(ours(runs, event)).toEqual(["/opt/demo/bin/demo-hook --agent claude-code"]);
      }
      expect(runs.Stop).toContain("/u/me/bin/notify-done.sh");
      expect(home.read(".claude/settings.json")).toContain(
        "// Hooks that an older version of the application registered"
      );
      // Legacy hooks were never the owner's in the ledger, so only the plugin and skill are recorded.
      expect((yield* inventory()).entries.map((entry) => entry.locator.kind).toSorted()).toEqual(["dir", "dir"]);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect(
    "S91: block the install while they sit in a file chezmoi manages, and an uninstall leaves them with a note",
    () => {
      const home = testHome();
      home.write(".claude/settings.json", fixture("legacy-claude-settings.json"));
      home.command(
        "chezmoi",
        `if (process.argv[2] === "managed") console.log(${JSON.stringify(home.path(".claude/settings.json"))});`
      );
      return Effect.gen(function* () {
        const failure = yield* Effect.flip(
          planInstall(demoBundle("2.0.0", { legacyMarkers: MARKERS }), { agents: ["claude-code"] })
        );
        expect(
          failure._tag === "PlanConflict" &&
            failure.conflicts.map(({ step, choices }) => [step.locator.pointer, step.conflict, choices])
        ).toEqual([
          ["/hooks/SessionStart", "dotfiles-managed", []],
          ["/hooks/Stop", "dotfiles-managed", []]
        ]);
        const removed = yield* uninstall("demo-app", { agents: ["claude-code"], legacyMarkers: MARKERS });
        expect(removed.plan.notes.map(({ note }) => note)).toEqual(["dotfiles-managed", "dotfiles-managed"]);
        expect(home.read(".claude/settings.json")).toBe(fixture("legacy-claude-settings.json"));
      }).pipe(Effect.provide(home.layer()));
    }
  );

  it.effect("S91: are replaced in place when the settings file is the strategy", () => {
    const home = testHome();
    home.write(".claude/settings.json", fixture("legacy-claude-settings.json"));
    return Effect.gen(function* () {
      const plan = yield* planInstall(demoBundle("2.0.0", { legacyMarkers: MARKERS }), {
        agents: ["claude-code"],
        strategies: { "claude-code": { hooks: "shared-config" } }
      });
      yield* applyInstall(plan);
      const runs = claudeRuns(home);
      for (const event of ["SessionStart", "UserPromptSubmit", "Stop"]) {
        expect(ours(runs, event)).toEqual(["/opt/demo/bin/demo-hook --agent claude-code"]);
      }
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("S91: are removed from Codex's config.toml, where the user's array-table group after them stays", () => {
    const home = testHome();
    const user = `[[hooks.Stop]]\nmatcher = ""\n\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "/usr/local/bin/notify"\n`;
    const old = `[[hooks.Stop]]\n\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "npx --yes legacy-demo hook --event Stop"\n`;
    home.write(".codex/config.toml", `model = "gpt-5.5"\n\n${old}\n${user}`);
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(demoBundle("2.0.0", { legacyMarkers: MARKERS }), { agents: ["codex"] }));
      const text = home.read(".codex/config.toml") ?? "";
      expect(text).toContain(user);
      expect(text).not.toContain("legacy-demo hook");
      yield* uninstall("demo-app");
      expect(home.read(".codex/config.toml")).toBe(`model = "gpt-5.5"\n\n${user}`);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("are removed with the old opencode plugin file and its config entry; other plugins stay", () => {
    const home = testHome();
    home.write(".config/opencode/plugins/legacy-demo.js", fixture("legacy-opencode-plugin.js"));
    home.write(".config/opencode/opencode.json", fixture("legacy-opencode.json"));
    return Effect.gen(function* () {
      yield* applyInstall(
        yield* planInstall(demoBundle("2.0.0", { legacyMarkers: MARKERS }), { agents: ["opencode"] })
      );
      expect(home.read(".config/opencode/plugins/legacy-demo.js")).toBeUndefined();
      expect(parse(home.read(".config/opencode/opencode.json") ?? "")).toEqual({
        $schema: "https://opencode.ai/config.json",
        plugin: ["some-other-plugin"]
      });
      expect(home.read(".config/opencode/plugins/demo-app.js")).toContain("demo-hook --agent opencode");
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("S91: are removed by an uninstall with markers when the new version was never installed", () => {
    const home = testHome();
    home.write(".claude/settings.json", fixture("legacy-claude-settings.json"));
    home.write(".config/opencode/plugins/legacy-demo.js", fixture("legacy-opencode-plugin.js"));
    return Effect.gen(function* () {
      expect((yield* inventory()).entries).toEqual([]);
      const removed = yield* uninstall("demo-app", { legacyMarkers: MARKERS });
      expect(removed.steps.map((step) => step.locator.path.slice(home.home.length)).toSorted()).toEqual([
        "/.claude/settings.json",
        "/.claude/settings.json",
        "/.config/opencode/plugins/legacy-demo.js"
      ]);
      expect(ours(claudeRuns(home), "Stop")).toEqual([]);
      expect(claudeRuns(home).Stop).toEqual(["/u/me/bin/notify-done.sh"]);
      expect(home.read(".config/opencode/plugins/legacy-demo.js")).toBeUndefined();
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect(
    "S92 (6.5) downgrade: install the new version, uninstall it, run the old setup: each event fires once",
    () => {
      const home = testHome();
      home.write(".claude/settings.json", fixture("legacy-claude-settings.json"));
      return Effect.gen(function* () {
        yield* applyInstall(
          yield* planInstall(demoBundle("2.0.0", { legacyMarkers: MARKERS }), { agents: ["claude-code"] })
        );
        // Running the old setup now, without uninstalling, would fire both the plugin's hook and the old one.
        const skipped = claudeRuns(home);
        expect(ours(skipped, "Stop")).toHaveLength(1);

        const removed = yield* uninstall("demo-app", { legacyMarkers: MARKERS });
        expect(removed.kept).toEqual([]);
        expect(home.read(".claude/skills/demo-app/hooks/hooks.json")).toBeUndefined();
        expect((yield* inventory()).entries).toEqual([]);
        oldSetup(home);
        const runs = claudeRuns(home);
        for (const event of ["SessionStart", "Stop"]) {
          expect(ours(runs, event)).toHaveLength(1);
        }
        expect(ours(runs, "UserPromptSubmit")).toEqual([]);
        expect(runs.Stop).toContain("/u/me/bin/notify-done.sh");
      }).pipe(Effect.provide(home.layer()));
    }
  );
});
