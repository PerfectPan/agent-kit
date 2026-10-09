import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { PlatformService } from "@rivus/agent-kit/platform/effect";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { afterEach } from "vite-plus/test";

import { createLeaseManager, sqliteLeaseRepository } from "../src/lease/public.js";
import { removeTempDirs, tempDir, testPlatform } from "./support/platform.js";
import { startWorker, stopWorkers, type Worker } from "./support/workers.js";

const KEY = "task:1";

afterEach(async () => {
  await stopWorkers();
  removeTempDirs();
});

const stores = [
  { name: "sqlite", location: () => join(tempDir(), "leases.db") },
  { name: "file-nosqlite", location: () => tempDir() }
] as const;

/** Starts contenders, releases them together, and returns what each one got. */
async function contend(
  store: string,
  location: string,
  count: number
): Promise<{ event: string; generation?: unknown }[]> {
  const contenders = Array.from({ length: count }, () =>
    startWorker("lease-worker", [store, location, KEY, "contend"])
  );
  await Promise.all(contenders.map((contender) => contender.next("ready")));
  for (const contender of contenders) {
    contender.send("go");
  }
  return Promise.all(contenders.map((contender) => outcome(contender)));
}

function outcome(worker: Worker): Promise<{ event: string; generation?: unknown }> {
  return Promise.race([worker.next("acquired"), worker.next("held")]).then(({ event, generation }) => ({
    event,
    generation
  }));
}

describe.each(stores)("lease across processes with the $name store", ({ name, location }) => {
  it("lets exactly one of several processes acquire a new key", async () => {
    const results = await contend(name, location(), 4);
    expect(results.filter(({ event }) => event === "acquired")).toEqual([{ event: "acquired", generation: 1 }]);
  });

  it("S61: lets exactly one of several reclaimers take over from a holder that was killed", async () => {
    for (let round = 0; round < 3; round += 1) {
      const where = location();
      const holder = startWorker("lease-worker", [name, where, KEY, "hold"]);
      expect(await holder.next("acquired")).toMatchObject({ generation: 1 });
      holder.signal("SIGKILL");
      await holder.exited;
      const results = await contend(name, where, 4);
      expect(results.filter(({ event }) => event === "acquired")).toEqual([{ event: "acquired", generation: 2 }]);
      expect(results.filter(({ event }) => event === "held")).toHaveLength(3);
      await stopWorkers();
    }
  });
});

describe("lease lost across processes", () => {
  it.live(
    "S64: a stalled holder's fenced work is interrupted when it resumes, before the successor's fenced work starts",
    () => {
      const path = join(tempDir(), "leases.db");
      const log = join(tempDir(), "writes.log");
      writeFileSync(log, "");
      const layer = Layer.provideMerge(sqliteLeaseRepository({ path }), Layer.succeed(PlatformService, testPlatform()));
      return Effect.gen(function* () {
        const stalled = startWorker("lease-worker", ["sqlite", path, KEY, "fenced", log]);
        yield* Effect.promise(() => stalled.next("fenced-start"));
        stalled.signal("SIGSTOP");

        // The worker is alive but silent: this observer takes over once it has seen no renewal for the TTL.
        const leases = yield* createLeaseManager({ ttlMs: 600, heartbeatMs: 150, retryMs: 50 });
        const lease = yield* leases.acquire(KEY, { wait: true });
        expect(lease.token.generation).toBe(2);

        // The stalled holder still holds the fence, so the successor's fenced work waits for it.
        const successor = yield* Effect.forkChild(
          lease.runFenced(() => Effect.sync(() => appendFileSync(log, "P:start\n")))
        );
        yield* Effect.sleep(300);
        expect(readFileSync(log, "utf8")).toBe("F:start\n");

        stalled.signal("SIGCONT");
        expect(yield* Effect.promise(() => stalled.next("fenced-result"))).toMatchObject({ tag: "LeaseLost" });
        yield* Fiber.join(successor);
        expect(readFileSync(log, "utf8")).toBe("F:start\nF:interrupted\nP:start\n");
      }).pipe(Effect.scoped, Effect.provide(layer));
    },
    20_000
  );
});
