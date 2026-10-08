import { appendFileSync } from "node:fs";

import { PlatformService } from "@rivus/agent-kit/platform/effect";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { createLeaseManager, fileLeaseRepository, sqliteLeaseRepository } from "../../src/lease/public.js";
import { testPlatform } from "../support/platform.js";
import { print, stdinLine } from "../support/workers.js";

// Usage: lease-worker <sqlite|file|file-nosqlite> <location> <key> <hold|contend|fenced> [log]
// In `fenced` mode the work appends `F:start`, then `F:end` or `F:interrupted`, to the log file.
const [store = "", location = "", key = "", mode, log = ""] = process.argv.slice(2);

const TTL_MS = 600;
const HEARTBEAT_MS = 150;

const platform = Layer.succeed(PlatformService, testPlatform({ sqlite: store !== "file-nosqlite" }));
const storeLayer =
  store === "sqlite" ? sqliteLeaseRepository({ path: location }) : fileLeaseRepository({ dir: location });

const program = Effect.gen(function* () {
  const leases = yield* createLeaseManager({ ttlMs: TTL_MS, heartbeatMs: HEARTBEAT_MS });
  if (mode === "contend") {
    print("ready");
    yield* Effect.promise(() => stdinLine("go"));
  }
  const acquired = yield* Effect.exit(leases.acquire(key));
  if (acquired._tag === "Failure") {
    print("held", { cause: String(acquired.cause) });
    return;
  }
  const lease = acquired.value;
  print("acquired", { generation: lease.token.generation, pid: process.pid });
  if (mode !== "fenced") {
    return yield* Effect.never;
  }
  const outcome = yield* Effect.exit(
    lease.runFenced((token) =>
      Effect.gen(function* () {
        appendFileSync(log, "F:start\n");
        print("fenced-start", { generation: token.generation });
        yield* Effect.sleep(30_000);
        appendFileSync(log, "F:end\n");
      }).pipe(Effect.onInterrupt(() => Effect.sync(() => appendFileSync(log, "F:interrupted\n"))))
    )
  );
  print("fenced-result", {
    tag: outcome._tag === "Success" ? "ok" : (Cause.squash(outcome.cause) as { _tag?: unknown })._tag
  });
});

await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(storeLayer), Effect.provide(platform)));
process.exit(0);
