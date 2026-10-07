import { AgentKitError, type CodingAgentId } from "@rivus/agent-kit-catalog";

/**
 * Code of the `AgentKitError` that `listSessions` throws when the caller asks for an agent with no session adapter,
 * or passes an adapter for an agent catalog does not know without a home rule. Reading a session returns its
 * failures as values instead.
 */
export type SessionErrorCode = "capability-unsupported";

export function capabilityUnsupported(
  agent: CodingAgentId,
  reason = "has no session adapter"
): AgentKitError<SessionErrorCode> {
  return new AgentKitError("capability-unsupported", `Agent "${agent}" ${reason}`);
}
