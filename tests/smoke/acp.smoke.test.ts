// Drives the real ACP programs of the agents named in AGENT_KIT_SMOKE_AGENTS (comma-separated ids, such as
// "claude-code,codex"); every other agent is skipped. Each agent gets the variables its profile lists from this
// process's environment, so it runs logged in as the current user and may spend tokens. CI never runs these tests.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import {
  agentEnv,
  builtinAcpProfiles,
  connectAgent,
  MemorySessionBindingStoreLive,
  probeAgent
} from "@rivus/agent-kit-acp";
import { NodePlatformLive } from "@rivus/agent-kit-platform-node/public/effect";
import type { TranscriptStreamPart } from "@rivus/agent-kit-sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

const selected = new Set((process.env.AGENT_KIT_SMOKE_AGENTS ?? "").split(",").filter(Boolean));
const Live = Layer.mergeAll(NodePlatformLive, MemorySessionBindingStoreLive);

const agents = Object.entries(builtinAcpProfiles).filter(([agent]) => selected.has(agent));

function textOf(parts: readonly TranscriptStreamPart[]): string {
  return parts.map((part) => (part.type === "text-delta" ? part.delta : "")).join("");
}

describe.each(agents)("%s over ACP", (agent, profile) => {
  const options = () => ({
    cwd: mkdtempSync(join(tmpdir(), `agent-kit-smoke-${agent}-`)),
    env: profile === undefined ? {} : agentEnv(profile, process.env),
    handshakeTimeoutMs: 120_000,
    requestTimeoutMs: 120_000,
    cancelTimeoutMs: 30_000
  });

  it.live(
    "is ready or reports a missing login",
    () =>
      Effect.gen(function* () {
        const settings = options();
        const probe = yield* probeAgent(agent, settings).pipe(
          Effect.ensuring(Effect.sync(() => rmSync(settings.cwd, { recursive: true, force: true })))
        );
        expect(probe).not.toMatchObject({ status: "unavailable" });
      }).pipe(Effect.provide(Live)),
    300_000
  );

  it.live(
    "answers a prompt, follows the system prompt and settles a cancel",
    () =>
      Effect.gen(function* () {
        const settings = options();
        const connection = yield* connectAgent(agent, settings);
        const session = yield* connection.newSession({ systemPrompt: "Answer every message with the word PONG only." });
        const parts = yield* Stream.runCollect(session.prompt([{ type: "text", text: "ping" }]));
        const finish = parts.find((part) => part.type === "finish");
        expect(finish).toMatchObject({ finishReason: "end_turn" });
        expect(textOf(parts)).toMatch(/PONG/i);

        const long = session.prompt([{ type: "text", text: "Count from 1 to 500, one number per line." }]);
        yield* Stream.runCollect(long.pipe(Stream.take(1)));
        expect((yield* session.snapshot).state).toBe("ready");
        yield* Effect.sync(() => rmSync(settings.cwd, { recursive: true, force: true }));
      }).pipe(Effect.scoped, Effect.provide(Live)),
    300_000
  );
});
