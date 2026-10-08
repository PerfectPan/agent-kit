import { PlatformService } from "@rivus/agent-kit-platform/effect";
import { createNodePlatform } from "@rivus/agent-kit-platform-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { HarnessLive } from "../../src/adapters/harness-live.js";
import { applyInstall } from "../../src/application/apply-install.js";
import { planInstall } from "../../src/application/plan-install.js";
import { ArtifactFiles, LedgerLock } from "../../src/application/ports.js";
import { demoBundle } from "../support/bundles.js";
import { print, stdinLine } from "../support/workers.js";

// Usage: ledger-worker <hold|contend|try|apply|stuck-apply> [holdMs]. The home comes from HOME in the environment the test
// gives, which is all the environment there is.
const [mode, holdMs = "0"] = process.argv.slice(2);
const home = process.env.HOME ?? "";
const platform = createNodePlatform({ env: { ...process.env }, home });
const now = () => performance.timeOrigin + performance.now();
const scope = { key: "user", scope: "user" } as const;
// `Effect.never` alone does not keep Node's event loop alive; a holder must stay until it is killed.
setInterval(() => undefined, 60_000);

const base = HarnessLive.pipe(Layer.provideMerge(Layer.succeed(PlatformService, platform)));

/** The real files, except that the second write never finishes: the process is stuck inside its critical section. */
const stuckFiles = Layer.effect(
  ArtifactFiles,
  Effect.gen(function* () {
    const files = yield* ArtifactFiles;
    let writes = 0;
    return {
      ...files,
      write: (locator, content) =>
        Effect.gen(function* () {
          writes += 1;
          if (writes === 2) {
            print("stuck");
            return yield* Effect.never;
          }
          return yield* files.write(locator, content);
        })
    };
  })
).pipe(Layer.provide(base));

const program = Effect.gen(function* () {
  if (mode === "stuck-apply") {
    const plan = yield* planInstall(demoBundle(), { agents: ["claude-code", "grok"] });
    print("planned", { steps: plan.steps.length });
    yield* applyInstall(plan);
    return;
  }
  if (mode === "apply") {
    // Plans first, then applies on "go", so that several workers apply plans built on the same ledger at once.
    const plan = yield* planInstall(demoBundle(), { agents: ["claude-code", "grok"] });
    print("ready");
    yield* Effect.promise(() => stdinLine("go"));
    const outcome = yield* applyInstall(plan, { lockWaitMs: 20_000 }).pipe(
      Effect.map((report) => ({ event: "applied", steps: report.steps.length })),
      Effect.catchTag("PlanStale", (stale) => Effect.succeed({ event: "stale", reason: stale.reason }))
    );
    print(outcome.event, outcome);
    return;
  }
  if (mode === "contend" || mode === "try") {
    print("ready");
    yield* Effect.promise(() => stdinLine("go"));
  }
  if (mode === "try") {
    // One attempt without waiting for a holder: acquired and held until killed, or busy.
    const taken = yield* Effect.scoped(
      Effect.gen(function* () {
        yield* (yield* LedgerLock).acquire(scope, { waitMs: 0 });
        print("acquired");
        return yield* Effect.never;
      })
    ).pipe(Effect.catchTag("LedgerBusy", () => Effect.succeed("busy")));
    print(taken);
    return;
  }
  yield* Effect.scoped(
    Effect.gen(function* () {
      yield* (yield* LedgerLock).acquire(scope, { waitMs: 60_000 });
      print("entered", { time: now() });
      if (mode === "hold") {
        return yield* Effect.never;
      }
      yield* Effect.sleep(Number(holdMs));
      print("left", { time: now() });
    })
  );
});

await Effect.runPromise(program.pipe(Effect.provide(mode === "stuck-apply" ? Layer.merge(base, stuckFiles) : base)));
process.exit(0);
