import type { Platform } from "@rivus/agent-kit-platform";
import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AgentCli, type AgentCliFailure, type AgentCliShape, type AgentCommand } from "../../application/ports.js";
import { findOnPath } from "../services/path-lookup.js";

/** Agent command lines that register plugins copy files and edit configuration; they finish well within this. */
const RUN_TIMEOUT_MS = 60_000;

function makeAgentCli(platform: Pick<Platform, "env" | "os" | "fs" | "process">): AgentCliShape {
  const failure = (call: AgentCommand, reason: AgentCliFailure["reason"], message: string): AgentCliFailure => ({
    _tag: "AgentCliFailure",
    agent: call.agent,
    command: call.command,
    args: call.args,
    reason,
    message
  });
  return {
    available: (command) =>
      Effect.promise(() => findOnPath(platform, command)).pipe(Effect.map((found) => found !== undefined)),
    run: (call) =>
      Effect.gen(function* () {
        const executable = yield* Effect.promise(() => findOnPath(platform, call.command));
        if (executable === undefined) {
          return yield* Effect.fail(failure(call, "not-found", `${call.command} is not on PATH`));
        }
        const result = yield* Effect.tryPromise({
          try: (signal) => platform.process.run(executable, call.args, { timeoutMs: RUN_TIMEOUT_MS, signal }),
          catch: (cause) => failure(call, "failed", cause instanceof Error ? cause.message : String(cause))
        });
        if (result.timedOut) {
          return yield* Effect.fail(
            failure(call, "timed-out", `${call.command} did not finish in ${RUN_TIMEOUT_MS} ms`)
          );
        }
        if (result.code !== 0) {
          const output = (result.stderr.trim() || result.stdout.trim()).slice(0, 2000);
          return yield* Effect.fail(
            failure(call, "failed", `${call.command} exited with ${result.code ?? result.signal}: ${output}`)
          );
        }
        return result;
      })
  };
}

/**
 * Runs agent command lines through `Platform.process.run`: the executable found on the platform's `PATH`, no shell,
 * the platform's environment, and a time limit. A command that times out has an unknown result; it is reported, never
 * retried.
 */
export const ProcessAgentCliLive: Layer.Layer<AgentCli, never, PlatformService> = Layer.effect(
  AgentCli,
  Effect.gen(function* () {
    return makeAgentCli(yield* PlatformService);
  })
);
