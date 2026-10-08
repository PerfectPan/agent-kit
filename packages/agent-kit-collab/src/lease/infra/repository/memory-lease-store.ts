import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import type { LeaseSnapshot } from "../../domain/lease/index.js";
import { LeaseStore } from "../../application/ports.js";

/**
 * A store for one process, such as tests or a host whose leases never cross a process boundary. Each Layer build
 * starts empty.
 */
export function memoryLeaseStore(): Layer.Layer<LeaseStore> {
  return Layer.sync(LeaseStore, () => {
    const records = new Map<string, LeaseSnapshot>();
    const fences = new Map<string, Semaphore.Semaphore>();
    const fenceOf = (key: string) => {
      const fence = fences.get(key) ?? Semaphore.makeUnsafe(1);
      fences.set(key, fence);
      return fence;
    };
    return {
      read: (key) => Effect.sync(() => records.get(key)),
      compareAndSet: (key, expected, next) =>
        Effect.sync(() => {
          if (records.get(key)?.revision !== expected) {
            return false;
          }
          records.set(key, next);
          return true;
        }),
      fence: (key) =>
        Effect.acquireRelease(fenceOf(key).take(1), () => fenceOf(key).release(1), { interruptible: true }).pipe(
          Effect.asVoid
        )
    };
  });
}
