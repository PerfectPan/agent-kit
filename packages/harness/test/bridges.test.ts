import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";

import { readHookEvent } from "../src/domain/adapters/hook-dialects.js";
import { applyInstall } from "../src/application/use-cases/apply-install.js";
import { planInstall } from "../src/application/use-cases/plan-install.js";
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
