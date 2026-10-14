import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";

import { readHookEvent } from "../src/domain/lifecycle/adapters/hook-dialects.js";
import { opencodeHookDialect } from "../src/domain/lifecycle/adapters/opencode.js";
import { piHookDialect } from "../src/domain/lifecycle/adapters/pi.js";
import { finishEventsOf } from "../src/domain/lifecycle/index.js";
import type { HookEventSpec } from "../src/domain/lifecycle/index.js";
import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { planInstall } from "../src/application/use-cases/plan-install.js";
import { opencodeInstallAdapter } from "../src/domain/bundle/adapters/opencode/strategies.js";
import { piInstallAdapter } from "../src/domain/bundle/adapters/pi/strategies.js";
import type { Bundle } from "../src/domain/bundle/index.js";
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

const install = (home: TestHome, bundle: Bundle, agent: "opencode" | "pi") =>
  Effect.runPromise(
    Effect.flatMap(planInstall(bundle, { agents: [agent] }), applyInstall).pipe(Effect.provide(home.layer()))
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
    const events = (await payloads(home, 2)).map((payload) => readHookEvent("opencode", payload, {}));
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
    const events = (await payloads(home, 2)).map((payload) => readHookEvent("pi", payload, {}));
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "start", scope: "turn", sessionId: "pi-1", cwd: "/u/me/work" }),
        expect.objectContaining({ phase: "finish", scope: "session", sessionId: "pi-1" })
      ])
    );
  });
});

const SPAWN_IMPORT = 'import { spawn, spawnSync } from "node:child_process"';

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
  expect(artifact.content).toContain(SPAWN_IMPORT);
  const fake = home.path("fake-spawn.mjs");
  home.write(
    "fake-spawn.mjs",
    `export const payloads = []
export function spawn() {
  return {
    on() {},
    stdin: { on() {}, end(data) { payloads.push(JSON.parse(String(data))) } }
  }
}
export function spawnSync(_command, options) {
  payloads.push(JSON.parse(String(options.input)))
}
`
  );
  home.write(
    "bridge.mjs",
    artifact.content.replace(
      SPAWN_IMPORT,
      `import { spawn, spawnSync } from ${JSON.stringify(pathToFileURL(fake).href)}`
    )
  );
  const log = (await import(pathToFileURL(fake).href)) as PayloadLog;
  const plugin = (await import(pathToFileURL(home.path("bridge.mjs")).href)) as OpencodePlugin;
  expect(typeof plugin.AgentKitHooks).toBe("function");
  return { hooksFor: (directory) => plugin.AgentKitHooks({ directory }), log };
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
    expect(readHookEvent("opencode", before, {}).sessionId).toBeUndefined();
    expect(before).not.toHaveProperty("currentSessionId");
    expect(readHookEvent("opencode", created, {})).toEqual(
      expect.objectContaining({ phase: "start", scope: "session", sessionId: "A", cwd: "/u/me/work" })
    );
    expect(created).toEqual({
      type: "session.created",
      properties: { info: { id: "A", directory: "/u/me/work" } },
      directory: "/u/me/work"
    });
    expect(readHookEvent("opencode", edited, {}).sessionId).toBe("A");
    expect(edited).toEqual({
      type: "file.edited",
      properties: { file: "/u/me/work/a.ts" },
      directory: "/u/me/work",
      currentSessionId: "A"
    });
    expect(readHookEvent("opencode", errored, {})).toEqual(
      expect.objectContaining({ phase: "finish", scope: "turn", outcome: "failed", sessionId: "A" })
    );
    expect(readHookEvent("opencode", named, {}).sessionId).toBe("B");
    expect(named).toEqual({
      type: "message.updated",
      properties: { info: { id: "msg_1", sessionID: "B" } },
      directory: "/u/me/work"
    });
    expect(readHookEvent("opencode", after, {}).sessionId).toBe("B");
    expect(after).toMatchObject({ currentSessionId: "B" });
    expect(readHookEvent("opencode", elsewhere, {}).sessionId).toBeUndefined();
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
    expect(readHookEvent("opencode", created, {}).sessionId).toBe("A");
    expect(created).not.toHaveProperty("currentSessionId");
    expect(readHookEvent("opencode", edited, {}).sessionId).toBe("B");
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
    expect(readHookEvent("opencode", edited, {}).sessionId).toBe("A");
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
    expect(readHookEvent("opencode", edited, {}).sessionId).toBe("C");
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
    expect(readHookEvent("opencode", edited, {}).sessionId).toBe("ses_A");
    expect(readHookEvent("opencode", errored, {})).toEqual(
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
    expect(readHookEvent("opencode", edited, {}).sessionId).toBe("ses_B");
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
    expect(readHookEvent("opencode", deletedA, {})).toEqual(
      expect.objectContaining({ phase: "finish", scope: "session", sessionId: "A" })
    );
    expect(readHookEvent("opencode", editedB, {}).sessionId).toBe("B");
    expect(readHookEvent("opencode", deletedB, {})).toEqual(
      expect.objectContaining({ phase: "finish", scope: "session", sessionId: "B" })
    );
    expect(editedNone).not.toHaveProperty("currentSessionId");
    expect(readHookEvent("opencode", editedNone, {}).sessionId).toBeUndefined();
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
    expect(events.map((payload) => readHookEvent("opencode", payload, {}).nativeEvent)).toEqual([
      "session.idle",
      "session.created"
    ]);
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
    expect(events.map((payload) => readHookEvent("pi", payload, {}).nativeEvent)).toEqual([
      "agent_end",
      "session_start"
    ]);
  });

  it("derives the synchronous set from each dialect's finish phases, every spelling included", () => {
    expect(finishEventsOf(piHookDialect.events)).toEqual(["agent_end", "agent_settled", "session_shutdown"]);
    expect(finishEventsOf(opencodeHookDialect.events)).toEqual([
      "session.deleted",
      "session.error",
      "session.idle",
      "session.status"
    ]);
  });

  it("follows the dialect: a finish event, an alias of one and a finish case join, a demoted one leaves", () => {
    const events: Record<string, HookEventSpec> = structuredClone(piHookDialect.events);
    events.turn_end = { lifecycle: { phase: "finish", scope: "turn" } };
    events.session_shutdown = { ...events.session_shutdown!, aliases: ["shutdown"] };
    events.agent_end = { lifecycle: { phase: "activity" } };
    // A switch counts too, here through its `otherwise`; session.status's finish case covers the `cases` side.
    events.agent_settled = {
      lifecycle: {
        field: ["reason"],
        cases: { busy: { phase: "start" } },
        otherwise: { phase: "finish", scope: "turn" }
      }
    };
    expect(finishEventsOf(events)).toEqual(["agent_settled", "session_shutdown", "shutdown", "turn_end"]);
  });

  it("hands the derived set to both generated bridges as their synchronous events", () => {
    const home = testHome();
    const context = { home: home.home, env: home.env };
    const registrations = (agent: "opencode" | "pi", events: readonly string[]) =>
      events.map((event) => ({ event, command: "hook", agents: [agent] }));
    const syncOf = (content: string): readonly string[] => {
      const match = /const SYNC = new Set\((\[[^\]]*\])\)/.exec(content);
      if (match === null) {
        throw new Error("the generated bridge has no SYNC set");
      }
      return JSON.parse(match[1]!) as readonly string[];
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
    expect(syncOf(opencode.content)).toEqual(finishEventsOf(opencodeHookDialect.events));
    expect(syncOf(pi.content)).toEqual(finishEventsOf(piHookDialect.events));
  });

  it("opencode: a synchronous send that cannot start, fails or times out still resolves the callback", async () => {
    const home = testHome();
    home.command("exit3", 'process.stdin.resume(); process.stdin.on("end", () => process.exit(3));');
    home.command("slow", "process.stdin.resume(); setTimeout(() => process.exit(0), 6000);");
    const commands: readonly string[] = [
      `${home.bin}/missing-command --agent {agent}`,
      `${home.bin}/exit3 --agent {agent}`,
      `${home.bin}/slow --agent {agent}`
    ];
    let owner = 0;
    for (const command of commands) {
      const name = `demo-${(owner += 1)}`;
      await install(
        home,
        {
          owner: name,
          version: "1",
          digest: "d",
          artifacts: [{ type: "hooks", command, events: { opencode: ["session.idle"] } }]
        },
        "opencode"
      );
      const module = (await import(pathToFileURL(home.path(`.config/opencode/plugins/${name}.js`)).href)) as Record<
        string,
        (input: object) => Promise<Record<string, (arg: object) => Promise<void>>>
      >;
      const hooks = await module.AgentKitHooks!({ directory: "/u/me/work" });
      const outcome = await hooks.event!({ event: { type: "session.idle", properties: {} } }).then(
        () => "resolved",
        (error: unknown) => `rejected: ${String(error)}`
      );
      expect(outcome).toBe("resolved");
    }
  }, 20000);

  it("Pi: a synchronous send that cannot start, fails or times out still resolves the callback", async () => {
    const home = testHome();
    home.command("exit3", 'process.stdin.resume(); process.stdin.on("end", () => process.exit(3));');
    home.command("slow", "process.stdin.resume(); setTimeout(() => process.exit(0), 6000);");
    const commands: readonly string[] = [
      `${home.bin}/missing-command --agent {agent}`,
      `${home.bin}/exit3 --agent {agent}`,
      `${home.bin}/slow --agent {agent}`
    ];
    let owner = 0;
    for (const command of commands) {
      const name = `demo-${(owner += 1)}`;
      await install(
        home,
        {
          owner: name,
          version: "1",
          digest: "d",
          artifacts: [{ type: "hooks", command, events: { pi: ["agent_end"] } }]
        },
        "pi"
      );
      const module = (await import(pathToFileURL(home.path(`.pi/agent/extensions/${name}.ts`)).href)) as {
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
    }
  }, 20000);
});
