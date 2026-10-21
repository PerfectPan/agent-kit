import { builtinInstallAdapters as testInstall } from "../src/public.js";
import { builtinHookDialects as testHooks } from "../src/events.js";
import { builtinCodingAgents as testIdentity } from "@rivus/agent-kit-catalog";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ArtifactFiles } from "../src/application/ports.js";
import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { findLegacy } from "../src/application/use-cases/find-legacy.js";
import { inventory } from "../src/application/use-cases/inventory.js";
import { planInstall } from "../src/application/use-cases/plan-install.js";
import { uninstall } from "../src/application/use-cases/uninstall.js";
import type { ArtifactSource } from "../src/domain/bundle/index.js";
import { demoBundle } from "./support/bundles.js";
import { removeTestHomes, type TestHome, testHome } from "./support/home.js";

afterEach(removeTestHomes);

const OWNER = "demo-app";
const LEGACY = "npx --yes legacy-demo hook --event Stop";
const MARKERS = ["legacy-demo hook"];
const USER_FILE = ".grok/hooks/my-hooks.json";
const userHooks = `${JSON.stringify(
  {
    hooks: {
      Stop: [
        {
          hooks: [
            { type: "command", command: "notify-done" },
            { type: "command", command: LEGACY }
          ]
        }
      ]
    }
  },
  null,
  2
)}\r\n`;
const legacyHooks = `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: LEGACY }] }] } })}\n`;

const sources = [
  {
    agent: "grok",
    dir: ".grok/hooks",
    accepted: ["demo-app.json"],
    installed: "demo-app.json",
    action: "adopt"
  },
  {
    agent: "opencode",
    dir: ".config/opencode/plugins",
    accepted: ["legacy-demo.js", "legacy-demo.ts"],
    installed: "demo-app.js",
    action: "remove"
  },
  {
    agent: "pi",
    dir: ".pi/agent/extensions",
    accepted: ["legacy-demo.js", "legacy-demo.ts"],
    installed: "demo-app.ts",
    action: "remove"
  }
] as const;

function sourceFixture(home: TestHome, source: (typeof sources)[number]) {
  const accepted = source.accepted.map((name) => `${source.dir}/${name}`);
  const ignored = [`${source.dir}/${source.installed}.disabled`, `${source.dir}/NOTES.md`];
  const content = source.agent === "grok" ? legacyHooks : `// ${LEGACY}\n`;
  for (const path of [...accepted, ...ignored]) {
    home.write(path, content);
  }
  const reads: string[] = [];
  const platform = {
    ...home.platform,
    fs: {
      ...home.platform.fs,
      read(path, range) {
        reads.push(path);
        return home.platform.fs.read(path, range);
      }
    }
  } satisfies typeof home.platform;
  return { accepted, ignored, content, reads, platform };
}

describe("legacy source file safety", () => {
  it.effect("grok: preserves a mixed user hook file through listing, planning, apply and uninstall", () => {
    const home = testHome();
    home.write(USER_FILE, userHooks);
    return Effect.gen(function* () {
      expect(
        yield* findLegacy(OWNER, {
          agents: ["grok"],
          legacyMarkers: MARKERS,
          providers: { install: testInstall, hooks: testHooks, identity: testIdentity }
        })
      ).toEqual([]);
      const plan = yield* planInstall(demoBundle("2.0.0", { legacyMarkers: MARKERS }), {
        agents: ["grok"],
        providers: { install: testInstall, hooks: testHooks, identity: testIdentity }
      });
      expect(plan.steps.filter((step) => step.locator.path === home.path(USER_FILE))).toEqual([]);
      expect(home.read(USER_FILE)).toBe(userHooks);
      yield* applyInstall(plan);
      expect(home.read(USER_FILE)).toBe(userHooks);
      expect(home.read(".grok/hooks/demo-app.json")).toContain("demo-hook --agent grok");

      const removed = yield* uninstall(OWNER, {
        legacyMarkers: MARKERS,
        providers: { install: testInstall, hooks: testHooks, identity: testIdentity }
      });
      expect(removed.plan.steps.filter((step) => step.locator.path === home.path(USER_FILE))).toEqual([]);
      expect(removed.kept).toEqual([]);
      expect(home.read(USER_FILE)).toBe(userHooks);
      expect(home.read(".grok/hooks/demo-app.json")).toBeUndefined();
      expect((yield* inventory()).entries).toEqual([]);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("grok: marker-only uninstall preserves a mixed user hook file before any install", () => {
    const home = testHome();
    home.write(USER_FILE, userHooks);
    return Effect.gen(function* () {
      expect((yield* inventory()).entries).toEqual([]);
      const removed = yield* uninstall(OWNER, {
        legacyMarkers: MARKERS,
        providers: { install: testInstall, hooks: testHooks, identity: testIdentity }
      });
      expect(removed.plan.steps).toEqual([]);
      expect(removed.steps).toEqual([]);
      expect(removed.kept).toEqual([]);
      expect(home.read(USER_FILE)).toBe(userHooks);
      expect((yield* inventory()).entries).toEqual([]);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("grok: agent-filtered marker-only uninstall preserves a mixed user hook file before any install", () => {
    const home = testHome();
    home.write(USER_FILE, userHooks);
    return Effect.gen(function* () {
      expect((yield* inventory()).entries).toEqual([]);
      const removed = yield* uninstall(OWNER, {
        agents: ["grok"],
        legacyMarkers: MARKERS,
        providers: { install: testInstall, hooks: testHooks, identity: testIdentity }
      });
      expect(removed.plan.steps).toEqual([]);
      expect(removed.steps).toEqual([]);
      expect(removed.kept).toEqual([]);
      expect(home.read(USER_FILE)).toBe(userHooks);
      expect((yield* inventory()).entries).toEqual([]);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("custom files source without extensions reads every file", () => {
    const home = testHome();
    const paths = ["custom-hooks/legacy-demo.js", "custom-hooks/legacy-demo.custom", "custom-hooks/NOTES"];
    const content = `// ${LEGACY}\n`;
    for (const path of paths) {
      home.write(path, content);
    }
    const source: ArtifactSource = { kind: "files", dir: home.path("custom-hooks") };
    const reads: string[] = [];
    const platform = {
      ...home.platform,
      fs: {
        ...home.platform.fs,
        read(path, range) {
          reads.push(path);
          return home.platform.fs.read(path, range);
        }
      }
    } satisfies typeof home.platform;
    return Effect.gen(function* () {
      const files = yield* ArtifactFiles;
      expect(
        (yield* files.scan(source))
          .map(({ locator, read }) => ({ path: locator.path, kind: read.kind, content: read.content }))
          .toSorted((a, b) => a.path.localeCompare(b.path))
      ).toEqual(
        paths
          .map((path) => ({ path: home.path(path), kind: "file", content }))
          .toSorted((a, b) => a.path.localeCompare(b.path))
      );
      for (const path of paths) {
        expect(reads).toContain(home.path(path));
      }
    }).pipe(Effect.provide(home.layer(platform)));
  });

  for (const source of sources) {
    it.effect(`${source.agent}: replaces loaded legacy files and preserves disabled files and notes`, () => {
      const home = testHome();
      const { accepted, ignored, content, reads, platform } = sourceFixture(home, source);
      const installed = `${source.dir}/${source.installed}`;
      return Effect.gen(function* () {
        const listed = yield* findLegacy(OWNER, {
          agents: [source.agent],
          legacyMarkers: MARKERS,
          providers: { install: testInstall, hooks: testHooks, identity: testIdentity }
        });
        expect(
          listed
            .map(({ agent, locator, kind, treatment }) => ({ agent, path: locator.path, kind, treatment }))
            .toSorted((a, b) => a.path.localeCompare(b.path))
        ).toEqual(
          accepted.map((path) => ({ agent: source.agent, path: home.path(path), kind: "file", treatment: "replace" }))
        );
        for (const path of accepted) {
          expect(reads).toContain(home.path(path));
        }
        const plan = yield* planInstall(demoBundle("2.0.0", { legacyMarkers: MARKERS }), {
          agents: [source.agent],
          providers: { install: testInstall, hooks: testHooks, identity: testIdentity }
        });
        expect(
          plan.steps
            .filter((step) => step.legacy === true)
            .map((step) => `${step.action}:${step.locator.path}`)
            .toSorted()
        ).toEqual(accepted.map((path) => `${source.action}:${home.path(path)}`).toSorted());
        expect(plan.steps.filter((step) => ignored.some((path) => step.locator.path === home.path(path)))).toEqual([]);
        for (const path of [...accepted, ...ignored]) {
          expect(home.read(path)).toBe(content);
        }

        yield* applyInstall(plan);
        for (const path of accepted.filter((path) => path !== installed)) {
          expect(home.read(path)).toBeUndefined();
        }
        expect(home.read(installed)).toContain(`demo-hook --agent ${source.agent}`);
        expect(home.read(installed)).not.toContain(LEGACY);
        for (const path of ignored) {
          expect(home.read(path)).toBe(content);
          expect(reads).not.toContain(home.path(path));
        }
        expect(
          yield* findLegacy(OWNER, {
            agents: [source.agent],
            legacyMarkers: MARKERS,
            providers: { install: testInstall, hooks: testHooks, identity: testIdentity }
          })
        ).toEqual([]);

        const removed = yield* uninstall(OWNER, {
          legacyMarkers: MARKERS,
          providers: { install: testInstall, hooks: testHooks, identity: testIdentity }
        });
        expect(
          removed.plan.steps.filter((step) => ignored.some((path) => step.locator.path === home.path(path)))
        ).toEqual([]);
        expect(removed.kept).toEqual([]);
        expect(home.read(installed)).toBeUndefined();
        for (const path of ignored) {
          expect(home.read(path)).toBe(content);
          expect(reads).not.toContain(home.path(path));
        }
        expect((yield* inventory()).entries).toEqual([]);
      }).pipe(Effect.provide(home.layer(platform)));
    });

    it.effect(
      `${source.agent}: marker-only uninstall removes loaded files and preserves disabled files and notes`,
      () => {
        const home = testHome();
        const { accepted, ignored, content, reads, platform } = sourceFixture(home, source);
        return Effect.gen(function* () {
          expect((yield* inventory()).entries).toEqual([]);
          const removed = yield* uninstall(OWNER, {
            legacyMarkers: MARKERS,
            providers: { install: testInstall, hooks: testHooks, identity: testIdentity }
          });
          expect(
            removed.plan.steps
              .filter((step) => step.legacy === true)
              .map((step) => `${step.action}:${step.locator.path}`)
              .toSorted()
          ).toEqual(accepted.map((path) => `remove:${home.path(path)}`).toSorted());
          expect(
            removed.plan.steps.filter((step) => ignored.some((path) => step.locator.path === home.path(path)))
          ).toEqual([]);
          expect(removed.kept).toEqual([]);
          for (const path of accepted) {
            expect(home.read(path)).toBeUndefined();
            expect(reads).toContain(home.path(path));
          }
          for (const path of ignored) {
            expect(home.read(path)).toBe(content);
            expect(reads).not.toContain(home.path(path));
          }
          expect((yield* inventory()).entries).toEqual([]);
        }).pipe(Effect.provide(home.layer(platform)));
      }
    );
  }
});
