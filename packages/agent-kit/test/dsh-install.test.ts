import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { HarnessLive, applyInstall, doctor, planInstall, uninstall, verify } from "../src/harness.js";
import { createNodePlatform } from "../src/node.js";
import { PlatformService } from "../src/platform/effect.js";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const skillBundle = {
  owner: "demo-app",
  version: "1.0.0",
  digest: "demo",
  artifacts: [
    {
      type: "skill" as const,
      name: "demo-skill",
      files: { "SKILL.md": "---\nname: demo-skill\ndescription: Demo\n---\nBody\n" }
    }
  ]
};

function makeLayer(home: string, cwd: string, env: Record<string, string | undefined>) {
  const base = createNodePlatform({ home, env });
  const platform = {
    ...base,
    fs: {
      ...base.fs,
      realpath: (path: string) => (path === "." ? Promise.resolve(cwd) : base.fs.realpath(path))
    }
  };
  return HarnessLive.pipe(Layer.provideMerge(Layer.succeed(PlatformService, platform)));
}

describe("DeepSeek Harness skill installation lifecycle", () => {
  it("installs, verifies, doctors, and uninstalls when DSH_AGENTS_HOME is a non-existent relative path", async () => {
    const root = createTempDir("dsh-rel-");
    const home = join(root, "home");
    const cwd = join(root, "work");
    const layer = makeLayer(home, cwd, { DSH_AGENTS_HOME: "new-relative-agents" });

    await Effect.runPromise(
      Effect.gen(function* () {
        const plan = yield* planInstall(skillBundle, { agents: ["dsh"] });
        expect(plan.status).toBe("ready");
        yield* applyInstall(plan);

        const skillFile = join(cwd, "new-relative-agents", "skills", "demo-skill", "SKILL.md");
        expect(existsSync(skillFile)).toBe(true);
        expect(readFileSync(skillFile, "utf8")).toContain("name: demo-skill");

        const verified = yield* verify("demo-app");
        expect(verified.artifacts.map((a) => a.status)).toEqual(["in-sync"]);

        const checks = yield* doctor({ agents: ["dsh"] });
        expect(checks.every((c) => c.status === "ok")).toBe(true);

        const removed = yield* uninstall("demo-app");
        expect(removed.kept).toEqual([]);
        expect(existsSync(skillFile)).toBe(false);
      }).pipe(Effect.provide(layer))
    );
  });

  it("preserves trailing spaces in non-empty DSH_AGENTS_HOME during install, verify, and uninstall", async () => {
    const root = createTempDir("dsh-space-");
    const home = join(root, "home");
    const agentsDir = `${join(root, "agents")} `;
    const layer = makeLayer(home, root, { DSH_AGENTS_HOME: agentsDir });

    await Effect.runPromise(
      Effect.gen(function* () {
        const plan = yield* planInstall(skillBundle, { agents: ["dsh"] });
        expect(plan.status).toBe("ready");
        yield* applyInstall(plan);

        const skillFile = join(agentsDir, "skills", "demo-skill", "SKILL.md");
        expect(existsSync(skillFile)).toBe(true);
        expect(existsSync(join(root, "agents", "skills", "demo-skill", "SKILL.md"))).toBe(false);

        const verified = yield* verify("demo-app");
        expect(verified.artifacts.map((a) => a.status)).toEqual(["in-sync"]);

        yield* uninstall("demo-app");
        expect(existsSync(skillFile)).toBe(false);
      }).pipe(Effect.provide(layer))
    );
  });

  it("normalizes . and .. segments through non-existent directories in absolute DSH_AGENTS_HOME", async () => {
    const root = createTempDir("dsh-norm-");
    const home = join(root, "home");

    for (const [override, expectedRoot] of [
      [`${root}/not-created/../agents`, join(root, "agents")],
      [`${root}/not-created/./agents`, join(root, "not-created", "agents")]
    ] as const) {
      const layer = makeLayer(home, root, { DSH_AGENTS_HOME: override });
      await Effect.runPromise(
        Effect.gen(function* () {
          const plan = yield* planInstall(skillBundle, { agents: ["dsh"] });
          expect(plan.status).toBe("ready");
          yield* applyInstall(plan);

          const skillFile = join(expectedRoot, "skills", "demo-skill", "SKILL.md");
          expect(existsSync(skillFile)).toBe(true);

          const verified = yield* verify("demo-app");
          expect(verified.artifacts.map((a) => a.status)).toEqual(["in-sync"]);

          yield* uninstall("demo-app");
          expect(existsSync(skillFile)).toBe(false);
        }).pipe(Effect.provide(layer))
      );
    }
  });

  it.skipIf(process.platform === "win32")(
    "preserves literal backslashes in existing POSIX DSH_AGENTS_HOME directories",
    async () => {
      const root = createTempDir("dsh-backslash-");
      const home = join(root, "home");
      const agentsDir = join(root, "agents\\archive");
      mkdirSync(agentsDir, { recursive: true });
      const layer = makeLayer(home, root, { DSH_AGENTS_HOME: agentsDir });

      await Effect.runPromise(
        Effect.gen(function* () {
          const plan = yield* planInstall(skillBundle, { agents: ["dsh"] });
          expect(plan.status).toBe("ready");
          yield* applyInstall(plan);

          const skillFile = join(agentsDir, "skills", "demo-skill", "SKILL.md");
          expect(existsSync(skillFile)).toBe(true);
          expect(existsSync(join(root, "agents", "archive", "skills", "demo-skill", "SKILL.md"))).toBe(false);

          const verified = yield* verify("demo-app");
          expect(verified.artifacts.map((a) => a.status)).toEqual(["in-sync"]);

          yield* uninstall("demo-app");
          expect(existsSync(skillFile)).toBe(false);
        }).pipe(Effect.provide(layer))
      );
    }
  );
});
