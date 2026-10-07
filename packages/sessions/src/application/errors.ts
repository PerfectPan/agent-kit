import { AgentKitError, type CodingAgentId } from "@rivus/agent-kit-catalog";

/**
 * Codes of the `AgentKitError`s that the sessions use cases throw for a caller's mistake. `capability-unsupported`:
 * the call names an agent with no adapter in the table, or passes an adapter for an agent catalog does not know without
 * a home rule. `invalid-cursor`: a usage cursor of another agent. Reading returns its failures as values instead.
 */
export type SessionErrorCode = "capability-unsupported" | "invalid-cursor";

export function capabilityUnsupported(
  agent: CodingAgentId,
  reason = "has no session adapter"
): AgentKitError<SessionErrorCode> {
  return new AgentKitError("capability-unsupported", `Agent "${agent}" ${reason}`);
}
