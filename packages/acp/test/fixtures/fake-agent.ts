// A small ACP agent for tests, speaking ACP through the SDK over stdio. The first word of a prompt's text picks what
// a turn does; FAKE_ACP_* variables pick how the process behaves. Node runs this file directly (type stripping), so it
// uses only erasable TypeScript.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";

interface FakeSession {
  readonly cwd: string;
  readonly meta: unknown;
  readonly mcpServers: unknown;
  turns: number;
  cancel?: () => void;
  /** A cancel that arrived before its prompt's handler ran; the SDK may dispatch the two in either order. */
  cancelEarly?: boolean;
}

const env = process.env;
const statePath = env.FAKE_ACP_STATE;
const sessions = new Map<string, FakeSession>();
const loads = new Map<string, number>();
const known = new Set<string>(
  statePath && existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as string[]) : []
);
let counter = known.size;

if (env.FAKE_ACP_IGNORE_SIGTERM === "1") {
  process.on("SIGTERM", () => undefined);
}
if (env.FAKE_ACP_NOISY === "1") {
  process.stderr.write("x".repeat(1024 * 1024));
}
process.stderr.write(`fake-agent pid ${process.pid}\n`);

const remember = (sessionId: string, cwd: string, meta: unknown, mcpServers: unknown) => {
  sessions.set(sessionId, { cwd, meta, mcpServers, turns: 0 });
  known.add(sessionId);
  if (statePath) {
    writeFileSync(statePath, JSON.stringify([...known]));
  }
};

const textOf = (prompt: readonly acp.ContentBlock[]) =>
  prompt.map((block) => (block.type === "text" ? block.text : `[${block.type}]`)).join("\n");

const say = (client: acp.AgentContext, sessionId: string, text: string, kind = "agent_message_chunk") =>
  client.notify(acp.methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: kind, content: { type: "text", text } } as acp.SessionUpdate
  });

const update = (client: acp.AgentContext, sessionId: string, value: Record<string, unknown>) =>
  client.notify(acp.methods.client.session.update, { sessionId, update: value as acp.SessionUpdate });

const capabilities: acp.AgentCapabilities = {
  loadSession: env.FAKE_ACP_LOAD === "load",
  promptCapabilities: { image: true, embeddedContext: true },
  mcpCapabilities: { http: true, sse: false },
  sessionCapabilities: {
    ...(env.FAKE_ACP_LOAD === "resume" ? { resume: {} } : {}),
    ...(env.FAKE_ACP_SESSION_CLOSE === "1" ? { close: {} } : {})
  }
};

const app = acp
  .agent({ name: "fake-agent" })
  .onRequest(acp.methods.agent.initialize, async ({ params }) => {
    if (env.FAKE_ACP_INITIALIZE === "hang") {
      await new Promise(() => undefined);
    }
    if (env.FAKE_ACP_INITIALIZE === "exit") {
      process.exit(7);
    }
    return {
      protocolVersion: env.FAKE_ACP_INITIALIZE === "protocol-2" ? 2 : params.protocolVersion,
      agentCapabilities: capabilities,
      authMethods: [{ id: "fake-login", name: "Fake login" }],
      agentInfo: { name: "fake-agent", version: "1.2.3" }
    };
  })
  .onRequest(acp.methods.agent.session.new, async ({ params }) => {
    if (env.FAKE_ACP_AUTH === "required") {
      throw acp.RequestError.authRequired();
    }
    if (env.FAKE_ACP_NEW === "hang") {
      await new Promise(() => undefined);
    }
    counter += 1;
    const sessionId = `fake-session-${counter}`;
    remember(sessionId, params.cwd, params._meta ?? null, params.mcpServers);
    return { sessionId };
  })
  .onRequest(acp.methods.agent.session.load, async ({ client, params }) => {
    if (!known.has(params.sessionId)) {
      throw acp.RequestError.resourceNotFound(params.sessionId);
    }
    loads.set(params.sessionId, (loads.get(params.sessionId) ?? 0) + 1);
    remember(params.sessionId, params.cwd, params._meta ?? null, params.mcpServers);
    // The history replay a client must not show as a new turn.
    await say(client, params.sessionId, "replayed prompt", "user_message_chunk");
    await say(client, params.sessionId, "replayed answer");
    return {};
  })
  .onRequest(acp.methods.agent.session.resume, ({ params }) => {
    if (!known.has(params.sessionId)) {
      throw acp.RequestError.resourceNotFound(params.sessionId);
    }
    remember(params.sessionId, params.cwd, params._meta ?? null, params.mcpServers ?? []);
    return {};
  })
  .onRequest(acp.methods.agent.session.close, ({ params }) => {
    sessions.delete(params.sessionId);
    process.stderr.write(`closed ${params.sessionId}\n`);
    return {};
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ client, params }) => {
    const session = sessions.get(params.sessionId);
    if (!session) {
      throw acp.RequestError.resourceNotFound(params.sessionId);
    }
    session.turns += 1;
    const text = textOf(params.prompt);
    const [command = "", ...rest] = (text.split("\n").at(-1) ?? "").split(" ");
    const { sessionId } = params;
    const cancelled = new Promise<void>((resolve) => {
      session.cancel = resolve;
      if (session.cancelEarly === true) {
        session.cancelEarly = false;
        resolve();
      }
    });

    const turn = async (): Promise<acp.PromptResponse> => {
      switch (command) {
        case "echo": {
          const words = rest.join(" ");
          await say(client, sessionId, "thinking about it", "agent_thought_chunk");
          await say(client, sessionId, words.slice(0, 3));
          await say(client, sessionId, words.slice(3));
          await update(client, sessionId, {
            sessionUpdate: "tool_call",
            toolCallId: `call-${session.turns}`,
            title: "read_file",
            kind: "read",
            status: "pending",
            rawInput: { path: "a.txt" }
          });
          await update(client, sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId: `call-${session.turns}`,
            status: "in_progress"
          });
          await update(client, sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId: `call-${session.turns}`,
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "file body" } }]
          });
          await update(client, sessionId, {
            sessionUpdate: "plan",
            entries: [{ content: "answer", priority: "high", status: "completed" }]
          });
          await say(client, sessionId, "done");
          return {
            stopReason: "end_turn",
            usage: { totalTokens: 21, inputTokens: 10, outputTokens: 5, thoughtTokens: 2, cachedReadTokens: 4 }
          };
        }
        case "inspect": {
          const report = {
            pid: process.pid,
            loads: loads.get(sessionId) ?? 0,
            cwd: session.cwd,
            meta: session.meta,
            mcpServers: session.mcpServers,
            prompt: params.prompt,
            env: Object.keys(env)
              .filter((name) => name !== "__CF_USER_TEXT_ENCODING")
              .toSorted()
          };
          await say(client, sessionId, JSON.stringify(report));
          return { stopReason: "end_turn" };
        }
        case "permission": {
          const answer = client.request(acp.methods.client.session.requestPermission, {
            sessionId,
            toolCall: { toolCallId: "call-p", title: "write_file", kind: "edit", rawInput: { path: "b.txt" } },
            options: [
              { optionId: "allow", name: "Allow once", kind: "allow_once" },
              { optionId: "reject", name: "Reject once", kind: "reject_once" }
            ]
          });
          const { outcome } = await answer;
          await say(client, sessionId, `permission ${JSON.stringify(outcome)}`);
          return { stopReason: outcome.outcome === "cancelled" ? "cancelled" : "end_turn" };
        }
        case "hang": {
          await say(client, sessionId, "working");
          await cancelled;
          return { stopReason: "cancelled" };
        }
        case "stubborn": {
          await say(client, sessionId, "working");
          await cancelled;
          await say(client, sessionId, "cancel received, still working");
          return new Promise<never>(() => undefined);
        }
        case "exit": {
          await say(client, sessionId, "exiting");
          setTimeout(() => process.exit(3), 10);
          return new Promise<never>(() => undefined);
        }
        case "read": {
          try {
            const read = await client.request(acp.methods.client.fs.readTextFile, {
              sessionId,
              path: rest[0] ?? "",
              ...(rest[1] ? { line: Number(rest[1]) } : {}),
              ...(rest[2] ? { limit: Number(rest[2]) } : {})
            });
            await say(client, sessionId, `read ${read.content}`);
          } catch (error) {
            await say(client, sessionId, `refused ${(error as Error).message}`);
          }
          return { stopReason: "end_turn" };
        }
        case "write": {
          try {
            await client.request(acp.methods.client.fs.writeTextFile, {
              sessionId,
              path: rest[0] ?? "",
              content: rest.slice(1).join(" ")
            });
            await say(client, sessionId, "wrote");
          } catch (error) {
            await say(client, sessionId, `refused ${(error as Error).message}`);
          }
          return { stopReason: "end_turn" };
        }
        case "fail":
          throw acp.RequestError.internalError(undefined, "the turn broke");
        default:
          await say(client, sessionId, `turn ${session.turns}: ${text}`);
          return { stopReason: "end_turn" };
      }
    };
    try {
      return await turn();
    } finally {
      session.cancel = undefined;
    }
  });

app.onNotification(acp.methods.agent.session.cancel, ({ params }) => {
  const session = sessions.get(params.sessionId);
  if (session?.cancel === undefined) {
    if (session) {
      session.cancelEarly = true;
    }
    return;
  }
  session.cancel();
});

const connection = app.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
  )
);
await connection.closed;
