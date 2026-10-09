import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { doctor } from "../src/application/use-cases/doctor.js";
import { inventory } from "../src/application/use-cases/inventory.js";
import { planInstall } from "../src/application/use-cases/plan-install.js";
import { verify } from "../src/application/use-cases/verify.js";
import { demoBundle, SHIM } from "./support/bundles.js";
import { removeTestHomes, testHome } from "./support/home.js";

afterEach(removeTestHomes);

describe("verify", () => {
  it.effect(
    "S98: tells the user's changes, deletions and outdated content apart, and records a ledger that is behind",
    () => {
      const home = testHome();
      return Effect.gen(function* () {
        yield* applyInstall(yield* planInstall(demoBundle("1.0.0"), { agents: ["gemini-cli", "grok"] }));
        const before = yield* inventory();

        home.write(".grok/hooks/demo-app.json", "{}\n");
        // Someone wrote exactly what 2.0.0 wants into the extension's manifest.
        home.write(
          ".gemini/extensions/demo-app/gemini-extension.json",
          `${JSON.stringify({ name: "demo-app", version: "2.0.0" }, null, 2)}\n`
        );
        const plain = yield* verify("demo-app");
        expect(
          plain.artifacts.map((artifact) => [artifact.locator.path.slice(home.home.length), artifact.status])
        ).toEqual([
          ["/.agents/skills/demo-skill", "in-sync"],
          ["/.gemini/extensions/demo-app", "user-modified"],
          ["/.grok/hooks/demo-app.json", "user-modified"]
        ]);
        expect(plain.acknowledged).toEqual([]);

        const withBundle = yield* verify("demo-app", { bundle: demoBundle("2.0.0") });
        expect(withBundle.acknowledged.map((locator) => locator.path)).toEqual([
          home.path(".gemini/extensions/demo-app")
        ]);
        expect(withBundle.artifacts.find((artifact) => artifact.locator.path.endsWith("demo-app"))?.status).toBe(
          "in-sync"
        );
        const after = yield* inventory();
        expect(after.revision).toBe(before.revision + 1);
      }).pipe(Effect.provide(home.layer()));
    }
  );

  it.effect(
    "verifies the ledger's agents even when one of them has no install adapter and the bundle does not need it",
    () => {
      const home = testHome();
      const bundle = demoBundle("1.0.0", {
        artifacts: [{ type: "hooks", command: SHIM, timeoutSeconds: 5, events: { grok: ["Stop"] } }]
      });
      return Effect.gen(function* () {
        yield* applyInstall(yield* planInstall(bundle, { agents: ["grok"] }));
        // Another tool recorded its own agent under the owner's entries; verify covers the ledger's agents.
        const stored = JSON.parse(home.read(".local/state/agent-kit/harness/user/ledger.json") ?? "{}");
        for (const entry of Object.values<(typeof stored.entries)[string]>(stored.entries)) {
          entry.agents = [...entry.agents, "my-agent"];
        }
        home.write(".local/state/agent-kit/harness/user/ledger.json", `${JSON.stringify(stored)}\n`);
        const report = yield* verify("demo-app", { bundle });
        expect(report.acknowledged).toEqual([]);
        expect(report.artifacts.map((artifact) => [artifact.locator.path, artifact.status])).toEqual([
          [home.path(".grok/hooks/demo-app.json"), "in-sync"]
        ]);
      }).pipe(Effect.provide(home.layer()));
    }
  );
});

describe("doctor", () => {
  it.effect(
    "reports hooks that never run, wrong timeout units, missing programs and duplicates; never changes them",
    () => {
      const home = testHome();
      const settings = `${JSON.stringify(
        {
          hooks: {
            PreToolUse: [{ hooks: [{ type: "command", command: "/gone/bin/old-hook", timeout: 5 }] }],
            AfterAgent: [
              { hooks: [{ type: "command", command: "/gone/bin/old-hook", timeout: 5 }] },
              { hooks: [{ type: "command", command: "/gone/bin/old-hook", timeout: 5 }] }
            ]
          }
        },
        null,
        2
      )}\n`;
      home.write(".gemini/settings.json", settings);
      return Effect.gen(function* () {
        const checks = yield* doctor({ agents: ["gemini-cli"] });
        const found = (name: string) =>
          checks.filter((check) => check.name === name).map((check) => check.locator?.pointer);
        expect(checks.find((check) => check.name === "ledger")).toMatchObject({ status: "ok" });
        expect(checks.find((check) => check.name === "lock")).toMatchObject({ status: "ok" });
        expect(found("unknown-event")).toEqual(["/hooks/PreToolUse"]);
        expect(found("timeout-unit")).toEqual(["/hooks/PreToolUse", "/hooks/AfterAgent", "/hooks/AfterAgent"]);
        expect(found("stale-path")).toHaveLength(3);
        expect(found("duplicate-hook")).toEqual(["/hooks/AfterAgent"]);
        expect(home.read(".gemini/settings.json")).toBe(settings);
      }).pipe(Effect.provide(home.layer()));
    }
  );

  it.effect(
    "S110: reports an old hook in a settings file next to the plugin that replaced it, in every agent that runs both",
    () => {
      const home = testHome();
      home.write(
        ".claude/settings.json",
        `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "npx legacy-demo hook --event Stop" }] }] } })}\n`
      );
      return Effect.gen(function* () {
        // Installed without the legacy markers, so the old hook stays.
        const bundle = demoBundle("1.0.0", { legacyMarkers: [] });
        yield* applyInstall(yield* planInstall(bundle, { agents: ["claude-code", "grok"] }));
        const checks = yield* doctor({ agents: ["claude-code", "grok"], markers: ["legacy-demo hook", "demo-hook"] });
        expect(checks.filter((check) => check.name === "duplicate-hook").map((check) => check.message)).toEqual([
          "claude-code runs 2 hooks of one application for Stop",
          "grok runs 2 hooks of one application for Stop"
        ]);
        expect(yield* doctor({ agents: ["claude-code"] })).not.toContainEqual(
          expect.objectContaining({ name: "duplicate-hook" })
        );
      }).pipe(Effect.provide(home.layer()));
    }
  );

  it.effect(
    "audits Claude Code's settings.local.json in the runner that loads it too, not in Claude Code's own audit",
    () => {
      const home = testHome();
      const settings = (variant: string) =>
        `${JSON.stringify({
          hooks: { Stop: [{ hooks: [{ type: "command", command: `npx legacy-demo hook --event Stop (${variant})` }] }] }
        })}\n`;
      home.write(".claude/settings.json", settings("settings.json"));
      home.write(".claude/settings.local.json", settings("settings.local.json"));
      return Effect.gen(function* () {
        // Grok runs both of Claude Code's files, so the application fires twice there.
        const grok = yield* doctor({ agents: ["grok"], markers: ["legacy-demo hook"] });
        expect(grok.filter((check) => check.name === "duplicate-hook").map((check) => check.message)).toEqual([
          "grok runs 2 hooks of one application for Stop"
        ]);
        // Claude Code's own audit reads neither file as a runner, so it sees one hook of the application.
        const claude = yield* doctor({ agents: ["claude-code"], markers: ["legacy-demo hook"] });
        expect(claude.filter((check) => check.name === "duplicate-hook")).toEqual([]);
      }).pipe(Effect.provide(home.layer()));
    }
  );

  it("reports drift of owned Artifacts and a missing lock implementation", async () => {
    const home = testHome();
    await Effect.runPromise(
      Effect.flatMap(planInstall(demoBundle(), { agents: ["grok"] }), applyInstall).pipe(Effect.provide(home.layer()))
    );
    home.write(".grok/hooks/demo-app.json", "{}\n");
    // A run of its own: Layers built in one run are shared by the Effects of that run.
    const checks = await Effect.runPromise(
      doctor({ agents: ["grok"] }).pipe(Effect.provide(home.layer({ ...home.platform, sqlite: undefined })))
    );
    expect(checks.filter((check) => check.status !== "ok").map((check) => [check.name, check.message])).toEqual([
      ["drift", "user-modified"],
      ["lock", "the platform has no SQLite, and no other LedgerLock was provided"]
    ]);
  });
});
