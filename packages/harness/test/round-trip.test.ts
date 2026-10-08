import { readFileSync, rmSync } from "node:fs";

import { parse as parseToml } from "@decimalturn/toml-patch";
import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { applyInstall } from "../src/application/apply-install.js";
import { inventory } from "../src/application/inventory.js";
import { planInstall } from "../src/application/plan-install.js";
import { uninstall } from "../src/application/uninstall.js";
import { verify } from "../src/application/verify.js";
import { demoBundle } from "./support/bundles.js";
import { FAKE_CODEX } from "./support/fake-codex.js";
import { removeTestHomes, type TestHome, testHome } from "./support/home.js";
import { snapshotFiles } from "./support/snapshot.js";

afterEach(removeTestHomes);

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
const json = (text: string | undefined) => JSON.parse(text ?? "null") as Record<string, unknown>;

interface Case {
  readonly agent: CodingAgentId;
  /** Files the user already has, by path in the home. */
  readonly seed?: Readonly<Record<string, string>>;
  readonly strategies?: { readonly hooks?: "native-plugin" | "shared-config" | "scan-directory" };
  /** Checks the installed files. */
  readonly installed: (home: TestHome) => void;
}

const SKILL = "---\nname: demo-skill\ndescription: Demo\n---\nHello\n";

const cases: readonly Case[] = [
  {
    agent: "claude-code",
    seed: { ".claude/settings.json": fixture("claude-settings.json") },
    installed(home) {
      expect(json(home.read(".claude/skills/demo-app/.claude-plugin/plugin.json"))).toMatchObject({ name: "demo-app" });
      expect(json(home.read(".claude/skills/demo-app/hooks/hooks.json"))).toEqual({
        hooks: Object.fromEntries(
          ["SessionStart", "UserPromptSubmit", "Stop"].map((event) => [
            event,
            [{ hooks: [{ type: "command", command: "/opt/demo/bin/demo-hook --agent claude-code", timeout: 5 }] }]
          ])
        )
      });
      expect(home.read(".claude/skills/demo-skill/SKILL.md")).toBe(SKILL);
      // The plugin needs no settings change.
      expect(home.read(".claude/settings.json")).toBe(fixture("claude-settings.json"));
    }
  },
  {
    agent: "claude-code",
    seed: { ".claude/settings.json": fixture("claude-settings.json") },
    strategies: { hooks: "shared-config" },
    installed(home) {
      const text = home.read(".claude/settings.json") ?? "";
      expect(text).toContain("// The user's own settings; harness must keep these comments.");
      expect(text).toContain('"command": "/u/me/bin/notify-done.sh"');
      expect(text.match(/demo-hook --agent claude-code/g)).toHaveLength(3);
    }
  },
  {
    agent: "codex",
    seed: { ".codex/config.toml": fixture("codex-config.toml") },
    installed(home) {
      const text = home.read(".codex/config.toml") ?? "";
      for (const line of fixture("codex-config.toml")
        .split("\n")
        .filter((l) => l.includes("#"))) {
        expect(text).toContain(line);
      }
      const ours = { hooks: [{ type: "command", command: "/opt/demo/bin/demo-hook --agent codex", timeout: 5 }] };
      expect((parseToml(text) as { hooks: Record<string, unknown> }).hooks).toEqual({
        SessionStart: [ours],
        UserPromptSubmit: [ours],
        // The user's own group stays first, with its handler.
        Stop: [{ matcher: "", hooks: [{ type: "command", command: "/usr/local/bin/notify" }] }, ours]
      });
      expect(home.read(".agents/skills/demo-skill/SKILL.md")).toBe(SKILL);
    }
  },
  {
    agent: "gemini-cli",
    seed: { ".gemini/settings.json": fixture("gemini-settings.json") },
    installed(home) {
      expect(json(home.read(".gemini/extensions/demo-app/gemini-extension.json"))).toEqual({
        name: "demo-app",
        version: "1.0.0"
      });
      const hooks = json(home.read(".gemini/extensions/demo-app/hooks/hooks.json")).hooks as Record<string, unknown>;
      expect(Object.keys(hooks).toSorted()).toEqual(["AfterAgent", "BeforeAgent", "SessionStart"]);
      // Gemini CLI counts milliseconds (agent-presence#85).
      expect(JSON.stringify(hooks)).toContain('"timeout":5000');
      expect(home.read(".gemini/settings.json")).toBe(fixture("gemini-settings.json"));
    }
  },
  {
    agent: "gemini-cli",
    seed: { ".gemini/settings.json": fixture("gemini-settings.json") },
    strategies: { hooks: "shared-config" },
    installed(home) {
      const text = home.read(".gemini/settings.json") ?? "";
      expect(text).toContain("// Gemini CLI settings with the user's own hook.");
      expect(text.match(/demo-hook --agent gemini-cli/g)).toHaveLength(3);
    }
  },
  {
    agent: "grok",
    installed(home) {
      const hooks = json(home.read(".grok/hooks/demo-app.json")).hooks as Record<string, unknown>;
      expect(Object.keys(hooks).toSorted()).toEqual(["SessionStart", "Stop", "UserPromptSubmit"]);
    }
  },
  {
    agent: "cursor",
    installed(home) {
      expect(json(home.read(".cursor/plugins/local/demo-app/hooks/hooks.json"))).toEqual({
        hooks: Object.fromEntries(
          ["beforeSubmitPrompt", "sessionStart", "stop"].map((event) => [
            event,
            [{ command: "/opt/demo/bin/demo-hook --agent cursor", timeout: 5 }]
          ])
        )
      });
    }
  },
  {
    agent: "opencode",
    installed(home) {
      const source = home.read(".config/opencode/plugins/demo-app.js") ?? "";
      expect(source).toContain('const COMMAND = "/opt/demo/bin/demo-hook --agent opencode"');
      expect(source).toContain('["session.created","session.idle","session.status"]');
    }
  },
  {
    agent: "pi",
    installed(home) {
      const source = home.read(".pi/agent/extensions/demo-app.ts") ?? "";
      expect(source).toContain('const COMMAND = "/opt/demo/bin/demo-hook --agent pi"');
      expect(source).toContain('["agent_end","agent_start","session_shutdown","session_start"]');
    }
  }
];

describe("S90, S93: plan → apply → verify → uninstall in a temporary home", () => {
  it.effect.each(cases)("$agent $strategies.hooks", (testCase) => {
    const home = testHome();
    for (const [path, content] of Object.entries(testCase.seed ?? {})) {
      home.write(path, content);
    }
    const before = snapshotFiles(home.home);
    const strategies =
      testCase.strategies === undefined ? {} : { strategies: { [testCase.agent]: testCase.strategies } };
    return Effect.gen(function* () {
      const plan = yield* planInstall(demoBundle(), { agents: [testCase.agent], ...strategies });
      expect(plan.status).toBe("ready");
      expect(plan.changes.length).toBeGreaterThan(0);
      for (const change of plan.changes) {
        expect(change.before).toBe(before[change.path.slice(home.home.length + 1)]);
      }
      const report = yield* applyInstall(plan);
      expect(plan.status).toBe("applied");
      testCase.installed(home);
      // The plan's preview is what was written.
      for (const change of plan.changes) {
        expect(home.read(change.path.slice(home.home.length + 1))).toBe(change.after);
      }
      const ledger = yield* inventory();
      expect(ledger.revision).toBe(report.ledgerRevision);
      expect(ledger.entries.length).toBe(plan.steps.length);
      expect(ledger.entries.every((entry) => entry.owners.includes("demo-app"))).toBe(true);

      const verified = yield* verify("demo-app", { bundle: demoBundle(), agents: [testCase.agent], ...strategies });
      expect(new Set(verified.artifacts.map((artifact) => artifact.status))).toEqual(new Set(["in-sync"]));

      // Planning the same bundle again changes nothing.
      const again = yield* planInstall(demoBundle(), { agents: [testCase.agent], ...strategies });
      expect(new Set(again.steps.map((step) => step.action))).toEqual(new Set(["noop"]));
      expect(again.changes).toEqual([]);

      const removed = yield* uninstall("demo-app");
      expect(removed.kept).toEqual([]);
      expect(snapshotFiles(home.home)).toEqual(before);
      expect((yield* inventory()).entries).toEqual([]);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect(
    "S99: installs Codex hooks as a plugin of the owner's own marketplace when the codex command is there",
    () => {
      const home = testHome();
      home.command("codex", FAKE_CODEX);
      home.write(".codex/config.toml", fixture("codex-config.toml"));
      return Effect.gen(function* () {
        const plan = yield* planInstall(demoBundle(), { agents: ["codex"] });
        const marketplace = `${home.home}/.codex/plugins/demo-app`;
        expect(plan.commands.map(({ command, args, purpose }) => [command, ...args, purpose])).toEqual([
          ["codex", "plugin", "marketplace", "add", marketplace, "register"],
          ["codex", "plugin", "add", "demo-app@demo-app", "register"]
        ]);
        expect(plan.expectedTrustPrompts).toEqual([
          { agent: "codex", kind: "hook-review", locator: { kind: "dir", path: marketplace } }
        ]);
        yield* applyInstall(plan);
        const config = parseToml(home.read(".codex/config.toml") ?? "") as Record<string, Record<string, unknown>>;
        expect(Object.keys(config.marketplaces ?? {})).toEqual(["demo-app"]);
        expect(config.plugins?.["demo-app@demo-app"]).toEqual({ enabled: true });
        expect(json(home.read(".codex/plugins/demo-app/.agents/plugins/marketplace.json"))).toMatchObject({
          name: "demo-app",
          plugins: [{ name: "demo-app", source: { source: "local", path: "./plugins/demo-app" } }]
        });
        expect(home.read(".codex/plugins/demo-app/plugins/demo-app/hooks/hooks.json")).toContain(
          "/opt/demo/bin/demo-hook --agent codex"
        );
        const verified = yield* verify("demo-app", { bundle: demoBundle(), agents: ["codex"] });
        expect(new Set(verified.artifacts.map((artifact) => artifact.status))).toEqual(new Set(["in-sync"]));
        // An upgrade of the application changes nothing Codex reviews, so it asks for no trust again.
        const upgrade = yield* planInstall(demoBundle("2.0.0"), { agents: ["codex"] });
        expect(new Set(upgrade.steps.map((step) => step.action))).toEqual(new Set(["noop"]));
        expect(upgrade.expectedTrustPrompts).toEqual([]);

        const removed = yield* uninstall("demo-app");
        expect(removed.plan.commands.map(({ args }) => args.join(" "))).toEqual([
          "plugin remove demo-app@demo-app",
          "plugin marketplace remove demo-app"
        ]);
        const after = parseToml(home.read(".codex/config.toml") ?? "") as Record<string, unknown>;
        expect(after).toEqual(parseToml(fixture("codex-config.toml")));
        expect(home.read(".codex/plugins/demo-app/plugins/demo-app/hooks/hooks.json")).toBeUndefined();
        expect(home.read("codex-calls.log")?.trim().split("\n")).toHaveLength(4);
      }).pipe(Effect.provide(home.layer()));
    }
  );

  /** The demo bundle with other events for Codex, as an upgrade that changes its hooks. */
  const codexEvents = (events: readonly string[]) => {
    const bundle = demoBundle("2.0.0");
    return {
      ...bundle,
      artifacts: bundle.artifacts.map((artifact) =>
        artifact.type === "hooks" ? { ...artifact, events: { ...artifact.events, codex: events } } : artifact
      )
    };
  };
  const cachedHooks = (home: TestHome) => home.read(".codex/plugins/cache/demo-app/demo-app/local/hooks/hooks.json");

  it.effect("S99: adds the plugin again when its hooks change, since Codex runs the copy in its cache", () => {
    const home = testHome();
    home.command("codex", FAKE_CODEX);
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(demoBundle(), { agents: ["codex"] }));
      expect(cachedHooks(home)).not.toContain("PostToolUse");

      const changed = codexEvents(["SessionStart", "PostToolUse"]);
      const plan = yield* planInstall(changed, { agents: ["codex"] });
      expect(plan.commands.map(({ args, purpose }) => `${purpose} ${args.join(" ")}`)).toEqual([
        "unregister plugin remove demo-app@demo-app",
        "register plugin add demo-app@demo-app"
      ]);
      yield* applyInstall(plan);
      expect(JSON.parse(cachedHooks(home) ?? "{}")).toMatchObject({ hooks: { PostToolUse: [{}], SessionStart: [{}] } });
      const verified = yield* verify("demo-app", { bundle: changed, agents: ["codex"] });
      expect(new Set(verified.artifacts.map((artifact) => artifact.status))).toEqual(new Set(["in-sync"]));

      // A cache that no longer holds what was added reads as changed.
      home.write(".codex/plugins/cache/demo-app/demo-app/local/hooks/hooks.json", "{}\n");
      const stale = yield* verify("demo-app", { bundle: changed, agents: ["codex"] });
      expect(stale.artifacts.filter((artifact) => artifact.status !== "in-sync").map((a) => a.locator.pointer)).toEqual(
        ["/plugins/demo-app@demo-app"]
      );
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("S99: without codex, uninstall removes Codex's records and cache itself and still removes the rest", () => {
    const home = testHome();
    home.command("codex", FAKE_CODEX);
    home.write(".codex/config.toml", fixture("codex-config.toml"));
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(demoBundle(), { agents: ["claude-code", "codex", "grok"] }));
      expect(cachedHooks(home)).toBeDefined();
      rmSync(home.path("bin/codex"));

      const removed = yield* uninstall("demo-app");
      expect(removed.kept).toEqual([]);
      expect(parseToml(home.read(".codex/config.toml") ?? "")).toEqual(parseToml(fixture("codex-config.toml")));
      expect(cachedHooks(home)).toBeUndefined();
      expect(home.read(".claude/skills/demo-app/hooks/hooks.json")).toBeUndefined();
      expect(home.read(".grok/hooks/demo-app.json")).toBeUndefined();
      expect((yield* inventory()).entries).toEqual([]);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect(
    "S99: without codex, a new plan moves Codex's hooks from the plugin to config.toml, so each fires once",
    () => {
      const home = testHome();
      home.command("codex", FAKE_CODEX);
      return Effect.gen(function* () {
        yield* applyInstall(yield* planInstall(demoBundle(), { agents: ["codex"] }));
        rmSync(home.path("bin/codex"));
        yield* applyInstall(yield* planInstall(demoBundle(), { agents: ["codex"] }));
        const config = parseToml(home.read(".codex/config.toml") ?? "") as Record<string, Record<string, unknown[]>>;
        expect(config.plugins).toBeUndefined();
        expect(config.marketplaces).toBeUndefined();
        expect(config.hooks?.Stop).toHaveLength(1);
        expect(cachedHooks(home)).toBeUndefined();
      }).pipe(Effect.provide(home.layer()));
    }
  );
});
