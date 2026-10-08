import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import { applyInstall } from "../src/application/apply-install.js";
import { inventory } from "../src/application/inventory.js";
import { planInstall } from "../src/application/plan-install.js";
import { ArtifactFiles, type ArtifactFilesShape, LedgerLock, LedgerStore } from "../src/application/ports.js";
import { locatorKey } from "../src/domain/install-plan/index.js";
import { demoBundle } from "./support/bundles.js";
import { removeTestHomes, type TestHome, testHome } from "./support/home.js";

afterEach(removeTestHomes);

const agents = ["claude-code", "grok", "opencode"] as const;
const scope = { key: "user", scope: "user" } as const;

/** The home's ports with ArtifactFiles wrapped by `wrap`. */
function wrapped(home: TestHome, wrap: (files: ArtifactFilesShape) => ArtifactFilesShape) {
  const base = home.layer();
  const files = Layer.effect(
    ArtifactFiles,
    Effect.gen(function* () {
      return wrap(yield* ArtifactFiles);
    })
  ).pipe(Layer.provide(base));
  return Layer.merge(base, files);
}

describe("apply execution rules (plan 3.9)", () => {
  it.live(
    "S96: cancellation lands between steps: the step in flight finishes and is recorded, the rest stay pending",
    () => {
      const home = testHome();
      return Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let writes = 0;
        const layer = wrapped(home, (files) => ({
          ...files,
          write: (locator, content) =>
            Effect.gen(function* () {
              writes += 1;
              if (writes === 2) {
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(release);
              }
              return yield* files.write(locator, content);
            })
        }));
        yield* Effect.gen(function* () {
          const plan = yield* planInstall(demoBundle(), { agents: [...agents] });
          expect(plan.steps.length).toBeGreaterThan(2);
          const fiber = yield* Effect.forkChild(applyInstall(plan));
          yield* Deferred.await(entered);
          const interrupting = yield* Effect.forkChild(Fiber.interrupt(fiber));
          yield* Effect.sleep(50);
          // The write in flight is uninterruptible: the interruption waits for it.
          expect(interrupting.pollUnsafe()).toBeUndefined();
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(interrupting);

          const after = yield* inventory();
          const [first, second, ...rest] = plan.steps;
          expect(after.entries.map((entry) => locatorKey(entry.locator)).toSorted()).toEqual(
            [first, second].map((step) => locatorKey(step!.locator)).toSorted()
          );
          expect(after.pending.map((op) => locatorKey(op.locator))).toEqual(
            rest.map((step) => locatorKey(step.locator))
          );
          expect(writes).toBe(2);
          // The lock was released after the step in flight, when the apply's Scope closed.
          yield* Effect.scoped(
            Effect.gen(function* () {
              yield* (yield* LedgerLock).acquire(scope, { waitMs: 0 });
            })
          );
        }).pipe(Effect.provide(layer));

        // The next change probes the pending steps (none started) and starts over from the recorded state.
        yield* Effect.gen(function* () {
          const again = yield* planInstall(demoBundle(), { agents: [...agents] });
          expect((yield* inventory()).pending).toEqual([]);
          yield* applyInstall(again);
          expect((yield* inventory()).entries).toHaveLength(again.steps.length);
        }).pipe(Effect.provide(home.layer()));
      });
    }
  );

  it.effect("S97: a step that fails stops the apply, stays pending for the next probe and is never retried", () => {
    const home = testHome();
    return Effect.gen(function* () {
      let attempts = 0;
      const layer = wrapped(home, (files) => ({
        ...files,
        write: (locator, content) =>
          Effect.gen(function* () {
            attempts += 1;
            if (attempts === 2) {
              return yield* Effect.fail({
                _tag: "ArtifactIoFailure" as const,
                path: locator.path,
                operation: "write" as const,
                message: "disk full"
              });
            }
            return yield* files.write(locator, content);
          })
      }));
      yield* Effect.gen(function* () {
        const plan = yield* planInstall(demoBundle(), { agents: [...agents] });
        const failure = yield* Effect.flip(applyInstall(plan));
        expect(failure).toMatchObject({ _tag: "ApplyFailed", completed: 1, cause: { message: "disk full" } });
        expect(attempts).toBe(2);
        const after = yield* inventory();
        expect(after.entries).toHaveLength(1);
        // Only the failed step is still pending; the later ones were recorded as not started.
        expect(after.pending.map((op) => locatorKey(op.locator))).toEqual([locatorKey(plan.steps[1]!.locator)]);
        // The plan is used up: applying it again is refused instead of retried.
        expect(yield* Effect.flip(applyInstall(plan))).toMatchObject({ _tag: "PlanStale", reason: "applied" });
        expect(attempts).toBe(2);
      }).pipe(Effect.provide(layer));
    });
  });

  it.live("S96: an interrupted recovery finishes its ledger write before the lock is released", () => {
    const home = testHome();
    return Effect.gen(function* () {
      // A failed apply leaves one operation pending for the next holder to probe.
      let writes = 0;
      const failing = wrapped(home, (files) => ({
        ...files,
        write: (locator, content) => {
          writes += 1;
          return writes === 2
            ? Effect.fail({
                _tag: "ArtifactIoFailure" as const,
                path: locator.path,
                operation: "write" as const,
                message: "x"
              })
            : files.write(locator, content);
        }
      }));
      yield* Effect.flip(
        Effect.flatMap(planInstall(demoBundle(), { agents: [...agents] }), applyInstall).pipe(Effect.provide(failing))
      );

      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const base = home.layer();
      const slowStore = Layer.effect(
        LedgerStore,
        Effect.gen(function* () {
          const store = yield* LedgerStore;
          return {
            ...store,
            save: (scope, snapshot, expected) =>
              Effect.gen(function* () {
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(release);
                return yield* store.save(scope, snapshot, expected);
              })
          };
        })
      ).pipe(Layer.provide(base));
      yield* Effect.gen(function* () {
        expect((yield* inventory()).pending).toHaveLength(1);
        const fiber = yield* Effect.forkChild(planInstall(demoBundle(), { agents: [...agents] }));
        yield* Deferred.await(entered);
        const interrupting = yield* Effect.forkChild(Fiber.interrupt(fiber));
        yield* Effect.sleep(50);
        // The ledger write in flight is uninterruptible, so the lock is still held until it lands.
        expect(interrupting.pollUnsafe()).toBeUndefined();
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(interrupting);
        expect((yield* inventory()).pending).toEqual([]);
      }).pipe(Effect.provide(Layer.merge(base, slowStore)));
    });
  });

  it.effect("S32: a plan built before the ledger moved is refused and writes nothing", () => {
    const home = testHome();
    return Effect.gen(function* () {
      const stale = yield* planInstall(demoBundle(), { agents: ["grok"] });
      const fresh = yield* planInstall(demoBundle(), { agents: ["grok"] });
      yield* applyInstall(fresh);
      const before = home.read(".grok/hooks/demo-app.json");
      const failure = yield* Effect.flip(applyInstall(stale));
      expect(failure).toMatchObject({ _tag: "PlanStale", reason: "ledger-moved" });
      expect(home.read(".grok/hooks/demo-app.json")).toBe(before);
    }).pipe(Effect.provide(home.layer()));
  });

  it.effect(
    "S32: re-checks every target before writing: a target changed after planning refuses the plan whole",
    () => {
      const home = testHome();
      return Effect.gen(function* () {
        const plan = yield* planInstall(demoBundle(), { agents: ["claude-code", "grok"] });
        home.write(".grok/hooks/demo-app.json", "{}\n");
        const failure = yield* Effect.flip(applyInstall(plan));
        expect(failure).toMatchObject({ _tag: "TargetChanged", completed: 0, expected: { absent: true } });
        expect(home.read(".claude/skills/demo-skill/SKILL.md")).toBeUndefined();
        expect((yield* inventory()).revision).toBe(0);
      }).pipe(Effect.provide(home.layer()));
    }
  );
});
