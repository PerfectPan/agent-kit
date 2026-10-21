import { afterEach, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { builtinHookDialects } from "../src/events.js";
import { applyInstall, builtinInstallAdapters, inventory, planInstall, uninstall } from "../src/public.js";
import { demoBundle } from "./support/bundles.js";
import { removeTestHomes, testHome } from "./support/home.js";
import { snapshotFiles } from "./support/snapshot.js";

const providers = { install: builtinInstallAdapters, hooks: builtinHookDialects };
afterEach(removeTestHomes);

it.effect.each(["claude", "Claude-Code"])("planInstall rejects non-exact agent id %s", (agent) => {
  const home = testHome();
  return Effect.gen(function* () {
    const result = yield* Effect.exit(planInstall(demoBundle(), { agents: [agent], providers }));
    expect(Exit.isFailure(result) && Cause.squash(result.cause)).toMatchObject({ code: "capability-unsupported" });
  }).pipe(Effect.provide(home.layer()));
});

it.effect.each(["claude", "Claude-Code"])("uninstall leaves artifacts alone for non-exact agent id %s", (agent) => {
  const home = testHome();
  return Effect.gen(function* () {
    yield* applyInstall(yield* planInstall(demoBundle(), { agents: ["claude-code"], providers }));
    const files = snapshotFiles(home.home);
    const entries = (yield* inventory()).entries;
    expect(entries.length).toBeGreaterThan(0);
    yield* uninstall("demo-app", { agents: [agent], providers });
    expect(snapshotFiles(home.home)).toEqual(files);
    expect((yield* inventory()).entries).toEqual(entries);
  }).pipe(Effect.provide(home.layer()));
});
