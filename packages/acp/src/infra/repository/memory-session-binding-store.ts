import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SessionBindingStore } from "../../application/ports.js";
import type { SessionBinding } from "../../domain/acp-session/index.js";

/** Bindings in this process's memory, for tests and hosts that never load a session after a restart. */
export const MemorySessionBindingStoreLive: Layer.Layer<SessionBindingStore> = Layer.sync(SessionBindingStore, () => {
  const bindings = new Map<string, SessionBinding>();
  return {
    get: (sessionKey) => Effect.sync(() => bindings.get(sessionKey)),
    set: (binding) =>
      Effect.sync(() => {
        bindings.set(binding.sessionKey, binding);
      }),
    remove: (sessionKey, sessionId) =>
      Effect.sync(() => bindings.get(sessionKey)?.sessionId === sessionId && bindings.delete(sessionKey))
  };
});
