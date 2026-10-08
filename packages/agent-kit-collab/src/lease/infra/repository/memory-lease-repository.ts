import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import type { LeaseSnapshot } from "../../domain/lease/index.js";
import { LeaseRepository } from "../../application/ports.js";
import { revisionConflict } from "../../application/services/repository-failure.js";

/**
 * A repository for one process, such as tests or a host whose leases never cross a process boundary. Each Layer
 * build starts empty.
 */
export function memoryLeaseRepository(): Layer.Layer<LeaseRepository> {
  return Layer.sync(LeaseRepository, () => {
    const records = new Map<string, LeaseSnapshot>();
    const fences = new Map<string, Semaphore.Semaphore>();
    const fenceOf = (key: string) => {
      const fence = fences.get(key) ?? Semaphore.makeUnsafe(1);
      fences.set(key, fence);
      return fence;
    };
    return {
      load: (key) => Effect.sync(() => records.get(key)),
      save: (key, next, expectedRevision) =>
        Effect.suspend(() => {
          const stored = records.get(key);
          if (stored?.revision !== expectedRevision) {
            return Effect.fail(revisionConflict(key, expectedRevision, stored?.revision));
          }
          return Effect.sync(() => {
            records.set(key, next);
          });
        }),
      fence: (key) =>
        Effect.acquireRelease(fenceOf(key).take(1), () => fenceOf(key).release(1), { interruptible: true }).pipe(
          Effect.asVoid
        )
    };
  });
}
