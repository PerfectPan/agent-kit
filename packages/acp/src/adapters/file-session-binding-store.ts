import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as z from "zod/mini";

import { type AcpPlatform, SessionBindingStore, type SessionBindingStoreFailure } from "../application/ports.js";
import type { SessionBinding } from "../domain/acp-session/index.js";

const SCHEMA_VERSION = 1;

const Versioned = z.looseObject({ schemaVersion: z.number() });
const BindingFile = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  bindings: z.record(
    z.string(),
    z.object({ agent: z.string(), sessionId: z.string().check(z.minLength(1)), cwd: z.string() })
  )
});

type Bindings = Map<string, SessionBinding>;

/**
 * Bindings in one JSON file at `path`, whose directory must exist. Every operation reads the file again and every
 * change replaces it atomically, so bindings survive restarts. Writes from this Layer are serialized; writers in
 * other processes are not locked out, and the last one to replace the file wins. A file that does not parse, or that
 * a newer version wrote, is refused and left as it is.
 */
export function FileSessionBindingStoreLive(path: string): Layer.Layer<SessionBindingStore, never, PlatformService> {
  return Layer.effect(
    SessionBindingStore,
    Effect.gen(function* () {
      const platform = yield* PlatformService;
      const lock = yield* Semaphore.make(1);
      const read = (sessionKey?: string) => readBindings(platform.fs, path, sessionKey);
      const write = (bindings: Bindings, sessionKey: string) =>
        Effect.tryPromise({
          try: () => platform.fs.writeAtomic(path, serialize(bindings)),
          catch: (cause) => failure("io", `cannot write ${path}`, sessionKey, cause)
        });
      return {
        get: (sessionKey) => read(sessionKey).pipe(Effect.map((bindings) => bindings.get(sessionKey))),
        set: (binding) =>
          lock.withPermits(1)(
            Effect.gen(function* () {
              const bindings = yield* read(binding.sessionKey);
              bindings.set(binding.sessionKey, binding);
              yield* write(bindings, binding.sessionKey);
            })
          ),
        remove: (sessionKey, sessionId) =>
          lock.withPermits(1)(
            Effect.gen(function* () {
              const bindings = yield* read(sessionKey);
              if (bindings.get(sessionKey)?.sessionId !== sessionId) {
                return false;
              }
              bindings.delete(sessionKey);
              yield* write(bindings, sessionKey);
              return true;
            })
          )
      };
    })
  );
}

function readBindings(
  fs: AcpPlatform["fs"],
  path: string,
  sessionKey: string | undefined
): Effect.Effect<Bindings, SessionBindingStoreFailure> {
  return Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: async () => {
        if ((await fs.stat(path, { followSymlinks: true })) === undefined) {
          return undefined;
        }
        const decoder = new TextDecoder();
        let content = "";
        for await (const chunk of fs.read(path)) {
          content += decoder.decode(chunk, { stream: true });
        }
        return content + decoder.decode();
      },
      catch: (cause) => failure("io", `cannot read ${path}`, sessionKey, cause)
    });
    if (text === undefined) {
      return new Map();
    }
    const json = yield* Effect.try({
      try: (): unknown => JSON.parse(text),
      catch: (cause) => failure("invalid-record", `${path} is not JSON`, sessionKey, cause)
    });
    const version = Versioned.safeParse(json);
    if (version.success && version.data.schemaVersion > SCHEMA_VERSION) {
      return yield* Effect.fail(
        failure("unsupported-schema", `${path} has schemaVersion ${version.data.schemaVersion}`, sessionKey)
      );
    }
    const parsed = BindingFile.safeParse(json);
    if (!parsed.success) {
      return yield* Effect.fail(failure("invalid-record", `${path} is not a binding file`, sessionKey, parsed.error));
    }
    return new Map(
      Object.entries(parsed.data.bindings).map(([key, value]) => [key, { sessionKey: key, ...value }] as const)
    );
  });
}

function serialize(bindings: Bindings): string {
  const entries = [...bindings.values()].map(({ sessionKey, agent, sessionId, cwd }) => [
    sessionKey,
    { agent, sessionId, cwd }
  ]);
  return `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, bindings: Object.fromEntries(entries) }, null, 2)}\n`;
}

function failure(
  reason: SessionBindingStoreFailure["reason"],
  message: string,
  sessionKey: string | undefined,
  cause?: unknown
): SessionBindingStoreFailure {
  return {
    _tag: "SessionBindingStoreFailure",
    ...(sessionKey === undefined ? {} : { sessionKey }),
    reason,
    message,
    ...(cause === undefined ? {} : { cause })
  };
}
