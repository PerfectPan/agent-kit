import { builtinInstallAdapters as testInstall } from "./support/providers.js";
import { builtinHookDialects as testHooks } from "./support/providers.js";
import type { SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";

import { readHookEvent } from "../src/domain/lifecycle/adapters/read-hook-event.js";
import { opencodeHookDialect } from "@rivus/agent-kit-provider-opencode/hooks";
import { piHookDialect } from "@rivus/agent-kit-provider-pi/hooks";
import { finishSelectorsOf } from "../src/domain/lifecycle/spi/hook-dialect.js";
import type { HookEventSpec } from "../src/domain/lifecycle/spi/hook-dialect.js";
import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { planInstall } from "../src/application/use-cases/plan-install.js";
import {
  bridgeSource as opencodeBridgeSource,
  opencodeInstallAdapter
} from "@rivus/agent-kit-provider-opencode/install";
import { bridgeSource as piBridgeSource, piInstallAdapter } from "@rivus/agent-kit-provider-pi/install";
import type { BundleSnapshot } from "../src/domain/bundle/value-objects/bundle.js";
import { removeTestHomes, type TestHome, testHome } from "./support/home.js";

afterEach(removeTestHomes);

/** A hook command that appends each payload it gets on stdin, as one line, to `payloads.log` in the home. */
function captureCommand(home: TestHome): string {
  home.command(
    "capture",
    `const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => require("node:fs").appendFileSync(${JSON.stringify(home.path("payloads.log"))}, Buffer.concat(chunks).toString() + "\\n"));`
  );
  return `${home.bin}/capture --agent {agent}`;
}

async function payloads(home: TestHome, count: number): Promise<unknown[]> {
  for (let tries = 0; tries < 100; tries += 1) {
    const lines = (home.read("payloads.log") ?? "").split("\n").filter((line) => line !== "");
    if (lines.length >= count) {
      return lines.map((line) => JSON.parse(line) as unknown);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`expected ${count} payloads, got: ${home.read("payloads.log")}`);
}

const install = (home: TestHome, bundle: BundleSnapshot, agent: "opencode" | "pi") =>
  Effect.runPromise(
    Effect.flatMap(
      planInstall(bundle, {
        agents: [agent],
        providers: { install: testInstall, hooks: testHooks }
      }),
      applyInstall
    ).pipe(Effect.provide(home.layer()))
  );

describe("S109: bridge plugins forward events in the payload shape their HookDialect reads", () => {
  it("opencode: bus events and tool hooks reach the hook command", async () => {
    const home = testHome();
    const command = captureCommand(home);
    await install(
      home,
      {
        owner: "demo-app",
        version: "1",
        digest: "d",
        artifacts: [
          { type: "hooks", command, events: { opencode: ["session.created", "tool.execute.before", "session.idle"] } }
        ]
      },
      "opencode"
    );
    const file = home.path(".config/opencode/plugins/demo-app.js");
    expect(readFileSync(file, "utf8")).toContain(`--agent opencode`);
    const module = (await import(pathToFileURL(file).href)) as Record<
      string,
      (input: object) => Promise<Record<string, (arg: object) => Promise<void>>>
    >;
    expect(Object.values(module).every((value) => typeof value === "function")).toBe(true);
    const hooks = await module.AgentKitHooks!({ directory: "/u/me/work" });
    await hooks.event!({
      event: { type: "session.created", properties: { info: { id: "ses_1", directory: "/u/me/work" } } }
    });
    await hooks.event!({ event: { type: "message.updated", properties: {} } });
    await hooks["tool.execute.before"]!({ tool: "bash", sessionID: "ses_1", callID: "call_1" });
    // Each event spawns the command on its own, so the payloads can arrive in any order.
    const events = (await payloads(home, 2)).map((payload) =>
      readHookEvent("opencode", payload, {}, { providers: { hooks: testHooks } })
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "start", scope: "session", sessionId: "ses_1", cwd: "/u/me/work" }),
        expect.objectContaining({ phase: "activity", sessionId: "ses_1", tool: { name: "bash", callId: "call_1" } })
      ])
    );
  });

  it("Pi: registered events reach the hook command with the session id and cwd from the context", async () => {
    const home = testHome();
    const command = captureCommand(home);
    await install(
      home,
      {
        owner: "demo-app",
        version: "1",
        digest: "d",
        artifacts: [{ type: "hooks", command, events: { pi: ["agent_start", "session_shutdown"] } }]
      },
      "pi"
    );
    const file = home.path(".pi/agent/extensions/demo-app.ts");
    const module = (await import(pathToFileURL(file).href)) as { default: (pi: object) => void };
    const handlers = new Map<string, (event: object, ctx: object) => Promise<void>>();
    module.default({
      on: (name: string, handler: (event: object, ctx: object) => Promise<void>) => handlers.set(name, handler)
    });
    expect([...handlers.keys()].toSorted()).toEqual(["agent_start", "session_shutdown"]);
    const ctx = { cwd: "/u/me/work", sessionManager: { getSessionId: () => "pi-1" } };
    await handlers.get("agent_start")!({ type: "agent_start" }, ctx);
    await handlers.get("session_shutdown")!({ type: "session_shutdown" }, ctx);
    const events = (await payloads(home, 2)).map((payload) =>
      readHookEvent("pi", payload, {}, { providers: { hooks: testHooks } })
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "start", scope: "turn", sessionId: "pi-1", cwd: "/u/me/work" }),
        expect.objectContaining({ phase: "finish", scope: "session", sessionId: "pi-1" })
      ])
    );
  });
});

const SPAWN_IMPORT = 'import { spawn, spawnSync } from "node:child_process"';

/** The child_process stand-in: it records which call delivered each payload, in order. */
const FAKE_SPAWN = `export const payloads = []
export const vias = []
export function spawn() {
  return {
    on() {},
    stdin: { on() {}, end(data) { payloads.push(JSON.parse(String(data))); vias.push("spawn") } }
  }
}
export function spawnSync(_command, options) {
  payloads.push(JSON.parse(String(options.input))); vias.push("spawnSync")
}
`;

interface OpencodePlugin {
  AgentKitHooks(input: { readonly directory: string }): Promise<OpencodeHooks>;
}

interface OpencodeHooks {
  event(input: { readonly event: { readonly type: string; readonly properties?: object } }): Promise<void>;
  "tool.execute.before"(input: object): Promise<void>;
  "tool.execute.after"(input: object): Promise<void>;
}

interface PayloadLog {
  readonly payloads: unknown[];
  /** Which child_process call delivered each payload, parallel to `payloads`. */
  readonly vias: readonly string[];
}

interface ForwardedBridge {
  readonly hooksFor: (directory: string) => Promise<OpencodeHooks>;
  readonly log: PayloadLog;
}

/** An own `sessionID` getter. Reading it throws, which a payload can do. */
function throwingSession(): object {
  const payload = {};
  Object.defineProperty(payload, "sessionID", {
    enumerable: true,
    get() {
      throw new Error("sessionID");
    }
  });
  return payload;
}

/**
 * A generated bridge source written with the child_process import replaced by the fake, so each forwarded payload is
 * kept in order with the call that delivered it.
 */
async function bridgeModule<T>(home: TestHome, source: string, name: string): Promise<{ log: PayloadLog; module: T }> {
  expect(source).toContain(SPAWN_IMPORT);
  const fake = home.path("fake-spawn.mjs");
  home.write("fake-spawn.mjs", FAKE_SPAWN);
  home.write(
    name,
    source.replace(SPAWN_IMPORT, `import { spawn, spawnSync } from ${JSON.stringify(pathToFileURL(fake).href)}`)
  );
  const log = (await import(pathToFileURL(fake).href)) as PayloadLog;
  const module = (await import(pathToFileURL(home.path(name)).href)) as T;
  return { log, module };
}

/** The generated plugin, with spawn replaced so each forwarded payload is kept in order. */
async function forwardedBridge(
  home: TestHome,
  events: readonly string[] = ["session.created", "file.edited", "message.updated", "session.error"]
): Promise<ForwardedBridge> {
  const [artifact] = opencodeInstallAdapter.renderHooks(
    "native-plugin",
    events.map((event) => ({
      event,
      command: "hook",
      agents: ["opencode"]
    })),
    { owner: "demo-app", version: "1", digest: "d" },
    { home: home.home, env: home.env }
  );
  // ArtifactContent is a union; the bridge renders as one file's text.
  if (typeof artifact?.content !== "string") {
    throw new Error("opencode bridge did not render a file");
  }
  const { log, module } = await bridgeModule<OpencodePlugin>(home, artifact.content, "bridge.mjs");
  expect(typeof module.AgentKitHooks).toBe("function");
  return { hooksFor: (directory) => module.AgentKitHooks({ directory }), log };
}

/** The generated Pi extension, with the child_process import replaced like the opencode plugin's. */
async function forwardedPi(
  home: TestHome,
  events: readonly string[]
): Promise<{ handlers: Map<string, (event: object, ctx: object) => Promise<void>>; log: PayloadLog }> {
  const [artifact] = piInstallAdapter.renderHooks(
    "native-plugin",
    events.map((event) => ({ event, command: "hook", agents: ["pi"] })),
    { owner: "demo-app", version: "1", digest: "d" },
    { home: home.home, env: home.env }
  );
  if (typeof artifact?.content !== "string") {
    throw new Error("Pi bridge did not render a file");
  }
  const { log, module } = await bridgeModule<{ default: (pi: object) => void }>(home, artifact.content, "extension.ts");
  const handlers = new Map<string, (event: object, ctx: object) => Promise<void>>();
  module.default({
    on: (name: string, handler: (event: object, ctx: object) => Promise<void>) => handlers.set(name, handler)
  });
  return { handlers, log };
}

/** A Pi handler's outcome: the bridge is fail-open, so a payload that throws while it is read still resolves. */
async function outcomeOf(callback: Promise<void>): Promise<string> {
  try {
    await callback;
    return "resolved";
  } catch (error) {
    return error instanceof Error ? `rejected: ${error.message}` : "rejected";
  }
}

describe("S111: the opencode bridge carries the current session id", () => {
  it("remembers the latest named session for events that name none, per plugin instance", async () => {
    const home = testHome();
    const { hooksFor, log } = await forwardedBridge(home);
    const work = await hooksFor("/u/me/work");
    const other = await hooksFor("/u/me/other");

    await work.event({ event: { type: "file.edited", properties: { file: "/u/me/work/a.ts" } } });
    await work.event({
      event: { type: "session.created", properties: { info: { id: "A", directory: "/u/me/work" } } }
    });
    await work.event({ event: { type: "file.edited", properties: { file: "/u/me/work/a.ts" } } });
    await work.event({
      event: { type: "session.error", properties: { error: { name: "APIError", data: {} } } }
    });
    await work.event({
      event: { type: "message.updated", properties: { info: { id: "msg_1", sessionID: "B" } } }
    });
    await work.event({ event: { type: "file.edited", properties: { file: "/u/me/work/b.ts" } } });
    await other.event({ event: { type: "file.edited", properties: { file: "/u/me/other/c.ts" } } });

    const [before, created, edited, errored, named, after, elsewhere] = log.payloads;
    expect(readHookEvent("opencode", before, {}, { providers: { hooks: testHooks } }).sessionId).toBeUndefined();
    expect(before).not.toHaveProperty("currentSessionId");
    expect(readHookEvent("opencode", created, {}, { providers: { hooks: testHooks } })).toEqual(
      expect.objectContaining({ phase: "start", scope: "session", sessionId: "A", cwd: "/u/me/work" })
    );
    expect(created).toEqual({
      type: "session.created",
      properties: { info: { id: "A", directory: "/u/me/work" } },
      directory: "/u/me/work"
    });
    expect(readHookEvent("opencode", edited, {}, { providers: { hooks: testHooks } }).sessionId).toBe("A");
    expect(edited).toEqual({
      type: "file.edited",
      properties: { file: "/u/me/work/a.ts" },
      directory: "/u/me/work",
      currentSessionId: "A"
    });
    expect(readHookEvent("opencode", errored, {}, { providers: { hooks: testHooks } })).toEqual(
      expect.objectContaining({ phase: "finish", scope: "turn", outcome: "failed", sessionId: "A" })
    );
    expect(readHookEvent("opencode", named, {}, { providers: { hooks: testHooks } }).sessionId).toBe("B");
    expect(named).toEqual({
      type: "message.updated",
      properties: { info: { id: "msg_1", sessionID: "B" } },
      directory: "/u/me/work"
    });
    expect(readHookEvent("opencode", after, {}, { providers: { hooks: testHooks } }).sessionId).toBe("B");
    expect(after).toMatchObject({ currentSessionId: "B" });
    expect(readHookEvent("opencode", elsewhere, {}, { providers: { hooks: testHooks } }).sessionId).toBeUndefined();
    expect(elsewhere).not.toHaveProperty("currentSessionId");
  });

  it("resolves when an event or a tool input has a sessionID getter that throws", async () => {
    const home = testHome();
    const { hooksFor } = await forwardedBridge(home, ["session.error", "tool.execute.before"]);
    const work = await hooksFor("/u/me/work");

    const settled = async (callback: Promise<void>): Promise<string> => {
      try {
        await callback;
        return "resolved";
      } catch (error) {
        return error instanceof Error ? error.message : "rejected";
      }
    };
    expect([
      await settled(work.event({ event: { type: "session.error", properties: throwingSession() } })),
      await settled(work["tool.execute.before"](throwingSession()))
    ]).toEqual(["resolved", "resolved"]);
  });

  it("lets an unregistered message.updated replace the remembered session", async () => {
    const home = testHome();
    const { hooksFor, log } = await forwardedBridge(home, ["session.created", "file.edited"]);
    const work = await hooksFor("/u/me/work");

    await work.event({
      event: { type: "session.created", properties: { info: { id: "A", directory: "/u/me/work" } } }
    });
    await work.event({
      event: { type: "message.updated", properties: { info: { id: "msg_1", sessionID: "B" } } }
    });
    await work.event({ event: { type: "file.edited", properties: { file: "/u/me/work/a.ts" } } });

    const [created, edited] = log.payloads;
    expect(log.payloads).toHaveLength(2);
    expect(readHookEvent("opencode", created, {}, { providers: { hooks: testHooks } }).sessionId).toBe("A");
    expect(created).not.toHaveProperty("currentSessionId");
    expect(readHookEvent("opencode", edited, {}, { providers: { hooks: testHooks } }).sessionId).toBe("B");
    expect(edited).toMatchObject({ type: "file.edited", currentSessionId: "B" });
  });

  it("seeds the remembered session from a session.created it does not forward", async () => {
    const home = testHome();
    const { hooksFor, log } = await forwardedBridge(home, ["file.edited"]);
    const work = await hooksFor("/u/me/work");

    await work.event({
      event: { type: "session.created", properties: { info: { id: "A", directory: "/u/me/work" } } }
    });
    await work.event({ event: { type: "file.edited", properties: { file: "/u/me/work/a.ts" } } });

    expect(log.payloads).toHaveLength(1);
    const [edited] = log.payloads;
    expect(readHookEvent("opencode", edited, {}, { providers: { hooks: testHooks } }).sessionId).toBe("A");
    expect(edited).toMatchObject({ type: "file.edited", currentSessionId: "A" });
  });

  it("remembers a session named by a tool input it does not forward", async () => {
    const home = testHome();
    const { hooksFor, log } = await forwardedBridge(home, ["file.edited"]);
    const work = await hooksFor("/u/me/work");

    await work["tool.execute.before"]({ tool: "read", sessionID: "C", callID: "c1" });
    await work.event({ event: { type: "file.edited", properties: { file: "/u/me/work/a.ts" } } });

    expect(log.payloads).toHaveLength(1);
    const [edited] = log.payloads;
    expect(readHookEvent("opencode", edited, {}, { providers: { hooks: testHooks } }).sessionId).toBe("C");
    expect(edited).toMatchObject({ currentSessionId: "C" });
  });
});

describe("S113: the opencode bridge remembers only session ids and forgets a deleted session", () => {
  it("never takes a terminal's info.id from pty events as the session", async () => {
    const home = testHome();
    const { hooksFor, log } = await forwardedBridge(home, ["file.edited", "session.error"]);
    const work = await hooksFor("/u/me/work");

    await work["tool.execute.before"]({ tool: "bash", sessionID: "ses_A", callID: "c1" });
    await work.event({ event: { type: "pty.created", properties: { info: { id: "pty_456", cwd: "/u/me/work" } } } });
    await work.event({ event: { type: "pty.updated", properties: { info: { id: "pty_123" } } } });
    await work.event({ event: { type: "file.edited", properties: { file: "/u/me/work/a.ts" } } });
    await work.event({ event: { type: "session.error", properties: { error: { name: "APIError", data: {} } } } });

    expect(log.payloads).toHaveLength(2);
    const [edited, errored] = log.payloads;
    expect(edited).toMatchObject({ type: "file.edited", currentSessionId: "ses_A" });
    expect(readHookEvent("opencode", edited, {}, { providers: { hooks: testHooks } }).sessionId).toBe("ses_A");
    expect(readHookEvent("opencode", errored, {}, { providers: { hooks: testHooks } })).toEqual(
      expect.objectContaining({ phase: "finish", outcome: "failed", sessionId: "ses_A" })
    );
  });

  it("takes the session from the Session info of session events", async () => {
    const home = testHome();
    const { hooksFor, log } = await forwardedBridge(home, ["file.edited"]);
    const work = await hooksFor("/u/me/work");

    await work["tool.execute.before"]({ tool: "bash", sessionID: "ses_A", callID: "c1" });
    await work.event({
      event: { type: "session.updated", properties: { info: { id: "ses_B", directory: "/u/me/work" } } }
    });
    await work.event({ event: { type: "file.edited", properties: { file: "/u/me/work/a.ts" } } });

    const [edited] = log.payloads;
    expect(readHookEvent("opencode", edited, {}, { providers: { hooks: testHooks } }).sessionId).toBe("ses_B");
  });

  it("forgets the remembered session when it is deleted, and keeps it when another one is", async () => {
    const home = testHome();
    const { hooksFor, log } = await forwardedBridge(home, ["file.edited", "session.deleted"]);
    const work = await hooksFor("/u/me/work");
    const created = (id: string) =>
      work.event({ event: { type: "session.created", properties: { sessionID: id, info: { id } } } });
    const deleted = (id: string) =>
      work.event({ event: { type: "session.deleted", properties: { sessionID: id, info: { id } } } });
    const edit = () => work.event({ event: { type: "file.edited", properties: { file: "/u/me/work/a.ts" } } });

    await created("A");
    await created("B");
    await deleted("A");
    await edit();
    await deleted("B");
    await edit();

    const [deletedA, editedB, deletedB, editedNone] = log.payloads;
    expect(readHookEvent("opencode", deletedA, {}, { providers: { hooks: testHooks } })).toEqual(
      expect.objectContaining({ phase: "finish", scope: "session", sessionId: "A" })
    );
    expect(readHookEvent("opencode", editedB, {}, { providers: { hooks: testHooks } }).sessionId).toBe("B");
    expect(readHookEvent("opencode", deletedB, {}, { providers: { hooks: testHooks } })).toEqual(
      expect.objectContaining({ phase: "finish", scope: "session", sessionId: "B" })
    );
    expect(editedNone).not.toHaveProperty("currentSessionId");
    expect(readHookEvent("opencode", editedNone, {}, { providers: { hooks: testHooks } }).sessionId).toBeUndefined();
  });
});

describe("S115: bridges deliver the dialect's finish events before the next event", () => {
  /**
   * A hook command that appends each payload it gets on stdin to `payloads.log`; the finish event's payload is
   * appended only after a delay, before the command exits, so an asynchronous send loses the ordering.
   */
  function orderCommand(home: TestHome, finish: string): string {
    home.command(
      "order",
      `const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const payload = Buffer.concat(chunks).toString();
  const record = () => require("node:fs").appendFileSync(${JSON.stringify(home.path("payloads.log"))}, payload + "\\n");
  if (JSON.parse(payload).type === ${JSON.stringify(finish)}) {
    setTimeout(record, 400);
  } else {
    record();
  }
});`
    );
    return `${home.bin}/order --agent {agent}`;
  }

  /** Records native spawn results: a PID and ETIMEDOUT prove a child was killed without racing its first instruction. */
  async function timeoutBridgeModule<T>(
    home: TestHome,
    source: string,
    name: string
  ): Promise<{ module: T; results: SpawnSyncReturns<Buffer>[] }> {
    expect(source).toContain(SPAWN_IMPORT);
    home.write(
      "record-spawn.mjs",
      `import { spawnSync as nativeSpawnSync } from "node:child_process"
export { spawn } from "node:child_process"
export const results = []
export function spawnSync(command, options) {
  const result = nativeSpawnSync(command, options)
  results.push(result)
  return result
}
`
    );
    const recorder = pathToFileURL(home.path("record-spawn.mjs")).href;
    home.write(
      name,
      source
        .replace("timeout: 5000", "timeout: 300")
        .replace(SPAWN_IMPORT, `import { spawn, spawnSync } from ${JSON.stringify(recorder)}`)
    );
    const { results } = (await import(recorder)) as { results: SpawnSyncReturns<Buffer>[] };
    const module = (await import(pathToFileURL(home.path(name)).href)) as T;
    return { module, results };
  }

  it("opencode: a finish event reaches the command before a start event that follows it", async () => {
    const home = testHome();
    await install(
      home,
      {
        owner: "demo-app",
        version: "1",
        digest: "d",
        artifacts: [
          {
            type: "hooks",
            command: orderCommand(home, "session.idle"),
            events: { opencode: ["session.idle", "session.created"] }
          }
        ]
      },
      "opencode"
    );
    const file = home.path(".config/opencode/plugins/demo-app.js");
    const module = (await import(pathToFileURL(file).href)) as Record<
      string,
      (input: object) => Promise<Record<string, (arg: object) => Promise<void>>>
    >;
    const hooks = await module.AgentKitHooks!({ directory: "/u/me/work" });
    await hooks.event!({ event: { type: "session.idle", properties: {} } });
    await hooks.event!({ event: { type: "session.created", properties: { info: { id: "ses_1" } } } });
    const events = await payloads(home, 2);
    expect(
      events.map((payload) => readHookEvent("opencode", payload, {}, { providers: { hooks: testHooks } }).nativeEvent)
    ).toEqual(["session.idle", "session.created"]);
  });

  it("Pi: agent_end reaches the command before a session_start that follows it", async () => {
    const home = testHome();
    await install(
      home,
      {
        owner: "demo-app",
        version: "1",
        digest: "d",
        artifacts: [
          {
            type: "hooks",
            command: orderCommand(home, "agent_end"),
            events: { pi: ["agent_end", "session_start"] }
          }
        ]
      },
      "pi"
    );
    const file = home.path(".pi/agent/extensions/demo-app.ts");
    const module = (await import(pathToFileURL(file).href)) as { default: (pi: object) => void };
    const handlers = new Map<string, (event: object, ctx: object) => Promise<void>>();
    module.default({
      on: (name: string, handler: (event: object, ctx: object) => Promise<void>) => handlers.set(name, handler)
    });
    const ctx = { cwd: "/u/me/work", sessionManager: { getSessionId: () => "pi-1" } };
    await handlers.get("agent_end")!({ type: "agent_end" }, ctx);
    await handlers.get("session_start")!({ type: "session_start" }, ctx);
    const events = await payloads(home, 2);
    expect(
      events.map((payload) => readHookEvent("pi", payload, {}, { providers: { hooks: testHooks } }).nativeEvent)
    ).toEqual(["agent_end", "session_start"]);
  });

  it("derives each event's finish selector from its dialect, every spelling included", () => {
    expect(finishSelectorsOf(piHookDialect.events)).toEqual({
      agent_end: null,
      agent_settled: null,
      session_shutdown: null
    });
    expect(finishSelectorsOf(opencodeHookDialect.events)).toEqual({
      "session.deleted": null,
      "session.error": null,
      "session.idle": null,
      // The switch is finish only for the field value its `idle` case maps; busy and retry keep the async send.
      "session.status": { path: ["properties", "status", "type"], values: ["idle"] }
    });
  });

  it("follows the dialect: finish events, aliases, finish cases and a finish otherwise join, a demoted one leaves", () => {
    const events: Record<string, HookEventSpec> = structuredClone(piHookDialect.events);
    events.turn_end = { lifecycle: { phase: "finish", scope: "turn" } };
    events.session_shutdown = { ...events.session_shutdown!, aliases: ["shutdown"] };
    events.agent_end = { lifecycle: { phase: "activity" } };
    // A switch whose `otherwise` is finish: a missing field or a value outside the cases stays finish.
    events.agent_settled = {
      lifecycle: {
        field: ["reason"],
        cases: { busy: { phase: "start" } },
        otherwise: { phase: "finish", scope: "turn" }
      }
    };
    // A switch with one finish case and a non-finish `otherwise`: only that case value is finish.
    events.ui_prompt_start = {
      lifecycle: {
        field: ["phase"],
        cases: { open: { phase: "start" }, close: { phase: "finish", scope: "turn" } },
        otherwise: { phase: "unknown" }
      }
    };
    expect(finishSelectorsOf(events)).toEqual({
      turn_end: null,
      session_shutdown: null,
      shutdown: null,
      agent_settled: { path: ["reason"], values: [], others: ["busy"], otherwise: true },
      ui_prompt_start: { path: ["phase"], values: ["close"] }
    });
  });

  it("hands the derived finish selectors to both generated bridges, whose shipped source pins the 5 s timeout", () => {
    const home = testHome();
    const context = { home: home.home, env: home.env };
    const registrations = (agent: "opencode" | "pi", events: readonly string[]) =>
      events.map((event) => ({ event, command: "hook", agents: [agent] }));
    const finishOf = (content: string): Record<string, unknown> => {
      const match = /^const FINISH = (\{.*\})$/m.exec(content);
      if (match === null) {
        throw new Error("the generated bridge has no FINISH record");
      }
      return JSON.parse(match[1]!) as Record<string, unknown>;
    };
    const [opencode] = opencodeInstallAdapter.renderHooks(
      "native-plugin",
      registrations("opencode", ["session.idle", "file.edited"]),
      { owner: "demo-app", version: "1", digest: "d" },
      context
    );
    const [pi] = piInstallAdapter.renderHooks(
      "native-plugin",
      registrations("pi", ["agent_end", "turn_start"]),
      { owner: "demo-app", version: "1", digest: "d" },
      context
    );
    if (typeof opencode?.content !== "string" || typeof pi?.content !== "string") {
      throw new Error("the bridges did not render files");
    }
    expect(finishOf(opencode.content)).toEqual(finishSelectorsOf(opencodeHookDialect.events));
    expect(finishOf(pi.content)).toEqual(finishSelectorsOf(piHookDialect.events));
    expect(opencode.content).toContain("timeout: 5000");
    expect(pi.content).toContain("timeout: 5000");
  });

  it("opencode: a switch event forwards busy and retry asynchronously and idle synchronously", async () => {
    const home = testHome();
    const { hooksFor, log } = await forwardedBridge(home, ["session.status", "file.edited"]);
    const work = await hooksFor("/u/me/work");
    await work.event({ event: { type: "file.edited", properties: {} } });
    await work.event({ event: { type: "session.status", properties: { status: { type: "idle" } } } });
    await work.event({ event: { type: "session.status", properties: { status: { type: "busy" } } } });
    await work.event({ event: { type: "session.status", properties: { status: { type: "retry" } } } });
    // A payload without the switch field reads as the `otherwise` mapping, which is not finish here.
    await work.event({ event: { type: "session.status", properties: {} } });
    expect(log.vias).toEqual(["spawn", "spawnSync", "spawn", "spawn", "spawn"]);
    expect(
      log.payloads.map(
        (payload) => readHookEvent("opencode", payload, {}, { providers: { hooks: testHooks } }).nativeEvent
      )
    ).toEqual(["file.edited", "session.status", "session.status", "session.status", "session.status"]);
  });

  it("Pi: forwards a non-finish event asynchronously and a finish one synchronously", async () => {
    const home = testHome();
    const { handlers, log } = await forwardedPi(home, ["agent_end", "session_start"]);
    const ctx = { cwd: "/u/me/work", sessionManager: { getSessionId: () => "pi-1" } };
    await handlers.get("session_start")!({ type: "session_start" }, ctx);
    await handlers.get("agent_end")!({ type: "agent_end" }, ctx);
    expect(log.vias).toEqual(["spawn", "spawnSync"]);
  });

  it("Pi: a payload that throws while the handler builds it still resolves the handler", async () => {
    const home = testHome();
    // A synthetic switch selector, as the built-in Pi dialect has none: any field read must stay fail-open too.
    const source = piBridgeSource("demo-app", "hook", ["poll_end"], {
      poll_end: { path: ["result"], values: [], others: ["ok"], otherwise: true }
    });
    const { log, module } = await bridgeModule<{ default: (pi: object) => void }>(home, source, "extension.ts");
    const handlers = new Map<string, (event: object, ctx: object) => Promise<void>>();
    module.default({
      on: (name: string, handler: (event: object, ctx: object) => Promise<void>) => handlers.set(name, handler)
    });
    const throwingResult = {};
    Object.defineProperty(throwingResult, "result", {
      enumerable: true,
      get() {
        throw new Error("result");
      }
    });
    const outcome = await outcomeOf(handlers.get("poll_end")!(throwingResult, { cwd: "/u/me/work" }));
    expect(outcome).toBe("resolved");
    expect(log.payloads).toEqual([]);
  });

  it("opencode: an otherwise-finish switch is synchronous off its listed values, async on them", async () => {
    const home = testHome();
    const source = opencodeBridgeSource("demo-app", "hook", ["poll_end"], {
      poll_end: { path: ["properties", "result"], values: ["done"], others: ["ok"], otherwise: true }
    });
    const { log, module } = await bridgeModule<OpencodePlugin>(home, source, "bridge.mjs");
    const work = await module.AgentKitHooks({ directory: "/u/me/work" });
    // A listed non-finish case value keeps the asynchronous spawn; anything else reads as the finish `otherwise`.
    await work.event({ event: { type: "poll_end", properties: { result: "ok" } } });
    await work.event({ event: { type: "poll_end", properties: { result: "done" } } });
    await work.event({ event: { type: "poll_end", properties: { result: "weird" } } });
    await work.event({ event: { type: "poll_end", properties: {} } });
    expect(log.vias).toEqual(["spawn", "spawnSync", "spawnSync", "spawnSync"]);
  });

  it("Pi: an otherwise-finish switch is synchronous off its listed values, async on them", async () => {
    const home = testHome();
    const source = piBridgeSource("demo-app", "hook", ["poll_end"], {
      poll_end: { path: ["result"], values: ["done"], others: ["ok"], otherwise: true }
    });
    const { log, module } = await bridgeModule<{ default: (pi: object) => void }>(home, source, "extension.ts");
    const handlers = new Map<string, (event: object, ctx: object) => Promise<void>>();
    module.default({
      on: (name: string, handler: (event: object, ctx: object) => Promise<void>) => handlers.set(name, handler)
    });
    const ctx = { cwd: "/u/me/work", sessionManager: { getSessionId: () => "pi-1" } };
    await handlers.get("poll_end")!({ type: "poll_end", result: "ok" }, ctx);
    await handlers.get("poll_end")!({ type: "poll_end", result: "done" }, ctx);
    await handlers.get("poll_end")!({ type: "poll_end", result: "weird" }, ctx);
    await handlers.get("poll_end")!({ type: "poll_end" }, ctx);
    expect(log.vias).toEqual(["spawn", "spawnSync", "spawnSync", "spawnSync"]);
  });

  it("opencode: a synchronous send whose command exits non-zero still resolves the callback", async () => {
    const home = testHome();
    // A command that cannot start takes the same path: under `shell: true` the shell exits 127.
    home.command("exit3", 'process.stdin.resume(); process.stdin.on("end", () => process.exit(3));');
    await install(
      home,
      {
        owner: "demo-app",
        version: "1",
        digest: "d",
        artifacts: [
          { type: "hooks", command: `${home.bin}/exit3 --agent {agent}`, events: { opencode: ["session.idle"] } }
        ]
      },
      "opencode"
    );
    const module = (await import(pathToFileURL(home.path(".config/opencode/plugins/demo-app.js")).href)) as Record<
      string,
      (input: object) => Promise<Record<string, (arg: object) => Promise<void>>>
    >;
    const hooks = await module.AgentKitHooks!({ directory: "/u/me/work" });
    const outcome = await hooks.event!({ event: { type: "session.idle", properties: {} } }).then(
      () => "resolved",
      (error: unknown) => `rejected: ${String(error)}`
    );
    expect(outcome).toBe("resolved");
  });

  it("opencode: the send's timeout cuts off a finish command that never exits", async () => {
    const home = testHome();
    await install(
      home,
      {
        owner: "demo-app",
        version: "1",
        digest: "d",
        artifacts: [{ type: "hooks", command: "sleep 9", events: { opencode: ["session.idle"] } }]
      },
      "opencode"
    );
    const source = home.read(".config/opencode/plugins/demo-app.js");
    if (source === undefined) {
      throw new Error("the opencode bridge was not installed");
    }
    const { module, results } = await timeoutBridgeModule<OpencodePlugin>(
      home,
      source,
      ".config/opencode/plugins/demo-app-short.js"
    );
    const hooks = await module.AgentKitHooks!({ directory: "/u/me/work" });
    const outcome = await hooks.event!({ event: { type: "session.idle", properties: {} } }).then(
      () => "resolved",
      (error: unknown) => `rejected: ${String(error)}`
    );
    expect(outcome).toBe("resolved");
    expect(results).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({ code: "ETIMEDOUT" }),
        status: null,
        signal: "SIGTERM"
      })
    ]);
    expect(results[0]!.pid).toBeGreaterThan(0);
  }, 3000);

  it("Pi: a synchronous send whose command exits non-zero still resolves the callback", async () => {
    const home = testHome();
    // A command that cannot start takes the same path: under `shell: true` the shell exits 127.
    home.command("exit3", 'process.stdin.resume(); process.stdin.on("end", () => process.exit(3));');
    await install(
      home,
      {
        owner: "demo-app",
        version: "1",
        digest: "d",
        artifacts: [{ type: "hooks", command: `${home.bin}/exit3 --agent {agent}`, events: { pi: ["agent_end"] } }]
      },
      "pi"
    );
    const module = (await import(pathToFileURL(home.path(".pi/agent/extensions/demo-app.ts")).href)) as {
      default: (pi: object) => void;
    };
    const handlers = new Map<string, (event: object, ctx: object) => Promise<void>>();
    module.default({
      on: (type: string, handler: (event: object, ctx: object) => Promise<void>) => handlers.set(type, handler)
    });
    const outcome = await handlers.get("agent_end")!({ type: "agent_end" }, { cwd: "/u/me/work" }).then(
      () => "resolved",
      (error: unknown) => `rejected: ${String(error)}`
    );
    expect(outcome).toBe("resolved");
  });

  it("Pi: the send's timeout cuts off a finish command that never exits", async () => {
    const home = testHome();
    await install(
      home,
      {
        owner: "demo-app",
        version: "1",
        digest: "d",
        artifacts: [{ type: "hooks", command: "sleep 9", events: { pi: ["agent_end"] } }]
      },
      "pi"
    );
    const source = home.read(".pi/agent/extensions/demo-app.ts");
    if (source === undefined) {
      throw new Error("the Pi bridge was not installed");
    }
    const { module, results } = await timeoutBridgeModule<{
      default: (pi: object) => void;
    }>(home, source, ".pi/agent/extensions/demo-app-short.ts");
    const handlers = new Map<string, (event: object, ctx: object) => Promise<void>>();
    module.default({
      on: (type: string, handler: (event: object, ctx: object) => Promise<void>) => handlers.set(type, handler)
    });
    const outcome = await handlers.get("agent_end")!({ type: "agent_end" }, { cwd: "/u/me/work" }).then(
      () => "resolved",
      (error: unknown) => `rejected: ${String(error)}`
    );
    expect(outcome).toBe("resolved");
    expect(results).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({ code: "ETIMEDOUT" }),
        status: null,
        signal: "SIGTERM"
      })
    ]);
    expect(results[0]!.pid).toBeGreaterThan(0);
  }, 3000);
});
