import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { applyInstall } from "../src/application/apply-install.js";
import { inventory } from "../src/application/inventory.js";
import { planInstall } from "../src/application/plan-install.js";
import { uninstall } from "../src/application/uninstall.js";
import { demoBundle } from "./support/bundles.js";
import { removeTestHomes, testHome } from "./support/home.js";

afterEach(removeTestHomes);

const sharedConfig = { strategies: { "claude-code": { hooks: "shared-config" } } } as const;

describe("kept hook replacement ownership", () => {
  for (const sameEvent of [true, false]) {
    it.effect(
      `S33: kept hooks of another owner permit an unrelated plugin with ${sameEvent ? "the same" : "a different"} event`,
      () => {
        const home = testHome();
        return Effect.gen(function* () {
          yield* applyInstall(yield* planInstall(demoBundle(), { agents: ["claude-code"], ...sharedConfig }));
          home.write(
            ".claude/settings.json",
            (home.read(".claude/settings.json") ?? "").replaceAll("demo-hook --agent", "demo-hook --verbose --agent")
          );
          yield* uninstall("demo-app");
          const edited = home.read(".claude/settings.json");
          const bundle = demoBundle("1", {
            owner: "other-app",
            legacyMarkers: ["other-legacy"],
            artifacts: [
              {
                type: "hooks",
                command: "/opt/other-hook",
                events: { "claude-code": [sameEvent ? "Stop" : "PreToolUse"] }
              }
            ]
          });
          yield* applyInstall(yield* planInstall(bundle, { agents: ["claude-code"] }));
          expect(home.read(".claude/skills/other-app/hooks/hooks.json")).toContain("/opt/other-hook");
          expect(home.read(".claude/settings.json")).toBe(edited);
          yield* uninstall("other-app", { legacyMarkers: ["demo-hook"] });
          expect(home.read(".claude/settings.json")).toBe(edited);
          expect((yield* inventory()).entries).toEqual([]);
        }).pipe(Effect.provide(home.layer()));
      }
    );
  }

  for (const match of ["owner", "marker", "command"] as const) {
    it.effect(`S33: still refuses replacement when the protected hook matches the ${match}`, () => {
      const home = testHome();
      return Effect.gen(function* () {
        yield* applyInstall(yield* planInstall(demoBundle(), { agents: ["claude-code"], ...sharedConfig }));
        home.write(
          ".claude/settings.json",
          (home.read(".claude/settings.json") ?? "").replaceAll("demo-hook --agent", "demo-hook --verbose --agent")
        );
        yield* uninstall("demo-app");
        const edited = home.read(".claude/settings.json");
        const before = yield* inventory();
        const bundle = demoBundle("2", {
          owner: match === "owner" ? "demo-app" : "other-app",
          legacyMarkers: match === "marker" ? ["demo-hook"] : [],
          artifacts: [
            {
              type: "hooks",
              command: match === "command" ? "/opt/demo/bin/demo-hook --verbose --agent {agent}" : "/opt/other-hook",
              events: { "claude-code": ["Stop"] }
            }
          ]
        });
        const failure = yield* Effect.flip(planInstall(bundle, { agents: ["claude-code"] }));
        expect(failure).toMatchObject({ _tag: "PlanConflict" });
        expect(home.read(".claude/settings.json")).toBe(edited);
        expect(yield* inventory()).toEqual(before);
      }).pipe(Effect.provide(home.layer()));
    });
  }
});
