import { builtinInstallAdapters as testInstall, builtinHookDialects as testHooks } from "./support/providers.js";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { LedgerRepository } from "../src/application/ports.js";
import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { findLegacy } from "../src/application/use-cases/find-legacy.js";
import { planInstall } from "../src/application/use-cases/plan-install.js";
import type { InstallAdapters } from "../src/domain/bundle/spi/install-adapter.js";
import { ledgerScope } from "../src/application/services/ledger-scope.js";
import { demoBundle } from "./support/bundles.js";
import { removeTestHomes, testHome } from "./support/home.js";

afterEach(removeTestHomes);

const OWNER = "demo-app";
const LEGACY = "npx --yes legacy-demo hook --event Stop";
// A marker that recognizes an old configuration reference to the owner's file, which a scanned directory's own
// files may legitimately mention.
const CONFIG_MARKER = "legacy-demo.json";

/**
 * The demo owner's grok adapter with per-source markers: the old hook file is judged by the legacy command marker,
 * the scanned extension directory by a list without the configuration marker, so a user file that only mentions the
 * configuration file's name stays theirs.
 */
const scoped: InstallAdapters = {
  ...testInstall,
  grok: {
    ...testInstall.grok,
    legacySources: (context) => [
      {
        kind: "entries",
        format: "json",
        path: `${context.home}/.grok/hooks/demo-old.json`,
        pointer: "/hooks",
        memberIn: "hook-group",
        markers: [CONFIG_MARKER]
      },
      { kind: "files", dir: `${context.home}/.grok/legacy-ext`, markers: [LEGACY] }
    ]
  }
};

describe("legacy markers scoped to their source", () => {
  it.effect("a configuration marker matches its entry source but not a file of a scanned directory", () => {
    const home = testHome();
    home.write(
      ".grok/hooks/demo-old.json",
      `${JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: `node /old/home/${CONFIG_MARKER} serve` }] }] }
      })}\n`
    );
    home.write(".grok/legacy-ext/user-ext.js", `// mentions ${CONFIG_MARKER} in a comment\n`);
    home.write(".grok/legacy-ext/old-ext.js", `// ${LEGACY}\n`);
    return Effect.gen(function* () {
      const finds = yield* findLegacy(OWNER, {
        agents: ["grok"],
        legacyMarkers: [CONFIG_MARKER, LEGACY],
        providers: { install: scoped, hooks: testHooks }
      });
      const paths = finds.map((find) => find.locator.path);
      expect(paths).toContain(home.path(".grok/hooks/demo-old.json"));
      expect(paths).toContain(home.path(".grok/legacy-ext/old-ext.js"));
      expect(paths).not.toContain(home.path(".grok/legacy-ext/user-ext.js"));

      const plan = yield* planInstall(demoBundle("2.0.0", { legacyMarkers: [CONFIG_MARKER, LEGACY] }), {
        agents: ["grok"],
        providers: { install: scoped, hooks: testHooks }
      });
      const forUser = plan.steps.filter((step) => step.locator.path === home.path(".grok/legacy-ext/user-ext.js"));
      expect(forUser).toEqual([]);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect(
    "a foreign file that mentions a marker string is not planned, and a real legacy file keeps its pre-image",
    () => {
      const home = testHome();
      home.write(".grok/legacy-ext/user-ext.js", `// existsSync(${JSON.stringify(CONFIG_MARKER)})\n`);
      const old = `// ${LEGACY}\n`;
      home.write(".grok/legacy-ext/old-ext.js", old);
      return Effect.gen(function* () {
        const plan = yield* planInstall(demoBundle("2.0.0", { legacyMarkers: [CONFIG_MARKER, LEGACY] }), {
          agents: ["grok"],
          providers: { install: scoped, hooks: testHooks }
        });
        expect(home.read(".grok/legacy-ext/user-ext.js")).not.toBeUndefined();
        const removal = plan.steps.find((step) => step.locator.path === home.path(".grok/legacy-ext/old-ext.js"));
        // The pre-image records what the match deleted, so a wrong match can be put back from the ledger.
        expect(removal).toMatchObject({ action: "remove", removal: "delete", capturePreImage: true, legacy: true });

        const applied = yield* applyInstall(plan);
        expect(home.read(".grok/legacy-ext/old-ext.js")).toBeUndefined();
        if (removal === undefined) {
          throw new Error("no plan removal");
        }
        const record = applied.steps.find((step) => step.locator.path === removal.locator.path);
        if (record?.preImage?.existed !== true) {
          throw new Error("the removal recorded no pre-image");
        }
        const repository = yield* LedgerRepository;
        expect(yield* repository.getPreImage(yield* ledgerScope({ scope: "user" }), record.preImage.blobRef)).toBe(old);
      }).pipe(Effect.provide(home.layer()));
    }
  );

  it.effect("a desired locator a scoped source found is judged by that source's markers, not the bundle's", () => {
    const home = testHome();
    // The bundle installs the grok hooks file; the file there matches the bundle's broad marker but not the
    // scoped source's exact command marker, so it is not the owner's legacy install.
    home.write(".grok/hooks/demo-app.json", "// mentions legacy-demo hook in a comment\n");
    const desired: InstallAdapters = {
      ...testInstall,
      grok: {
        ...testInstall.grok,
        legacySources: (context) => [{ kind: "files", dir: `${context.home}/.grok/hooks`, markers: [LEGACY] }]
      }
    };
    return Effect.gen(function* () {
      // Not legacy: the plan does not adopt over it as the owner's older install — it conflicts instead, and a
      // chosen backup captures a pre-image.
      const conflicted = yield* Effect.flip(
        planInstall(demoBundle("2.0.0", { legacyMarkers: ["legacy-demo hook"] }), {
          agents: ["grok"],
          providers: { install: desired, hooks: testHooks }
        })
      );
      expect(conflicted).toMatchObject({
        _tag: "PlanConflict",
        conflicts: [
          {
            step: { locator: { path: home.path(".grok/hooks/demo-app.json") }, conflict: "unmanaged-exists" },
            choices: ["adopt", "backup"]
          }
        ]
      });
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("the first source that reaches a locator claims it, against a later scoped one", () => {
    const home = testHome();
    // A file that matches the bundle's broad marker and the scoped source's exact command marker alike: which list
    // judges it decides whether the uninstall deletes it.
    home.write(".grok/hooks/mixed.json", `// ${LEGACY}\n`);
    const overlapping: InstallAdapters = {
      ...testInstall,
      grok: {
        ...testInstall.grok,
        legacySources: (context) => [
          { kind: "files", dir: `${context.home}/.grok/hooks` },
          { kind: "files", dir: `${context.home}/.grok/hooks`, markers: [LEGACY] }
        ]
      }
    };
    return Effect.gen(function* () {
      const finds = yield* findLegacy(OWNER, {
        agents: ["grok"],
        legacyMarkers: ["legacy-demo hook"],
        providers: { install: overlapping, hooks: testHooks }
      });
      // The unscoped source claimed the file first, so the broad bundle marker judges it — the same answer the
      // listing gives when the scoped source's own markers are absent.
      expect(finds.map((find) => find.locator.path)).toEqual([home.path(".grok/hooks/mixed.json")]);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("a source without its own markers is still judged by the bundle's markers", () => {
    const home = testHome();
    home.write(".grok/legacy-default/old.js", `// ${LEGACY}\n`);
    const unscoped: InstallAdapters = {
      ...testInstall,
      grok: {
        ...testInstall.grok,
        legacySources: (context) => [{ kind: "files", dir: `${context.home}/.grok/legacy-default` }]
      }
    };
    return Effect.gen(function* () {
      const finds = yield* findLegacy(OWNER, {
        agents: ["grok"],
        legacyMarkers: [LEGACY],
        providers: { install: unscoped, hooks: testHooks }
      });
      expect(finds.map((find) => find.locator.path)).toEqual([home.path(".grok/legacy-default/old.js")]);
    }).pipe(Effect.provide(home.layer()));
  });
});
