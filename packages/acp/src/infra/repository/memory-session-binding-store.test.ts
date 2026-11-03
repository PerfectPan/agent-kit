import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { SessionBindingStore } from "../../application/ports.js";
import type { SessionBindingSnapshot } from "../../domain/acp-session/value-objects/session-binding.js";
import { MemorySessionBindingStoreLive } from "./memory-session-binding-store.js";

const binding = (sessionKey: string, sessionId: string): SessionBindingSnapshot => ({
  sessionKey,
  agent: "codex",
  sessionId,
  cwd: "/u/me/work"
});

describe("memory SessionBindingStore", () => {
  it.effect("reads, writes and deletes a binding", () =>
    Effect.gen(function* () {
      const store = yield* SessionBindingStore;
      expect(yield* store.get("chat:1")).toBeUndefined();
      yield* store.set(binding("chat:1", "s1"));
      yield* store.set(binding("chat:2", "s2"));
      expect(yield* store.get("chat:1")).toEqual(binding("chat:1", "s1"));
      expect(yield* store.remove("chat:1", "s1")).toBe(true);
      expect(yield* store.get("chat:1")).toBeUndefined();
      expect(yield* store.get("chat:2")).toEqual(binding("chat:2", "s2"));
    }).pipe(Effect.provide(MemorySessionBindingStoreLive))
  );

  it.effect("lets the last write win and removes a binding only while it names the session", () =>
    Effect.gen(function* () {
      const store = yield* SessionBindingStore;
      yield* store.set(binding("chat:1", "old"));
      yield* store.set(binding("chat:1", "new"));
      expect(yield* store.get("chat:1")).toEqual(binding("chat:1", "new"));
      expect(yield* store.remove("chat:1", "old")).toBe(false);
      expect(yield* store.get("chat:1")).toEqual(binding("chat:1", "new"));
      expect(yield* store.remove("chat:9", "new")).toBe(false);
    }).pipe(Effect.provide(MemorySessionBindingStoreLive))
  );
});
