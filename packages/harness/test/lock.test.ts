import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import { applyInstall } from "../src/application/apply-install.js";
import { inventory } from "../src/application/inventory.js";
import { planInstall } from "../src/application/plan-install.js";
import { LedgerLock } from "../src/application/ports.js";
import { demoBundle } from "./support/bundles.js";
import { removeTestHomes, testHome } from "./support/home.js";
import { startWorker, stopWorkers } from "./support/workers.js";

afterEach(async () => {
  await stopWorkers();
  removeTestHomes();
});

const scope = { key: "user", scope: "user" } as const;

describe("SqliteLedgerLockLive across processes", () => {
  it("S34: lets one of several processes into the critical section at a time", async () => {
    const home = testHome();
    const workers = Array.from({ length: 4 }, () => startWorker("ledger-worker", ["contend", "150"], home.env));
    await Promise.all(workers.map((worker) => worker.next("ready")));
    for (const worker of workers) {
      worker.send("go");
    }
    const spans = await Promise.all(
      workers.map(async (worker) => {
        const entered = await worker.next("entered", 20_000);
        const left = await worker.next("left", 20_000);
        return [entered.time as number, left.time as number] as const;
      })
    );
    const ordered = spans.toSorted((a, b) => a[0] - b[0]);
    for (const [index, [entered]] of ordered.entries()) {
      const previous = ordered[index - 1];
      if (previous !== undefined) {
        expect(entered).toBeGreaterThanOrEqual(previous[1]);
      }
    }
  });

  it("S34: after the holder is killed mid-apply, the next process takes the lock at once and probes the pending steps", async () => {
    const home = testHome();
    const holder = startWorker("ledger-worker", ["stuck-apply"], home.env);
    await holder.next("stuck", 20_000);
    const pending = await Effect.runPromise(inventory().pipe(Effect.provide(home.layer())));
    expect(pending.pending.length).toBeGreaterThan(1);

    const killedAt = performance.now();
    holder.signal("SIGKILL");
    await holder.exited;
    const plan = await Effect.runPromise(
      planInstall(demoBundle(), { agents: ["claude-code", "grok"], lockWaitMs: 5_000 }).pipe(
        Effect.provide(home.layer())
      )
    );
    expect(performance.now() - killedAt).toBeLessThan(1_500);
    const after = await Effect.runPromise(inventory().pipe(Effect.provide(home.layer())));
    // The first step completed before the kill and is recorded; the stuck one and the rest were probed as not started.
    expect(after.pending).toEqual([]);
    expect(after.entries).toHaveLength(1);
    expect(plan.steps.filter((step) => step.action === "noop")).toHaveLength(1);
    await Effect.runPromise(applyInstall(plan).pipe(Effect.provide(home.layer())));
    expect((await Effect.runPromise(inventory().pipe(Effect.provide(home.layer())))).entries.length).toBe(
      plan.steps.length
    );
  });

  it("S34: lets exactly one of several processes take the lock right after its holder was killed mid-transaction", async () => {
    const home = testHome();
    for (let round = 0; round < 3; round += 1) {
      const holder = startWorker("ledger-worker", ["hold"], home.env);
      await holder.next("entered", 20_000);
      holder.signal("SIGKILL");
      await holder.exited;
      const contenders = Array.from({ length: 4 }, () => startWorker("ledger-worker", ["try"], home.env));
      await Promise.all(contenders.map((contender) => contender.next("ready", 20_000)));
      for (const contender of contenders) {
        contender.send("go");
      }
      const outcomes = await Promise.all(
        contenders.map((contender) =>
          Promise.race([contender.next("acquired", 20_000), contender.next("busy", 20_000)]).then((line) => line.event)
        )
      );
      expect(outcomes.filter((event) => event === "acquired")).toHaveLength(1);
      await stopWorkers();
    }
  });

  it("S34: a waiter behind a stuck holder can be interrupted and takes nothing; it gets the lock once the holder dies", async () => {
    const home = testHome();
    const holder = startWorker("ledger-worker", ["hold"], home.env);
    await holder.next("entered", 20_000);
    const layer = home.layer();
    await Effect.runPromise(
      Effect.gen(function* () {
        const lock = yield* LedgerLock;
        const waiter = yield* Effect.forkChild(Effect.scoped(lock.acquire(scope, { waitMs: 60_000 })));
        yield* Effect.sleep(300);
        yield* Fiber.interrupt(waiter);
        const busy = yield* Effect.flip(Effect.scoped(lock.acquire(scope, { waitMs: 0 })));
        expect(busy).toMatchObject({ _tag: "LedgerBusy", scope: "user" });
        expect(busy._tag === "LedgerBusy" ? busy.holder : undefined).toContain(`"pid":${holder.pid}`);
      }).pipe(Effect.provide(layer))
    );
    holder.signal("SIGKILL");
    await holder.exited;
    await Effect.runPromise(
      Effect.scoped(Effect.flatMap(LedgerLock, (lock) => lock.acquire(scope, { waitMs: 2_000 }))).pipe(
        Effect.provide(layer)
      )
    );
  });
});

describe("applyInstall across processes", () => {
  it("S34: two processes applying plans built on the same ledger: one applies, the other is refused as stale", async () => {
    const home = testHome();
    const workers = [0, 1].map(() => startWorker("ledger-worker", ["apply"], home.env));
    await Promise.all(workers.map((worker) => worker.next("ready", 20_000)));
    for (const worker of workers) {
      worker.send("go");
    }
    const outcomes = await Promise.all(
      workers.map((worker) =>
        Promise.race([worker.next("applied", 20_000), worker.next("stale", 20_000)]).then((line) => line.event)
      )
    );
    expect(outcomes.toSorted()).toEqual(["applied", "stale"]);
    const after = await Effect.runPromise(inventory().pipe(Effect.provide(home.layer())));
    expect(after.pending).toEqual([]);
    expect(after.entries.length).toBeGreaterThan(0);
    expect(home.read(".grok/hooks/demo-app.json")).toContain("demo-hook --agent grok");
  });

  it("S34: an apply interrupted while it waits for the lock writes nothing, and applies once the holder is gone", async () => {
    const home = testHome();
    const layer = home.layer();
    const plan = await Effect.runPromise(planInstall(demoBundle(), { agents: ["grok"] }).pipe(Effect.provide(layer)));
    const holder = startWorker("ledger-worker", ["hold"], home.env);
    await holder.next("entered", 20_000);
    await Effect.runPromise(
      Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(applyInstall(plan, { lockWaitMs: 60_000 }));
        yield* Effect.sleep(300);
        yield* Fiber.interrupt(waiting);
      }).pipe(Effect.provide(layer))
    );
    expect(plan.status).toBe("ready");
    expect(home.read(".grok/hooks/demo-app.json")).toBeUndefined();
    holder.signal("SIGKILL");
    await holder.exited;
    await Effect.runPromise(applyInstall(plan, { lockWaitMs: 2_000 }).pipe(Effect.provide(layer)));
    expect(plan.status).toBe("applied");
    expect(home.read(".grok/hooks/demo-app.json")).toContain("demo-hook --agent grok");
  });
});

describe("without SQLite", () => {
  it.effect("S35: refuses to change the ledger with LedgerLockUnavailable and writes nothing", () => {
    const home = testHome();
    const platform = { ...home.platform, sqlite: undefined };
    return Effect.gen(function* () {
      const plan = yield* planInstall(demoBundle(), { agents: ["grok"] });
      const failure = yield* Effect.flip(applyInstall(plan));
      expect(failure).toMatchObject({ _tag: "LedgerLockUnavailable" });
      expect(home.read(".grok/hooks/demo-app.json")).toBeUndefined();
      expect((yield* inventory()).revision).toBe(0);
    }).pipe(Effect.provide(home.layer(platform)));
  });

  it.effect("accepts an injected LedgerLock instead", () => {
    const home = testHome();
    const platform = { ...home.platform, sqlite: undefined };
    const injected = Layer.succeed(LedgerLock, { acquire: () => Effect.void, holder: () => Effect.succeed(undefined) });
    return Effect.gen(function* () {
      const plan = yield* planInstall(demoBundle(), { agents: ["grok"] });
      yield* applyInstall(plan);
      expect(home.read(".grok/hooks/demo-app.json")).toContain(`"SessionStart"`);
    }).pipe(Effect.provide(Layer.merge(home.layer(platform), injected)));
  });
});
