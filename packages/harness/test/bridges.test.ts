import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";

import { readHookEvent } from "../src/domain/lifecycle/adapters/hook-dialects.js";
import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { planInstall } from "../src/application/use-cases/plan-install.js";
import { opencodeInstallAdapter } from "../src/domain/bundle/adapters/opencode/strategies.js";
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

const SPAWN_IMPORT = 'import { spawn } from "node:child_process"';

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

function isOpencodePlugin(value: unknown): value is OpencodePlugin {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "AgentKitHooks") === "function";
}

function isPayloadLog(value: unknown): value is PayloadLog {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "payloads"));
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
  if (artifact === undefined || typeof artifact.content !== "string" || !artifact.content.includes(SPAWN_IMPORT)) {
    throw new Error("opencode bridge did not render a plugin that imports spawn");
  }
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
`
  );
  home.write(
    "bridge.mjs",
    artifact.content.replace(SPAWN_IMPORT, `import { spawn } from ${JSON.stringify(pathToFileURL(fake).href)}`)
  );
  const log = await import(pathToFileURL(fake).href);
  const plugin = await import(pathToFileURL(home.path("bridge.mjs")).href);
  if (!isPayloadLog(log) || !isOpencodePlugin(plugin)) {
    throw new Error("could not evaluate the generated opencode bridge");
  }
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
