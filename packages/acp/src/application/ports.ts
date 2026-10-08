import type { Platform } from "@rivus/agent-kit-platform";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { SessionBinding } from "../domain/acp-session/index.js";

/** The parts of the platform acp uses: `process.spawn` for the agent, `fs` for client file calls, `clock` for events. */
export type AcpPlatform = Pick<Platform, "fs" | "process" | "clock">;

/** The binding store could not be used; what it holds is unknown, not changed. */
export interface SessionBindingStoreFailure {
  readonly _tag: "SessionBindingStoreFailure";
  readonly sessionKey?: string;
  /**
   * `unavailable`: no `SessionBindingStore` was provided, so `sessionKey` cannot be used; `invalid-record`: the stored
   * data is unreadable and is left as it is; `unsupported-schema`: a newer version wrote it; `io`: any other failure.
   */
  readonly reason: "unavailable" | "invalid-record" | "unsupported-schema" | "io";
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * Where SessionBindings live. Calling convention for every implementation:
 *
 * - `set` replaces the binding of the same `sessionKey`: the last write wins.
 * - `remove` deletes the binding of `sessionKey` only while it still names `sessionId`, and reports whether it did, so
 *   invalidating an old session never drops the binding a newer session wrote since.
 * - One process writes a store at a time; the file store serializes its own writes and does not lock across
 *   processes.
 */
export interface SessionBindingStoreShape {
  get(sessionKey: string): Effect.Effect<SessionBinding | undefined, SessionBindingStoreFailure>;
  set(binding: SessionBinding): Effect.Effect<void, SessionBindingStoreFailure>;
  remove(sessionKey: string, sessionId: string): Effect.Effect<boolean, SessionBindingStoreFailure>;
}

const KEY = "@rivus/agent-kit/acp/SessionBindingStore/v1";

// isolatedDeclarations rejects a call expression in `extends`, so the generated base class gets an explicit type.
const SessionBindingStoreBase: Context.ServiceClass<SessionBindingStore, typeof KEY, SessionBindingStoreShape> =
  Context.Service<SessionBindingStore, SessionBindingStoreShape>()(KEY);

/**
 * The SessionBinding store port. It is optional: without it, sessions work and only `sessionKey` fails with
 * `SessionBindingStoreFailure` (`unavailable`). `MemorySessionBindingStoreLive` and `FileSessionBindingStoreLive`
 * provide it.
 */
export class SessionBindingStore extends SessionBindingStoreBase {}
