import type { Platform } from "@rivus/agent-kit-platform";
import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { sha256Hex } from "../application/content-hash.js";
import { type LedgerScope, LedgerStore, type LedgerStoreFailure, type LedgerStoreShape } from "../application/ports.js";
import { checkLedgerVersion } from "../domain/ledger/index.js";
import { readText } from "./read-text.js";
import { decodeLedger, decodePreImage, encodeLedger, encodePreImage } from "./ledger-file.js";
import { harnessStateDir } from "./state-dir.js";

type StorePlatform = Pick<Platform, "env" | "home" | "fs">;

function failure(
  scope: LedgerScope,
  reason: LedgerStoreFailure["reason"],
  message: string,
  cause?: unknown
): LedgerStoreFailure {
  return cause === undefined
    ? { _tag: "LedgerStoreFailure", scope: scope.key, reason, message }
    : { _tag: "LedgerStoreFailure", scope: scope.key, reason, message, cause };
}

function makeStore(platform: StorePlatform): LedgerStoreShape {
  const root = harnessStateDir(platform);
  const dirOf = (scope: LedgerScope) => `${root}/${scope.key}`;
  const ledgerPath = (scope: LedgerScope) => `${dirOf(scope)}/ledger.json`;
  const io = <A>(scope: LedgerScope, message: string, run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (cause) => failure(scope, "io", message, cause) });

  const load: LedgerStoreShape["load"] = (scope) =>
    Effect.gen(function* () {
      const path = ledgerPath(scope);
      const text = yield* io(scope, `cannot read ${path}`, () => readText(platform, path));
      if (text === undefined) {
        return undefined;
      }
      const decoded = decodeLedger(text);
      return decoded.ok ? decoded.value : yield* Effect.fail(decoded.error);
    });

  const save: LedgerStoreShape["save"] = (scope, snapshot, expected) =>
    Effect.gen(function* () {
      const path = ledgerPath(scope);
      const text = yield* io(scope, `cannot read ${path}`, () => readText(platform, path));
      if (text !== undefined) {
        const stored: unknown = yield* Effect.try({
          try: () => JSON.parse(text) as unknown,
          catch: (cause) => failure(scope, "invalid-file", `${path} is not JSON; it is kept as it is`, cause)
        });
        const version = checkLedgerVersion(stored);
        if (!version.ok) {
          return yield* Effect.fail(version.error);
        }
        const revision = (stored as { revision?: unknown }).revision;
        if (revision !== expected) {
          return yield* Effect.fail(
            failure(scope, "revision-mismatch", `${path} is at revision ${String(revision)}, not ${String(expected)}`)
          );
        }
      } else if (expected !== undefined) {
        return yield* Effect.fail(
          failure(scope, "revision-mismatch", `${path} is gone; expected revision ${expected}`)
        );
      }
      yield* io(scope, `cannot write ${path}`, async () => {
        await platform.fs.mkdir(dirOf(scope));
        await platform.fs.writeAtomic(path, encodeLedger(snapshot));
      });
    });

  const putPreImage: LedgerStoreShape["putPreImage"] = (scope, content) =>
    Effect.gen(function* () {
      const text = encodePreImage(content);
      const blobRef = `${yield* sha256Hex(text)}.json`;
      const path = `${dirOf(scope)}/pre-images/${blobRef}`;
      yield* io(scope, `cannot write ${path}`, async () => {
        if ((await platform.fs.stat(path)) === undefined) {
          await platform.fs.mkdir(`${dirOf(scope)}/pre-images`);
          await platform.fs.writeAtomic(path, text);
        }
      });
      return blobRef;
    });

  const getPreImage: LedgerStoreShape["getPreImage"] = (scope, blobRef) =>
    Effect.gen(function* () {
      const path = `${dirOf(scope)}/pre-images/${blobRef}`;
      if (!/^[0-9a-f]{64}\.json$/.test(blobRef)) {
        return yield* Effect.fail(failure(scope, "missing-pre-image", `${blobRef} is not a pre-image name`));
      }
      const text = yield* io(scope, `cannot read ${path}`, () => readText(platform, path));
      const content = text === undefined ? undefined : decodePreImage(text);
      return content === undefined
        ? yield* Effect.fail(failure(scope, "missing-pre-image", `${path} is missing or unreadable`))
        : content;
    });

  return { load, save, putPreImage, getPreImage };
}

/**
 * Ledgers as JSON files under `$XDG_STATE_HOME/agent-kit/harness/<scope>/ledger.json` (`~/.local/state` when the
 * variable is unset), written atomically, with pre-images beside them in `pre-images/`. See `LedgerStoreShape` for
 * the calling convention; a file of an unknown `schemaVersion` is never written over.
 */
export const FileLedgerStoreLive: Layer.Layer<LedgerStore, never, PlatformService> = Layer.effect(
  LedgerStore,
  Effect.gen(function* () {
    return makeStore(yield* PlatformService);
  })
);
