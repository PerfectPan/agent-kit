import type { Platform } from "@rivus/agent-kit/platform";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import { backoffMs, tryProcessLock } from "../../../process-lock/application/use-cases/acquire-process-lock.js";
import type { LeaseStoreFailure } from "../../application/ports.js";
import { storeFailure } from "../../application/services/store-failure.js";

/** The first retry of a waiting fence or guard; later ones back off from it. */
const RETRY_MS = 10;

export interface HoldOptions {
  /** Give up with a `busy` failure after this long; without it, wait until the lock is free or the fiber is interrupted. */
  readonly timeoutMs?: number;
}

/**
 * Holds a process lock at `path` until the Scope closes: an exclusive SQLite lock when the platform has SQLite, a
 * lock file otherwise. Each attempt is uninterruptible and registers its release in the same step; waiting happens
 * between attempts, where interruption is safe, with a growing pause. A holder that exits frees the lock at once.
 */
export function holdProcessLock(
  platform: Pick<Platform, "fs" | "process" | "clock" | "sqlite">,
  key: string,
  path: string,
  options: HoldOptions = {}
): Effect.Effect<void, LeaseStoreFailure, Scope.Scope> {
  const attempt = (first: boolean) =>
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () => tryProcessLock(platform, path, { first }),
        catch: (cause) => storeFailure(key, "io", `cannot lock ${path}`, cause)
      }).pipe(
        Effect.flatMap((result) =>
          result.ok ? Effect.succeed(result.value) : Effect.fail(storeFailure(key, "busy", `${path} is locked`))
        )
      ),
      (lock) => Effect.promise(() => lock.release())
    );
  return Effect.gen(function* () {
    const started = platform.clock.monotonic();
    for (let turn = 0; ; turn += 1) {
      const acquired = yield* attempt(turn === 0).pipe(
        Effect.as(true),
        Effect.catchIf(
          (failure) => failure.reason === "busy",
          () => Effect.succeed(false)
        )
      );
      if (acquired) {
        return;
      }
      if (options.timeoutMs !== undefined && platform.clock.monotonic() - started >= options.timeoutMs) {
        return yield* Effect.fail(storeFailure(key, "busy", `${path} is still locked after ${options.timeoutMs} ms`));
      }
      yield* Effect.sleep(backoffMs(RETRY_MS, turn));
    }
  });
}
