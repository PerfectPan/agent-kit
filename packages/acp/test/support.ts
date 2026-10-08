import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TranscriptStreamPart } from "@rivus/agent-kit-sessions";
import { NodePlatformLive } from "@rivus/agent-kit-platform-node/public/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  type AcpProfile,
  type ConnectAgentOptions,
  connectAgent,
  MemorySessionBindingStoreLive,
  type PromptBlock
} from "../src/public.js";

export const FAKE_AGENT: string = fileURLToPath(new URL("fixtures/fake-agent.ts", import.meta.url));

/** The fake agent as a profile: Node runs the fixture, and the system prompt goes to `_meta.systemPrompt`. */
export function fakeProfile(overrides: Partial<AcpProfile> = {}): AcpProfile {
  return {
    specificationVersion: "acp-v1",
    agent: "fake-agent",
    command: process.execPath,
    args: [FAKE_AGENT],
    env: [],
    systemPrompt: { in: "meta", key: "systemPrompt" },
    warnings: [],
    ...overrides
  };
}

const dirs: string[] = [];

export function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "acp-test-"));
  dirs.push(dir);
  return dir;
}

export function removeWorkDirs(): void {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface FakeOptions extends Partial<ConnectAgentOptions> {
  /** FAKE_ACP_* variables for the agent; the agent gets no other environment. */
  readonly fake?: Readonly<Record<string, string>>;
  readonly profile?: Partial<AcpProfile>;
}

export function connectFake(options: FakeOptions = {}): ReturnType<typeof connectAgent> {
  const { fake, profile, ...rest } = options;
  return connectAgent("fake-agent", {
    cwd: rest.cwd ?? workDir(),
    env: { ...fake },
    profiles: { "fake-agent": fakeProfile(profile) },
    ...rest
  });
}

export const TestLive = Layer.mergeAll(NodePlatformLive, MemorySessionBindingStoreLive);

export const text = (value: string): PromptBlock => ({ type: "text", text: value });

/** The text of the completed events of one kind, in order. */
export function eventTexts(parts: readonly TranscriptStreamPart[], kind = "assistant"): string[] {
  return parts.flatMap((part) =>
    part.type === "event" && part.event.kind === kind && typeof part.event.payload.text === "string"
      ? [part.event.payload.text]
      : []
  );
}

/** Waits, on the real clock, until `ready()` holds; a test clock does not move by itself. */
export function eventually(ready: () => boolean, timeoutMs = 10_000): Effect.Effect<void> {
  return Effect.promise(async () => {
    const started = Date.now();
    while (!ready()) {
      if (Date.now() - started > timeoutMs) {
        throw new Error("condition did not hold in time");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
}

/** Waits, on the real clock, until the session reaches `state`. */
export function untilState(
  session: { readonly snapshot: Effect.Effect<{ readonly state: string }> },
  state: string
): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      if ((yield* session.snapshot).state === state) {
        return;
      }
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)));
    }
    return yield* Effect.die(new Error(`the session never reached ${state}`));
  });
}

/** Whether a process with this pid is alive. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The fake agent's pid, which it writes to stderr first. */
export function pidIn(stderr: string | undefined): number {
  const match = /fake-agent pid (\d+)/.exec(stderr ?? "");
  if (match?.[1] === undefined) {
    throw new Error(`no pid in ${stderr}`);
  }
  return Number(match[1]);
}
