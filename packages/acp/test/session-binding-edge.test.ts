import { expect, it } from "@effect/vitest";
import { NodePlatformLive } from "@rivus/agent-kit-platform-node/public/effect";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { afterEach } from "vite-plus/test";
import { SessionBindingStore, type SessionBinding } from "../src/public.js";
import { connectFake, removeWorkDirs } from "./support.js";
afterEach(removeWorkDirs);
it.effect("treats a custom store's null binding as missing", () =>
  Effect.gen(function* () {
    const connection = yield* connectFake();
    const exit = yield* Effect.exit(connection.loadSession({ sessionKey: "missing" }));
    expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
      value: { _tag: "BindingNotFound", sessionKey: "missing" }
    });
  }).pipe(
    Effect.scoped,
    Effect.provideService(SessionBindingStore, {
      // A JavaScript store may use null as its missing-binding sentinel despite the typed port.
      get: () => Effect.succeed(null as unknown as SessionBinding),
      set: () => Effect.void,
      remove: () => Effect.succeed(false)
    }),
    Effect.provide(NodePlatformLive)
  )
);
