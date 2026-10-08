import { describe, expect, it } from "@effect/vitest";
import type { TranscriptStreamPart } from "@rivus/agent-kit-sessions";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { afterEach } from "vitest";

import { NodePlatformLive } from "@rivus/agent-kit-platform-node/public/effect";
import * as Layer from "effect/Layer";

import { type AcpSessionHandle, type SessionBinding, SessionBindingStore } from "../src/public.js";
import { alive, connectFake, eventTexts, eventually, pidIn, removeWorkDirs, TestLive, text } from "./support.js";

afterEach(() => {
  removeWorkDirs();
});

/** Runs a turn in a child fiber, keeping its parts as they arrive. */
const start = (stream: Stream.Stream<TranscriptStreamPart, unknown>) =>
  Effect.gen(function* () {
    const parts: TranscriptStreamPart[] = [];
    const fiber = yield* stream.pipe(
      Stream.runForEach((part) => Effect.sync(() => parts.push(part))),
      Effect.exit,
      Effect.forkChild
    );
    return { parts, fiber };
  });

const said = (parts: readonly TranscriptStreamPart[], words: string) => () =>
  parts.some((part) => part.type === "text-delta" && part.delta.includes(words));

describe("cancel", () => {
  it.effect("S82: a cancel that settles ends the turn as cancelled and keeps the session usable", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake();
      const session = yield* connection.newSession({ sessionKey: "chat:1" });
      const turn = yield* start(session.prompt([text("hang")]));
      yield* eventually(said(turn.parts, "working"));
      yield* session.cancel();
      expect(yield* Fiber.join(turn.fiber)).toEqual(Exit.void);
      expect(turn.parts.filter((part) => part.type === "finish")).toEqual([
        { type: "finish", id: "1.1", finishReason: "cancelled" }
      ]);
      expect((yield* session.snapshot).state).toBe("ready");
      expect(yield* (yield* SessionBindingStore).get("chat:1")).toMatchObject({ sessionId: session.sessionId });
      expect(eventTexts(yield* Stream.runCollect(session.prompt([text("next")])))).toEqual(["turn 2: next"]);
      yield* session.cancel();
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("interrupting the turn's stream cancels the turn", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake();
      const session = yield* connection.newSession();
      const turn = yield* start(session.prompt([text("hang")]));
      yield* eventually(said(turn.parts, "working"));
      yield* Fiber.interrupt(turn.fiber);
      expect((yield* session.snapshot).state).toBe("ready");
      const first = yield* Stream.runCollect(session.prompt([text("echo abc")]).pipe(Stream.take(1)));
      expect(first.map((part) => part.type)).toEqual(["reasoning-start"]);
      expect((yield* session.snapshot).state).toBe("ready");
      expect(eventTexts(yield* Stream.runCollect(session.prompt([text("after")])))).toEqual(["turn 3: after"]);
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("answers a pending permission request with cancelled once the turn is cancelling", () =>
    Effect.gen(function* () {
      let asked = false;
      const connection = yield* connectFake({
        onPermission: () =>
          Effect.sync(() => {
            asked = true;
          }).pipe(Effect.andThen(Effect.never))
      });
      const session = yield* connection.newSession();
      const turn = yield* start(session.prompt([text("permission")]));
      yield* eventually(() => asked);
      expect((yield* session.snapshot).state).toBe("awaiting-permission");
      yield* session.cancel();
      expect(yield* Fiber.join(turn.fiber)).toEqual(Exit.void);
      expect(eventTexts(turn.parts)).toEqual(['permission {"outcome":"cancelled"}']);
      expect(yield* session.snapshot).toMatchObject({ state: "ready", pendingPermissions: 0 });
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.live("answers cancelled at once when the permission callback cancels or closes its own session", () =>
    Effect.gen(function* () {
      const handles: AcpSessionHandle[] = [];
      let calls = 0;
      // The callback is interrupted once the cancel it started is under way, so it never sees the cancel return.
      const connection = yield* connectFake({
        cancelTimeoutMs: 3_000,
        onPermission: () =>
          Effect.gen(function* () {
            const session = handles.at(-1);
            calls += 1;
            yield* Effect.ignore(
              session?.sessionKey === "close" ? session.close() : (session?.cancel() ?? Effect.void)
            );
            return undefined;
          })
      });
      for (const sessionKey of ["cancel", "close"]) {
        const session = yield* connection.newSession({ sessionKey });
        handles.push(session);
        const parts = yield* Stream.runCollect(session.prompt([text("permission")]));
        expect(eventTexts(parts)).toEqual(['permission {"outcome":"cancelled"}']);
        expect(parts.at(-2)).toMatchObject({ type: "finish", finishReason: "cancelled" });
        expect(yield* (yield* SessionBindingStore).get(sessionKey)).toMatchObject({ sessionId: session.sessionId });
      }
      expect(calls).toBe(2);
      const [cancelled, closed] = handles as [AcpSessionHandle, AcpSessionHandle];
      yield* eventually(() => Effect.runSync(closed.snapshot).state === "closed");
      expect(yield* closed.snapshot).toMatchObject({ closeReason: "closed" });
      expect(yield* cancelled.snapshot).toMatchObject({ state: "ready" });
      expect(eventTexts(yield* Stream.runCollect(cancelled.prompt([text("still")])))).toEqual(["turn 2: still"]);
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("stops the process before a binding store that hangs is given up on", () =>
    Effect.gen(function* () {
      const bindings = new Map<string, SessionBinding>();
      const hanging = Layer.succeed(SessionBindingStore, {
        get: (sessionKey) => Effect.sync(() => bindings.get(sessionKey)),
        set: (binding) => Effect.sync(() => void bindings.set(binding.sessionKey, binding)),
        remove: () => Effect.never
      });
      const run = Effect.gen(function* () {
        const connection = yield* connectFake({ cancelTimeoutMs: 5_000, requestTimeoutMs: 1_000 });
        const session = yield* connection.newSession({ sessionKey: "chat:hang" });
        const report = JSON.parse(eventTexts(yield* Stream.runCollect(session.prompt([text("inspect")])))[0] ?? "{}");
        const stuck = yield* start(session.prompt([text("stubborn")]));
        yield* eventually(said(stuck.parts, "working"));
        const cancel = yield* session.cancel().pipe(Effect.exit, Effect.forkChild);
        yield* eventually(said(stuck.parts, "cancel received"));
        yield* TestClock.adjust(5_000);
        yield* eventually(() => !alive(report.pid as number));
        expect(cancel.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust(1_000);
        const cancelled = yield* Fiber.join(cancel);
        expect(Exit.isFailure(cancelled) && Exit.findErrorOption(cancelled)).toMatchObject({
          value: { _tag: "CancelUnsettled", sessionKey: "chat:hang", binding: "failed" }
        });
      });
      yield* run.pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodePlatformLive, hanging)));
    })
  );

  it.effect(
    "S83: a cancel that does not settle by its deadline removes the binding and closes the connection, failing its other sessions",
    () =>
      Effect.gen(function* () {
        const connection = yield* connectFake({ cancelTimeoutMs: 5_000 });
        const stubborn = yield* connection.newSession({ sessionKey: "chat:stubborn" });
        const other = yield* connection.newSession({ sessionKey: "chat:other" });
        const stuck = yield* start(stubborn.prompt([text("stubborn")]));
        const bystander = yield* start(other.prompt([text("hang")]));
        yield* eventually(said(stuck.parts, "working"));
        yield* eventually(said(bystander.parts, "working"));

        const cancel = yield* stubborn.cancel().pipe(Effect.exit, Effect.forkChild);
        yield* eventually(said(stuck.parts, "cancel received"));
        yield* TestClock.adjust(4_999);
        expect(cancel.pollUnsafe()).toBeUndefined();
        expect((yield* stubborn.snapshot).state).toBe("cancelling");
        const store = yield* SessionBindingStore;
        expect(yield* store.get("chat:stubborn")).toBeDefined();

        yield* TestClock.adjust(1);
        const cancelled = yield* Fiber.join(cancel);
        expect(Exit.isFailure(cancelled) && Exit.findErrorOption(cancelled)).toMatchObject({
          value: {
            _tag: "CancelUnsettled",
            sessionId: stubborn.sessionId,
            sessionKey: "chat:stubborn",
            timeoutMs: 5_000,
            binding: "removed"
          }
        });
        expect(yield* store.get("chat:stubborn")).toBeUndefined();
        expect(yield* store.get("chat:other")).toBeDefined();

        const stuckExit = yield* Fiber.join(stuck.fiber);
        expect(Exit.isFailure(stuckExit) && Exit.findErrorOption(stuckExit)).toMatchObject({
          value: { _tag: "CancelUnsettled" }
        });
        const bystanderExit = yield* Fiber.join(bystander.fiber);
        expect(Exit.isFailure(bystanderExit) && Exit.findErrorOption(bystanderExit)).toMatchObject({
          value: { _tag: "ConnectionClosed", reason: "cancel-unsettled" }
        });
        expect(yield* stubborn.snapshot).toMatchObject({ state: "closed", closeReason: "cancel-unsettled" });
        expect(yield* other.snapshot).toMatchObject({ state: "closed", closeReason: "connection-closed" });

        const ended = yield* connection.ended;
        expect(ended.reason).toBe("cancel-unsettled");
        const pid = pidIn(ended.stderr);
        yield* eventually(() => !alive(pid));
      }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("S84: a closed session refuses every operation", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake({ fake: { FAKE_ACP_SESSION_CLOSE: "1" } });
      const session = yield* connection.newSession();
      yield* session.close();
      expect(yield* session.snapshot).toMatchObject({ state: "closed", closeReason: "closed" });
      const prompt = yield* Effect.exit(Stream.runCollect(session.prompt([text("again")])));
      expect(Exit.isFailure(prompt) && Exit.findErrorOption(prompt)).toMatchObject({
        value: { _tag: "SessionClosed", sessionId: session.sessionId, reason: "closed" }
      });
      const cancel = yield* Effect.exit(session.cancel());
      expect(Exit.isFailure(cancel) && Exit.findErrorOption(cancel)).toMatchObject({
        value: { _tag: "SessionClosed" }
      });
      yield* session.close();

      const busy = yield* connection.newSession();
      const turn = yield* start(busy.prompt([text("hang")]));
      yield* eventually(said(turn.parts, "working"));
      yield* busy.close();
      expect(yield* Fiber.join(turn.fiber)).toEqual(Exit.void);
      expect(turn.parts.at(-2)).toMatchObject({ type: "finish", finishReason: "cancelled" });
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );
});

describe("the connection's end", () => {
  it.effect("an agent process that exits fails the running turns and closes every session", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake();
      const dying = yield* connection.newSession();
      const other = yield* connection.newSession();
      const bystander = yield* start(other.prompt([text("hang")]));
      yield* eventually(said(bystander.parts, "working"));
      const exit = yield* Effect.exit(Stream.runCollect(dying.prompt([text("exit")])));
      expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
        value: { _tag: "ConnectionClosed", reason: "exited" }
      });
      const bystanderExit = yield* Fiber.join(bystander.fiber);
      expect(Exit.isFailure(bystanderExit) && Exit.findErrorOption(bystanderExit)).toMatchObject({
        value: { _tag: "ConnectionClosed", reason: "exited" }
      });
      const ended = yield* connection.ended;
      expect(ended).toMatchObject({ reason: "exited" });
      expect(yield* other.snapshot).toMatchObject({ state: "closed", closeReason: "connection-closed" });
      const opened = yield* Effect.exit(connection.newSession());
      expect(Exit.isFailure(opened) && Exit.findErrorOption(opened)).toMatchObject({
        value: { _tag: "ConnectionClosed", reason: "exited" }
      });
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("closing the connection stops a process that ignores SIGTERM and fails its turns", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake({ fake: { FAKE_ACP_IGNORE_SIGTERM: "1" } });
      const session = yield* connection.newSession();
      const turn = yield* start(session.prompt([text("hang")]));
      yield* eventually(said(turn.parts, "working"));
      yield* connection.close();
      const turnExit = yield* Fiber.join(turn.fiber);
      expect(Exit.isFailure(turnExit) && Exit.findErrorOption(turnExit)).toMatchObject({
        value: { _tag: "ConnectionClosed", reason: "closed" }
      });
      const ended = yield* connection.ended;
      expect(alive(pidIn(ended.stderr))).toBe(false);
      expect(yield* session.snapshot).toMatchObject({ state: "closed" });
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.live(
    "S88: a connection leaves no process, timer or pipe behind",
    () =>
      Effect.gen(function* () {
        const tracked = ["Timeout", "ChildProcess", "PipeWrap", "ProcessWrap"];
        const counts = () => {
          const all = process.getActiveResourcesInfo();
          return Object.fromEntries(tracked.map((kind) => [kind, all.filter((name) => name === kind).length]));
        };
        // Processes of earlier tests may still be exiting; the baseline starts after them.
        yield* eventually(() => counts().ProcessWrap === 0, 5_000);
        const before = counts();
        const pid = yield* Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* connectFake({ cancelTimeoutMs: 2_000 });
            const session = yield* connection.newSession();
            yield* Stream.runDrain(session.prompt([text("echo leak check")]));
            yield* Stream.runDrain(session.prompt([text("permission")]));
            const turn = yield* start(session.prompt([text("hang")]));
            yield* eventually(said(turn.parts, "working"));
            yield* session.cancel();
            const report = JSON.parse(
              eventTexts(yield* Stream.runCollect(session.prompt([text("inspect")])))[0] ?? "{}"
            );
            return report.pid as number;
          }).pipe(Effect.provide(TestLive))
        );
        expect(alive(pid)).toBe(false);
        // The runner may hold timers of its own when the baseline is taken; the connection may add none.
        const settled = () => tracked.every((kind) => (counts()[kind] ?? 0) <= (before[kind] ?? 0));
        yield* eventually(settled, 5_000);
        expect(counts()).toEqual(expect.objectContaining({ ChildProcess: 0, ProcessWrap: 0 }));
      }),
    20_000
  );
});
