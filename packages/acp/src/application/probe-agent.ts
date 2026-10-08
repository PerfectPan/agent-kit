import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import type { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";

import { type ConnectAgentOptions, connectAgent, type ConnectError, type NewSessionError } from "./connect-agent.js";
import type { AuthMethodInfo } from "./errors.js";
import type { AgentFeatures, AgentInfo } from "./wire.js";

/**
 * What a trial connection found: `ready` when the agent opened a session, `needs-login` when it refused one until the
 * user logs in, `unavailable` when it did not start, did not complete the handshake or failed otherwise.
 */
export type AgentProbe =
  | {
      readonly status: "ready";
      readonly agentInfo?: AgentInfo;
      readonly features: AgentFeatures;
      readonly authMethods: readonly AuthMethodInfo[];
    }
  | { readonly status: "needs-login"; readonly agentInfo?: AgentInfo; readonly authMethods: readonly AuthMethodInfo[] }
  | { readonly status: "unavailable"; readonly error: ConnectError | NewSessionError };

/**
 * Connects, opens one session in `options.cwd` and closes both. Opening a session is where agents report a missing
 * login: the auth methods an agent lists are offered by logged-in agents too.
 */
export function probeAgent(
  agent: CodingAgentId,
  options: ConnectAgentOptions
): Effect.Effect<AgentProbe, never, PlatformService> {
  return Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* connectAgent(agent, options);
      const info = connection.agentInfo === undefined ? {} : { agentInfo: connection.agentInfo };
      return yield* connection.newSession().pipe(
        Effect.flatMap((session) => session.close()),
        Effect.as<AgentProbe>({
          status: "ready",
          ...info,
          features: connection.features,
          authMethods: connection.authMethods
        }),
        Effect.catchTag("AuthRequired", (error) =>
          Effect.succeed<AgentProbe>({ status: "needs-login", ...info, authMethods: error.authMethods })
        )
      );
    })
  ).pipe(Effect.catch((error) => Effect.succeed<AgentProbe>({ status: "unavailable", error })));
}
