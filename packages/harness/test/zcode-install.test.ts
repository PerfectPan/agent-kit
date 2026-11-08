import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as z from "zod/mini";
import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { planInstall } from "../src/application/use-cases/plan-install.js";
import { uninstall } from "../src/application/use-cases/uninstall.js";
import { verify } from "../src/application/use-cases/verify.js";
import { doctor } from "../src/application/use-cases/doctor.js";
import { demoBundle } from "./support/bundles.js";
import { removeTestHomes, testHome, type TestHome } from "./support/home.js";
import { snapshotFiles } from "./support/snapshot.js";
import { builtinInstallAdapters as install, builtinHookDialects as hooks } from "./support/providers.js";

afterEach(removeTestHomes);
const providers = { install, hooks };
const CONFIG = ".zcode/cli/config.json";
const configSchema = z.looseObject({ plugins: z.looseObject({ dirs: z.array(z.string()) }) });
const manifestSchema = z.object({ name: z.string(), version: z.string() });
const config = (home: TestHome) => configSchema.parse(JSON.parse(home.read(CONFIG) ?? "null"));
const relative = (home: TestHome, path: string) => path.slice(home.home.length + 1);

function bundle(owner = "demo-app") {
  return demoBundle("1.2.3", {
    owner,
    artifacts: [
      {
        type: "hooks",
        command: "demo-hook --agent {agent}",
        timeoutSeconds: 1.5,
        events: { zcode: ["SessionStart", "Stop"] }
      }
    ]
  });
}

describe("ZCode plugin installation", () => {
  it.effect(
    "registers an absolute path and removes only its own entry, preserving user edits and other directories",
    () => {
      const home = testHome();
      const user = { plugins: { dirs: ["/opt/user-plugin"] }, hooks: { events: { Stop: [] } }, theme: "dark" };
      home.write(CONFIG, `${JSON.stringify(user, null, 2)}\n`);
      return Effect.gen(function* () {
        const plan = yield* planInstall(bundle(), { agents: ["zcode"], providers });
        expect(plan.status).toBe("ready");
        expect(plan.expectedTrustPrompts).toEqual([]);
        yield* applyInstall(plan);
        const installed = config(home);
        expect(installed.plugins.dirs).toHaveLength(2);
        const dir = installed.plugins.dirs[1]!;
        expect(dir).toMatch(new RegExp(`^${home.home}/\\.agents/agent-kit/zcode/`));
        expect(installed).toEqual({ ...user, plugins: { dirs: ["/opt/user-plugin", dir] } });
        const manifest = manifestSchema.parse(
          JSON.parse(home.read(`${relative(home, dir)}/.zcode-plugin/plugin.json`)!)
        );
        expect(manifest).toEqual({ name: dir.split("/").at(-1), version: "1.2.3" });
        expect(JSON.parse(home.read(`${relative(home, dir)}/hooks/hooks.json`)!)).toEqual({
          hooks: Object.fromEntries(
            ["SessionStart", "Stop"].map((event) => [
              event,
              [{ hooks: [{ type: "command", command: "demo-hook --agent zcode", timeoutMs: 1500 }] }]
            ])
          )
        });
        const again = yield* planInstall(bundle(), { agents: ["zcode"], providers });
        expect(again.changes).toEqual([]);
        expect((yield* verify("demo-app", { providers })).artifacts.every((a) => a.status === "in-sync")).toBe(true);
        home.write(
          CONFIG,
          `${JSON.stringify({ ...installed, theme: "light", plugins: { dirs: [...installed.plugins.dirs, "/opt/later-plugin"] } })}\n`
        );
        const removed = yield* uninstall("demo-app", { providers });
        expect(removed.kept).toEqual([]);
        expect(config(home)).toEqual({
          ...user,
          theme: "light",
          plugins: { dirs: ["/opt/user-plugin", "/opt/later-plugin"] }
        });
        expect(home.read(`${relative(home, dir)}/.zcode-plugin/plugin.json`)).toBeUndefined();
        expect(home.read(`${relative(home, dir)}/hooks/hooks.json`)).toBeUndefined();
      }).pipe(Effect.provide(home.layer()));
    }
  );

  it.effect.each(["global", "per-plugin", "both"] as const)(
    "preserves %s disabled state during install and uninstall",
    (disabled) => {
      const home = testHome();
      const preview = install.zcode.renderHooks(
        "native-plugin",
        [{ event: "Stop", command: "demo-hook", agents: ["zcode"] }],
        bundle(),
        { home: home.home, env: home.env }
      );
      const dir = preview.find((artifact) => artifact.locator.kind === "dir")!.locator.path;
      const name = dir.split("/").at(-1)!;
      const user = {
        plugins: {
          dirs: ["/opt/user-plugin"],
          enabled: disabled === "per-plugin",
          enabledPlugins: { [`${name}@inline`]: disabled === "global", "user@inline": false }
        },
        hooks: { enabled: false, events: { Stop: [{ hooks: [{ type: "command", command: "user-hook" }] }] } }
      };
      home.write(CONFIG, `${JSON.stringify(user)}\n`);
      return Effect.gen(function* () {
        yield* applyInstall(yield* planInstall(bundle(), { agents: ["zcode"], providers }));
        expect(config(home)).toEqual({ ...user, plugins: { ...user.plugins, dirs: ["/opt/user-plugin", dir] } });
        // Artifact sync is deliberately not a claim that ZCode enabled this plugin.
        expect((yield* verify("demo-app", { providers })).artifacts.map((a) => a.status)).toEqual([
          "in-sync",
          "in-sync"
        ]);
        yield* uninstall("demo-app", { providers });
        expect(config(home)).toEqual(user);
      }).pipe(Effect.provide(home.layer()));
    }
  );

  it.effect("keeps two owners independent when one is uninstalled, including colliding ownerSlugs", () => {
    const home = testHome();
    home.write(CONFIG, '{"plugins":{"dirs":["/opt/user-plugin"]}}\n');
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(bundle("demo-app"), { agents: ["zcode"], providers }));
      const first = config(home).plugins.dirs[1]!;
      yield* applyInstall(yield* planInstall(bundle("@demo/app"), { agents: ["zcode"], providers }));
      const second = config(home).plugins.dirs[2]!;
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
      const files = snapshotFiles(home.home);
      yield* uninstall("demo-app", { providers });
      expect(config(home).plugins.dirs).toEqual(["/opt/user-plugin", second]);
      expect(home.read(`${relative(home, first)}/hooks/hooks.json`)).toBeUndefined();
      for (const [path, content] of Object.entries(files).filter(([path]) =>
        path.startsWith(`${relative(home, second)}/`)
      )) {
        expect(home.read(path)).toBe(content);
      }
      expect((yield* verify("@demo/app", { providers })).artifacts.every((a) => a.status === "in-sync")).toBe(true);
      yield* uninstall("@demo/app", { providers });
      expect(config(home).plugins.dirs).toEqual(["/opt/user-plugin"]);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("keeps config, plugin and skills paths fixed when ZCODE_STORAGE_DIR is set", () => {
    const home = testHome({ ZCODE_STORAGE_DIR: "/outside/zcode-storage" });
    return Effect.gen(function* () {
      const withSkill = {
        ...bundle(),
        artifacts: [
          ...bundle().artifacts,
          {
            type: "skill" as const,
            name: "demo",
            files: { "SKILL.md": "---\nname: demo\ndescription: Demo\n---\nDemo\n" }
          }
        ]
      };
      yield* applyInstall(yield* planInstall(withSkill, { agents: ["zcode"], providers }));
      expect(config(home).plugins.dirs).toHaveLength(1);
      expect(config(home).plugins.dirs[0]).toContain(`${home.home}/.agents/agent-kit/zcode/`);
      expect(home.read(".agents/skills/demo/SKILL.md")).toContain("name: demo");
      expect(Object.keys(snapshotFiles(home.home)).some((path) => path.includes("zcode-storage"))).toBe(false);
      yield* uninstall("demo-app", { providers });
      expect(snapshotFiles(home.home)).toEqual({});
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("lets doctor scan kit plugin hook files without treating nested user events as plugin events", () => {
    const home = testHome();
    home.write(CONFIG, '{"hooks":{"events":{"UnknownUserEvent":[{"hooks":[{"command":"/missing/user"}]}]}}}\n');
    return Effect.gen(function* () {
      yield* applyInstall(yield* planInstall(bundle(), { agents: ["zcode"], providers }));
      const dir = config(home).plugins.dirs[0]!;
      const path = `${relative(home, dir)}/hooks/hooks.json`;
      home.write(
        path,
        JSON.stringify({
          hooks: {
            UnknownPluginEvent: [{ hooks: [{ type: "command", command: "/missing/kit-hook", timeoutMs: 1500 }] }]
          }
        })
      );
      const checks = yield* doctor({ agents: ["zcode"], providers });
      expect(checks.filter((check) => check.name === "unknown-event").map((check) => check.locator?.pointer)).toEqual([
        "/hooks/UnknownPluginEvent"
      ]);
      expect(checks.filter((check) => check.name === "stale-path").map((check) => check.message)).toEqual([
        "/missing/kit-hook does not exist"
      ]);
      expect(checks.filter((check) => check.name === "timeout-unit")).toEqual([]);
    }).pipe(Effect.provide(home.layer()));
  });
});
