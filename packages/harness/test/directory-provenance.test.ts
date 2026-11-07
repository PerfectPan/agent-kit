import { builtinInstallAdapters as testInstall, builtinHookDialects as testHooks } from "./support/providers.js";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { loadLedger } from "../src/application/services/ledger-session.js";
import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { planInstall } from "../src/application/use-cases/plan-install.js";
import { uninstall } from "../src/application/use-cases/uninstall.js";
import { demoBundle } from "./support/bundles.js";
import { removeTestHomes, testHome } from "./support/home.js";

afterEach(removeTestHomes);

const OWNER = "demo-app";
const HOOK = ".grok/hooks/demo-app.json";

const install = (home: ReturnType<typeof testHome>, owner = OWNER) =>
  Effect.gen(function* () {
    const plan = yield* planInstall(demoBundle("1.0.0", owner === OWNER ? {} : { owner, digest: `digest-${owner}` }), {
      agents: ["grok"],
      providers: { install: testInstall, hooks: testHooks }
    });
    yield* applyInstall(plan);
    expect(home.read(HOOK)).not.toBeUndefined();
  }).pipe(Effect.provide(home.layer()));

describe("ledger directory provenance", () => {
  it.effect("an install-created directory disappears when empty, including its recorded ancestors", () => {
    const home = testHome();
    const stat = (relative: string) => Effect.promise(() => home.platform.fs.stat(home.path(relative)));
    return Effect.gen(function* () {
      expect(yield* stat(".grok")).toBeUndefined();
      yield* install(home);
      // The install positively recorded the ancestors it created within the roots.
      const { ledger } = yield* loadLedger({ key: "user", scope: "user" });
      expect(Object.keys(ledger.toSnapshot().directories ?? {})).toContain(home.path(".grok/hooks"));
      yield* uninstall(OWNER, { providers: { install: testInstall, hooks: testHooks } });
      expect(home.read(HOOK)).toBeUndefined();
      expect(yield* stat(".grok/hooks")).toBeUndefined();
      expect(yield* stat(".grok")).toBeUndefined();
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("a pre-existing directory survives, and nothing above it is claimed or removed", () => {
    const home = testHome();
    const stat = (relative: string) => Effect.promise(() => home.platform.fs.stat(home.path(relative)));
    return Effect.gen(function* () {
      yield* Effect.promise(() => home.platform.fs.mkdir(home.path(".grok/hooks")));
      yield* install(home);
      yield* uninstall(OWNER, { providers: { install: testInstall, hooks: testHooks } });
      expect(home.read(HOOK)).toBeUndefined();
      // The walk stopped at the pre-existing directory and inferred nothing about the missing one above it: both
      // stay, however empty the one above is.
      expect(yield* stat(".grok/hooks")).toBeDefined();
      expect(yield* stat(".grok")).toBeDefined();
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("a claimed directory that holds a user's file stays, with its claim", () => {
    const home = testHome();
    const stat = (relative: string) => Effect.promise(() => home.platform.fs.stat(home.path(relative)));
    return Effect.gen(function* () {
      yield* install(home);
      home.write(".grok/hooks/user-hooks.json", "// the user's own\n");
      yield* uninstall(OWNER, { providers: { install: testInstall, hooks: testHooks } });
      expect(home.read(".grok/hooks/user-hooks.json")).toBe("// the user's own\n");
      expect(yield* stat(".grok/hooks")).toBeDefined();
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect("a directory two owners' installs share leaves with the last removal", () => {
    const home = testHome();
    const stat = (relative: string) => Effect.promise(() => home.platform.fs.stat(home.path(relative)));
    return Effect.gen(function* () {
      yield* install(home, OWNER);
      yield* install(home, "other-app");
      yield* uninstall(OWNER, { providers: { install: testInstall, hooks: testHooks } });
      // The first owner's artifacts went; the second owner still uses the directory.
      expect(home.read(HOOK)).toBeUndefined();
      expect(home.read(".grok/hooks/other-app.json")).not.toBeUndefined();
      expect(yield* stat(".grok/hooks")).toBeDefined();
      yield* uninstall("other-app", { providers: { install: testInstall, hooks: testHooks } });
      expect(home.read(".grok/hooks/other-app.json")).toBeUndefined();
      expect(yield* stat(".grok/hooks")).toBeUndefined();
    }).pipe(Effect.provide(home.layer()));
  });
});
