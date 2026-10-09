import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { NodePlatformLive } from "@rivus/agent-kit-platform-node/public/effect";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { afterEach } from "vite-plus/test";

import {
  FileSessionBindingStoreLive,
  MemorySessionBindingStoreLive,
  type SessionBinding,
  SessionBindingStore
} from "../src/public.js";
import { removeWorkDirs, workDir } from "./support.js";

afterEach(() => {
  removeWorkDirs();
});

const binding = (sessionKey: string, sessionId: string): SessionBinding => ({
  sessionKey,
  agent: "codex",
  sessionId,
  cwd: "/u/me/work"
});

const stores: readonly [string, () => Layer.Layer<SessionBindingStore>][] = [
  ["memory", () => MemorySessionBindingStoreLive],
  ["file", () => FileSessionBindingStoreLive(join(workDir(), "bindings.json")).pipe(Layer.provide(NodePlatformLive))]
];

describe.each(stores)("%s SessionBindingStore", (_name, layer) => {
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
    }).pipe(Effect.provide(layer()))
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
    }).pipe(Effect.provide(layer()))
  );
});

describe("FileSessionBindingStoreLive", () => {
  it.effect("keeps bindings across reopening", () =>
    Effect.gen(function* () {
      const path = join(workDir(), "bindings.json");
      const open = () => FileSessionBindingStoreLive(path).pipe(Layer.provide(NodePlatformLive));
      yield* Effect.flatMap(SessionBindingStore, (store) => store.set(binding("chat:1", "s1"))).pipe(
        Effect.provide(open())
      );
      const reopened = yield* Effect.flatMap(SessionBindingStore, (store) => store.get("chat:1")).pipe(
        Effect.provide(open())
      );
      expect(reopened).toEqual(binding("chat:1", "s1"));
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
        schemaVersion: 1,
        bindings: { "chat:1": { agent: "codex", sessionId: "s1", cwd: "/u/me/work" } }
      });
    })
  );

  it.effect("refuses an unreadable or newer file and leaves it as it is", () =>
    Effect.gen(function* () {
      for (const [content, reason] of [
        ["not json", "invalid-record"],
        [JSON.stringify({ schemaVersion: 1, bindings: { k: { agent: "codex" } } }), "invalid-record"],
        [JSON.stringify({ schemaVersion: 2, bindings: {} }), "unsupported-schema"]
      ] as const) {
        const path = join(workDir(), "bindings.json");
        writeFileSync(path, content);
        const exit = yield* Effect.exit(
          Effect.flatMap(SessionBindingStore, (store) => store.set(binding("chat:1", "s1"))).pipe(
            Effect.provide(FileSessionBindingStoreLive(path).pipe(Layer.provide(NodePlatformLive)))
          )
        );
        expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
          value: { _tag: "SessionBindingStoreFailure", reason }
        });
        expect(readFileSync(path, "utf8")).toBe(content);
      }
    })
  );
});
