import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { isAgentKitError } from "@rivus/agent-kit-catalog";
import { foldStreamParts, type TranscriptStreamPart } from "@rivus/agent-kit-sessions";
import { NodePlatformLive } from "@rivus/agent-kit-platform-node/public/effect";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { afterEach } from "vite-plus/test";

import { connectAgent, optionOfKind, probeAgent, SessionBindingStore } from "../src/public.js";
import {
  connectFake,
  eventTexts,
  fakeProfile,
  removeWorkDirs,
  TestLive,
  text,
  untilState,
  workDir
} from "./support.js";

afterEach(() => {
  removeWorkDirs();
});

const run = (parts: Stream.Stream<TranscriptStreamPart, unknown>) => Stream.runCollect(parts);

describe("connectAgent", () => {
  it.effect("completes the handshake and reports the agent", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake();
      expect(connection.agentInfo).toEqual({ name: "fake-agent", version: "1.2.3" });
      expect(connection.features).toMatchObject({
        loadSession: false,
        image: true,
        mcpHttp: true,
        mcpSse: false
      });
      expect(connection.authMethods).toEqual([{ id: "fake-login", name: "Fake login" }]);
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("S80: the agent receives only the environment it is given", () =>
    Effect.gen(function* () {
      process.env.ACP_TEST_LEAK = "parent";
      const connection = yield* connectFake({ fake: { FAKE_ACP_MARK: "given" } });
      const session = yield* connection.newSession();
      const parts = yield* run(session.prompt([text("inspect")]));
      const report = JSON.parse(eventTexts(parts)[0] ?? "{}") as { env: string[] };
      expect(report.env).toContain("FAKE_ACP_MARK");
      expect(report.env).not.toContain("ACP_TEST_LEAK");
      expect(report.env).not.toContain("PATH");
    }).pipe(
      Effect.scoped,
      Effect.provide(TestLive),
      Effect.ensuring(Effect.sync(() => delete process.env.ACP_TEST_LEAK))
    )
  );

  it.effect("S81: a turn streams deltas and completed events, and folding the deltas gives the same events", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake();
      const session = yield* connection.newSession();
      const parts = yield* run(session.prompt([text("echo hello world")]));
      const deltas = parts.filter((part) => part.type !== "event");
      expect(deltas.map((part) => part.type)).toEqual([
        "reasoning-start",
        "reasoning-delta",
        "reasoning-end",
        "text-start",
        "text-delta",
        "text-delta",
        "text-end",
        "tool-input-start",
        "tool-input-available",
        "tool-output-available",
        "update",
        "text-start",
        "text-delta",
        "text-end",
        "finish"
      ]);
      const events = parts.flatMap((part) => (part.type === "event" ? [part.event] : []));
      expect(events.map((event) => [event.kind, event.payload])).toEqual([
        ["reasoning", { text: "thinking about it" }],
        ["assistant", { text: "hello world" }],
        ["tool_call", { callId: "call-1", name: "read_file", args: { path: "a.txt" } }],
        ["tool_result", { callId: "call-1", isError: false, output: "file body" }],
        ["system", { type: "plan" }],
        ["assistant", { text: "done" }],
        [
          "request",
          {
            granularity: "turn",
            finishReason: "end_turn",
            usage: {
              inputTokens: 14,
              outputTokens: 7,
              totalTokens: 21,
              cacheReadTokens: 4,
              reasoningTokens: 2
            }
          }
        ]
      ]);
      expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      // Each completed event comes right after the part that completed it.
      const completing = parts.flatMap((part, index) => (part.type === "event" ? [parts[index - 1]?.type] : []));
      expect(completing).toEqual([
        "reasoning-end",
        "text-end",
        "tool-output-available",
        "event",
        "update",
        "text-end",
        "finish"
      ]);
      const timeless = (event: (typeof events)[number]) => ({ ...event, ts: 0 });
      expect(foldStreamParts(deltas).map(timeless)).toEqual(events.map(timeless));
      expect((yield* session.snapshot).state).toBe("ready");
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("runs turns one after another and keeps part ids unique across them", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake();
      const session = yield* connection.newSession();
      const first = yield* run(session.prompt([text("first")]));
      const second = yield* run(session.prompt([text("second")]));
      expect(eventTexts(first)).toEqual(["turn 1: first"]);
      expect(eventTexts(second)).toEqual(["turn 2: second"]);
      const ids = [...first, ...second].flatMap((part) => (part.type === "event" ? [part.event.id] : []));
      expect(new Set(ids).size).toBe(ids.length);
      expect((yield* session.snapshot).turns).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("S39: a session runs one turn at a time and denies permission by default", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake();
      const session = yield* connection.newSession();
      const hanging = yield* run(session.prompt([text("hang")])).pipe(Effect.forkChild);
      yield* untilState(session, "turn");
      const second = yield* Effect.exit(run(session.prompt([text("second")])));
      expect(Exit.isFailure(second) && Exit.findErrorOption(second)).toMatchObject({
        value: { _tag: "TurnInProgress", turn: 1 }
      });
      yield* session.cancel();
      yield* Fiber.join(hanging);
      const parts = yield* run(session.prompt([text("permission")]));
      expect(eventTexts(parts)).toEqual(['permission {"outcome":"selected","optionId":"reject"}']);
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("passes permission requests to the caller and accepts only an option the agent offered", () =>
    Effect.gen(function* () {
      const asked: unknown[] = [];
      const allow = yield* connectFake({
        onPermission: (request) =>
          Effect.sync(() => {
            asked.push(request);
            return optionOfKind(request, "allow_once");
          })
      });
      const allowed = yield* run((yield* allow.newSession()).prompt([text("permission")]));
      expect(eventTexts(allowed)).toEqual(['permission {"outcome":"selected","optionId":"allow"}']);
      expect(asked).toEqual([
        {
          sessionId: "fake-session-1",
          toolCall: {
            callId: "call-p",
            title: "write_file",
            kind: "edit",
            rawInput: { path: "b.txt" }
          },
          options: [
            { optionId: "allow", name: "Allow once", kind: "allow_once" },
            { optionId: "reject", name: "Reject once", kind: "reject_once" }
          ]
        }
      ]);

      const invented = yield* connectFake({
        onPermission: () => Effect.succeed({ optionId: "not-offered" })
      });
      const denied = yield* run((yield* invented.newSession()).prompt([text("permission")]));
      expect(eventTexts(denied)).toEqual(['permission {"outcome":"selected","optionId":"reject"}']);

      const broken = yield* connectFake({ onPermission: () => Effect.die("callback bug") });
      const deniedAgain = yield* run((yield* broken.newSession()).prompt([text("permission")]));
      expect(eventTexts(deniedAgain)).toEqual(['permission {"outcome":"selected","optionId":"reject"}']);
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("puts the system prompt where the profile says and passes MCP servers and _meta through", () =>
    Effect.gen(function* () {
      const mcpServers = [
        {
          name: "tools",
          command: "/opt/tools",
          args: ["--stdio"],
          env: [{ name: "TOKEN", value: "x" }]
        },
        { type: "http" as const, name: "web", url: "http://127.0.0.1:9/mcp", headers: [] }
      ];
      const viaMeta = yield* connectFake({ mcpServers });
      const metaSession = yield* viaMeta.newSession({
        systemPrompt: "be brief",
        meta: { claudeCode: { options: {} } }
      });
      const metaReport = JSON.parse(eventTexts(yield* run(metaSession.prompt([text("inspect")])))[0] ?? "{}");
      expect(metaReport.meta).toEqual({ claudeCode: { options: {} }, systemPrompt: "be brief" });
      expect(metaReport.mcpServers).toEqual(mcpServers);
      expect(metaReport.prompt).toEqual([{ type: "text", text: "inspect" }]);

      const firstBlock = yield* connectFake({ profile: { systemPrompt: { in: "first-block" } } });
      const blockSession = yield* firstBlock.newSession({ systemPrompt: "be brief" });
      const first = JSON.parse(eventTexts(yield* run(blockSession.prompt([text("inspect")])))[0] ?? "{}");
      expect(first.meta).toBeNull();
      expect(first.prompt).toEqual([
        { type: "text", text: "be brief" },
        { type: "text", text: "inspect" }
      ]);
      const second = JSON.parse(eventTexts(yield* run(blockSession.prompt([text("inspect")])))[0] ?? "{}");
      expect(second.prompt).toEqual([{ type: "text", text: "inspect" }]);
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("fails a turn the agent answers with an error and keeps the session usable", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake();
      const session = yield* connection.newSession();
      const failed = yield* Effect.exit(run(session.prompt([text("fail")])));
      expect(Exit.isFailure(failed) && Exit.findErrorOption(failed)).toMatchObject({
        value: { _tag: "AcpRequestFailed", method: "session/prompt" }
      });
      expect(eventTexts(yield* run(session.prompt([text("again")])))).toEqual(["turn 2: again"]);
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("reports a missing login as AuthRequired", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake({ fake: { FAKE_ACP_AUTH: "required" } });
      const exit = yield* Effect.exit(connection.newSession());
      expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
        value: { _tag: "AuthRequired", authMethods: [{ id: "fake-login", name: "Fake login" }] }
      });
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("drains a chatty stderr without an observer", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake({ fake: { FAKE_ACP_NOISY: "1" } });
      const session = yield* connection.newSession();
      expect(eventTexts(yield* run(session.prompt([text("hi")])))).toEqual(["turn 1: hi"]);
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("throws a branded error for an agent without a profile or a timeout out of range", () =>
    Effect.gen(function* () {
      const defectOf = (exit: Exit.Exit<unknown, unknown>) =>
        Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
      const unknown = defectOf(yield* Effect.exit(connectAgent("no-such-agent", { cwd: workDir(), env: {} })));
      expect(isAgentKitError(unknown) && unknown.code).toBe("capability-unsupported");
      const zero = defectOf(yield* Effect.exit(connectFake({ cancelTimeoutMs: 0 })));
      expect(isAgentKitError(zero) && zero.code).toBe("invalid-option");
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );
});

describe("starting and stopping the agent", () => {
  it.effect("S87: a program that cannot start is AgentUnavailable", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(connectFake({ profile: { command: "/no/such/acp-agent", args: [] } }));
      expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
        value: { _tag: "AgentUnavailable", command: "/no/such/acp-agent" }
      });
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("S87: an agent that exits or speaks another protocol version fails the handshake", () =>
    Effect.gen(function* () {
      const exited = yield* Effect.exit(connectFake({ fake: { FAKE_ACP_INITIALIZE: "exit" } }));
      expect(Exit.isFailure(exited) && Exit.findErrorOption(exited)).toMatchObject({
        value: { _tag: "HandshakeFailed", reason: "exited" }
      });
      const version = yield* Effect.exit(connectFake({ fake: { FAKE_ACP_INITIALIZE: "protocol-2" } }));
      expect(Exit.isFailure(version) && Exit.findErrorOption(version)).toMatchObject({
        value: { _tag: "HandshakeFailed", reason: "protocol-version" }
      });
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("S87: the handshake deadline is the handshake timeout, on the Effect clock", () =>
    Effect.gen(function* () {
      const connecting = yield* connectFake({
        fake: { FAKE_ACP_INITIALIZE: "hang" },
        handshakeTimeoutMs: 2_000
      }).pipe(Effect.exit, Effect.forkChild);
      yield* TestClock.adjust(1_999);
      expect(connecting.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust(1);
      const exit = yield* Fiber.join(connecting);
      expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
        value: { _tag: "HandshakeFailed", reason: "timeout" }
      });
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("bounds session/new with the request timeout", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake({
        fake: { FAKE_ACP_NEW: "hang" },
        requestTimeoutMs: 1_000
      });
      const opening = yield* connection.newSession().pipe(Effect.exit, Effect.forkChild);
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)));
      yield* TestClock.adjust(1_000);
      const exit = yield* Fiber.join(opening);
      expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
        value: { _tag: "AcpTimeout", method: "session/new", timeoutMs: 1_000 }
      });
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );
});

describe("probeAgent", () => {
  it.effect("reports ready, needs-login or unavailable from a trial session", () =>
    Effect.gen(function* () {
      const probe = (options: { fake?: Record<string, string>; command?: string }) =>
        probeAgent("fake-agent", {
          cwd: workDir(),
          env: { ...options.fake },
          profiles: {
            "fake-agent": fakeProfile(options.command === undefined ? {} : { command: options.command })
          }
        });
      expect(yield* probe({})).toMatchObject({
        status: "ready",
        agentInfo: { name: "fake-agent", version: "1.2.3" },
        features: { image: true }
      });
      expect(yield* probe({ fake: { FAKE_ACP_AUTH: "required" } })).toEqual({
        status: "needs-login",
        agentInfo: { name: "fake-agent", version: "1.2.3" },
        authMethods: [{ id: "fake-login", name: "Fake login" }]
      });
      expect(yield* probe({ command: "/no/such/acp-agent" })).toMatchObject({
        status: "unavailable",
        error: { _tag: "AgentUnavailable" }
      });
    }).pipe(Effect.provide(TestLive))
  );
});

describe("client file calls", () => {
  it.effect("S85: serve the session directory only, after links are resolved", () =>
    Effect.gen(function* () {
      const base = workDir();
      const root = join(base, "root");
      const outside = join(base, "outside");
      mkdirSync(root);
      mkdirSync(outside);
      writeFileSync(join(root, "inside.txt"), "line 1\nline 2\nline 3");
      writeFileSync(join(outside, "secret.txt"), "nothing to see");
      writeFileSync(join(root, "..notes.md"), "an ordinary name");
      symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
      symlinkSync(join(outside, "missing.txt"), join(root, "dangling.txt"));
      symlinkSync(outside, join(root, "out-dir"));
      mkdirSync(join(root, "sub"));
      const connection = yield* connectFake({ cwd: root, fileSystem: { read: true, write: true } });
      const session = yield* connection.newSession();
      const say = (command: string) =>
        Effect.map(run(session.prompt([text(command)])), (parts) => eventTexts(parts)[0]);
      const outsideOf = /^refused .*outside the session directory/;

      expect(yield* say(`read ${root}/inside.txt`)).toBe("read line 1\nline 2\nline 3");
      expect(yield* say(`read ${root}/inside.txt 2 1`)).toBe("read line 2");
      expect(yield* say(`read ${root}/..notes.md`)).toBe("read an ordinary name");
      expect(yield* say(`read ${outside}/secret.txt`)).toMatch(outsideOf);
      expect(yield* say(`read ${root}/escape.txt`)).toMatch(outsideOf);
      expect(yield* say("read relative.txt")).toMatch(/^refused .*not an absolute path/);
      expect(yield* say(`read ${root}/nothing.txt`)).toMatch(/^refused .*Resource not found/);
      // `..` as sent, resolved the way the file system does: after the links before it.
      expect(yield* say(`read ${root}/sub/../inside.txt`)).toBe("read line 1\nline 2\nline 3");
      expect(yield* say(`read ${root}/sub/../../outside/secret.txt`)).toMatch(outsideOf);
      expect(yield* say(`read ${root}/out-dir/../outside/secret.txt`)).toMatch(outsideOf);
      expect(yield* say(`read ${root}/out-dir/../root/inside.txt`)).toBe("read line 1\nline 2\nline 3");

      expect(yield* say(`write ${root}/sub/new.txt fresh text`)).toBe("wrote");
      expect(readFileSync(join(root, "sub", "new.txt"), "utf8")).toBe("fresh text");
      expect(yield* say(`write ${root}/escape.txt overwrite`)).toMatch(outsideOf);
      expect(yield* say(`write ${root}/dangling.txt create`)).toMatch(/^refused .*link to a file that does not exist/);
      expect(yield* say(`write ${root}/out-dir/new.txt create`)).toMatch(outsideOf);
      expect(yield* say(`write ${root}/out-dir/../outside/new.txt create`)).toMatch(outsideOf);
      expect(yield* say(`write ${root}/missing/../new.txt create`)).toMatch(/^refused .*directory that does not exist/);
      expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("nothing to see");
      expect(existsSync(join(outside, "new.txt"))).toBe(false);
      expect(existsSync(join(root, "new.txt"))).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("are not offered unless asked for", () =>
    Effect.gen(function* () {
      const root = workDir();
      writeFileSync(join(root, "inside.txt"), "text");
      const connection = yield* connectFake({ cwd: root });
      const session = yield* connection.newSession();
      const parts = yield* run(session.prompt([text(`read ${join(root, "inside.txt")}`)]));
      expect(eventTexts(parts)[0]).toMatch(/^refused .*Method not found/);
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );
});

describe("session bindings", () => {
  it.effect("S86: a session bound to a key is loaded on a later connection, without its replay", () =>
    Effect.gen(function* () {
      const state = join(workDir(), "agent-state.json");
      const fake = { FAKE_ACP_LOAD: "load", FAKE_ACP_STATE: state };
      const cwd = workDir();
      const sessionId = yield* Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* connectFake({ fake, cwd });
          const session = yield* connection.newSession({ sessionKey: "chat:1" });
          yield* run(session.prompt([text("hello")]));
          return session.sessionId;
        })
      );
      const store = yield* SessionBindingStore;
      expect(yield* store.get("chat:1")).toEqual({
        sessionKey: "chat:1",
        agent: "fake-agent",
        sessionId,
        cwd
      });

      const connection = yield* connectFake({ fake });
      const loaded = yield* connection.loadSession({ sessionKey: "chat:1" });
      expect(loaded.sessionId).toBe(sessionId);
      const parts = yield* run(loaded.prompt([text("inspect")]));
      expect(eventTexts(parts, "user")).toEqual([]);
      expect(JSON.parse(eventTexts(parts)[0] ?? "{}").cwd).toBe(cwd);
      expect(yield* connection.loadSession({ sessionKey: "chat:1" })).toMatchObject({
        sessionId
      });

      const missing = yield* Effect.exit(connection.loadSession({ sessionKey: "chat:2" }));
      expect(Exit.isFailure(missing) && Exit.findErrorOption(missing)).toMatchObject({
        value: { _tag: "BindingNotFound", sessionKey: "chat:2" }
      });
      const unknown = yield* Effect.exit(connection.loadSession({ sessionId: "never-created" }));
      expect(Exit.isFailure(unknown) && Exit.findErrorOption(unknown)).toMatchObject({
        value: { _tag: "AcpRequestFailed", method: "session/load" }
      });
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("sends one session/load for concurrent loads of a session, which share it", () =>
    Effect.gen(function* () {
      const state = join(workDir(), "agent-state.json");
      const sessionId = yield* Effect.scoped(
        Effect.flatMap(connectFake({ fake: { FAKE_ACP_STATE: state } }), (connection) =>
          Effect.map(connection.newSession(), (session) => session.sessionId)
        )
      );
      const connection = yield* connectFake({
        fake: { FAKE_ACP_LOAD: "load", FAKE_ACP_STATE: state }
      });
      const [first, second] = yield* Effect.all(
        [connection.loadSession({ sessionId }), connection.loadSession({ sessionId })],
        { concurrency: "unbounded" }
      );
      const report = JSON.parse(eventTexts(yield* run(first.prompt([text("inspect")])))[0] ?? "{}");
      expect(report.loads).toBe(1);
      expect((yield* second.snapshot).turns).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.live("fails a load during or after closing the connection with ConnectionClosed instead of waiting", () =>
    Effect.gen(function* () {
      const state = join(workDir(), "agent-state.json");
      const sessionId = yield* Effect.scoped(
        Effect.flatMap(connectFake({ fake: { FAKE_ACP_STATE: state } }), (connection) =>
          Effect.map(connection.newSession(), (session) => session.sessionId)
        )
      );
      const load = (connection: Effect.Success<ReturnType<typeof connectFake>>) =>
        connection.loadSession({ sessionId }).pipe(Effect.flip, Effect.timeoutOption(5_000));

      // The agent ignores SIGTERM, so closing waits for the platform's SIGKILL while the loads run.
      const closing = yield* connectFake({
        fake: { FAKE_ACP_LOAD: "load", FAKE_ACP_STATE: state, FAKE_ACP_IGNORE_SIGTERM: "1" }
      });
      const close = yield* closing.close().pipe(Effect.forkChild);
      yield* Effect.sleep(50);
      expect(yield* load(closing)).toMatchObject({
        value: { _tag: "ConnectionClosed", reason: "closed" }
      });
      expect(yield* load(closing)).toMatchObject({ value: { _tag: "ConnectionClosed" } });
      yield* Fiber.join(close);
      expect(yield* load(closing)).toMatchObject({ value: { _tag: "ConnectionClosed" } });

      const closed = yield* connectFake({
        fake: { FAKE_ACP_LOAD: "load", FAKE_ACP_STATE: state }
      });
      yield* closed.close();
      expect(yield* load(closed)).toMatchObject({
        value: { _tag: "ConnectionClosed", reason: "closed" }
      });
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("binds a key to a session that is already open and returns a handle carrying it", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake({ fake: { FAKE_ACP_LOAD: "load" } });
      const opened = yield* connection.newSession();
      expect(opened.sessionKey).toBeUndefined();
      const keyed = yield* connection.loadSession({
        sessionId: opened.sessionId,
        sessionKey: "chat:9"
      });
      expect(keyed.sessionKey).toBe("chat:9");
      expect(yield* (yield* SessionBindingStore).get("chat:9")).toMatchObject({
        sessionId: opened.sessionId
      });
      expect((yield* connection.loadSession({ sessionKey: "chat:9" })).sessionKey).toBe("chat:9");
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("loads with session/resume when the agent only supports that, and refuses when it supports neither", () =>
    Effect.gen(function* () {
      const state = join(workDir(), "agent-state.json");
      const sessionId = yield* Effect.scoped(
        Effect.flatMap(connectFake({ fake: { FAKE_ACP_STATE: state } }), (connection) =>
          Effect.map(connection.newSession(), (session) => session.sessionId)
        )
      );
      const resuming = yield* connectFake({
        fake: { FAKE_ACP_LOAD: "resume", FAKE_ACP_STATE: state }
      });
      expect((yield* resuming.loadSession({ sessionId })).sessionId).toBe(sessionId);
      const neither = yield* connectFake({ fake: { FAKE_ACP_STATE: state } });
      const refused = yield* Effect.exit(neither.loadSession({ sessionId }));
      expect(Exit.isFailure(refused) && Exit.findErrorOption(refused)).toMatchObject({
        value: { _tag: "LoadUnsupported", sessionId }
      });
    }).pipe(Effect.scoped, Effect.provide(TestLive))
  );

  it.effect("refuses a session key without a binding store and opens the session without one", () =>
    Effect.gen(function* () {
      const connection = yield* connectFake();
      const keyed = yield* Effect.exit(connection.newSession({ sessionKey: "chat:1" }));
      expect(Exit.isFailure(keyed) && Exit.findErrorOption(keyed)).toMatchObject({
        value: { _tag: "SessionBindingStoreFailure", reason: "unavailable" }
      });
      expect((yield* connection.newSession()).sessionId).toMatch(/^fake-session-/);
    }).pipe(Effect.scoped, Effect.provide(NodePlatformLive))
  );
});
