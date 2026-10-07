import type { Platform } from "@rivus/agent-kit/platform";
import { PlatformService } from "@rivus/agent-kit/platform/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { readText } from "../../process-lock/application/holder.js";
import type { LeaseSnapshot } from "../domain/lease/index.js";
import { LeaseStore, type LeaseStoreFailure } from "../application/ports.js";
import { storeFailure } from "../application/store-failure.js";
import { keyFileName } from "./key-file-name.js";
import { decodeSnapshot } from "./lease-record-codec.js";
import { holdProcessLock } from "./process-fence.js";

export interface FileLeaseStoreOptions {
  /** An existing local directory that holds one record file and its lock files per key. */
  readonly dir: string;
}

const SCHEMA_VERSION = 1;
/**
 * A guard is held only for one read, compare and write, so waiting longer means a stalled holder: the write reports
 * `busy` instead of waiting, and callers such as a heartbeat retry it later.
 */
const GUARD_TIMEOUT_MS = 1000;

type FilePlatform = Pick<Platform, "fs" | "process" | "clock" | "sqlite">;

/**
 * The fallback store for platforms without SQLite: one JSON record per key, `<key>.lease.json`, replaced with
 * `writeAtomic`. Every `compareAndSet` holds the key's guard (`<key>.lease.guard`) while it reads, compares and
 * writes, and reports `busy` when the guard stays held longer than a second; `fence` holds `<key>.lease.fence`.
 * Both are process locks, so without SQLite they are lock files whose dead holders are reclaimed one reclaimer at a
 * time, with the gaps `acquireProcessLock` documents. A record with an unknown `schemaVersion` or shape is refused
 * and never overwritten.
 */
export function fileLeaseStore(options: FileLeaseStoreOptions): Layer.Layer<LeaseStore, never, PlatformService> {
  const { dir } = options;
  return Layer.effect(
    LeaseStore,
    Effect.gen(function* () {
      const platform = yield* PlatformService;
      const pathOf = (key: string, suffix: string) =>
        keyFileName(key).pipe(Effect.map((name) => `${dir}/${name}.lease${suffix}`));
      const read = (key: string) =>
        pathOf(key, ".json").pipe(Effect.flatMap((path) => readRecord(platform, key, path)));
      return {
        read,
        compareAndSet: (key, expected, next) =>
          Effect.scoped(
            Effect.gen(function* () {
              yield* holdProcessLock(platform, key, yield* pathOf(key, ".guard"), { timeoutMs: GUARD_TIMEOUT_MS });
              const path = yield* pathOf(key, ".json");
              // Read, compare and write finish together; the guard is released after them, even on interruption.
              return yield* Effect.uninterruptible(
                Effect.gen(function* () {
                  const current = yield* readRecord(platform, key, path);
                  if (current?.revision !== expected) {
                    return false;
                  }
                  yield* Effect.tryPromise({
                    try: () =>
                      platform.fs.writeAtomic(path, JSON.stringify({ schemaVersion: SCHEMA_VERSION, record: next })),
                    catch: (cause) => storeFailure(key, "io", `cannot write ${path}`, cause)
                  });
                  return true;
                })
              );
            })
          ),
        fence: (key) => pathOf(key, ".fence").pipe(Effect.flatMap((path) => holdProcessLock(platform, key, path)))
      };
    })
  );
}

function readRecord(
  platform: FilePlatform,
  key: string,
  path: string
): Effect.Effect<LeaseSnapshot | undefined, LeaseStoreFailure> {
  return Effect.tryPromise({
    try: () => readText(platform, path),
    catch: (cause) => storeFailure(key, "io", `cannot read ${path}`, cause)
  }).pipe(Effect.flatMap((text) => (text === undefined ? Effect.succeed(undefined) : decodeFile(key, path, text))));
}

function decodeFile(key: string, path: string, text: string): Effect.Effect<LeaseSnapshot, LeaseStoreFailure> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return Effect.fail(storeFailure(key, "invalid-record", `${path} is not JSON`, cause));
  }
  const { schemaVersion, record } = (typeof json === "object" && json !== null ? json : {}) as {
    schemaVersion?: unknown;
    record?: unknown;
  };
  if (schemaVersion !== SCHEMA_VERSION) {
    return Effect.fail(
      storeFailure(key, "unsupported-schema", `${path} has schemaVersion ${String(schemaVersion)}; expected 1`)
    );
  }
  const snapshot = decodeSnapshot(record);
  return snapshot === undefined
    ? Effect.fail(storeFailure(key, "invalid-record", `${path} holds a record of an unexpected shape`))
    : Effect.succeed(snapshot);
}
