import { AgentKitError, type CodingAgentId } from "@rivus/agent-kit-catalog";

/**
 * Code of the `AgentKitError` that `detectAgents` throws when the caller asks for an agent without a probe recipe,
 * or a recipe checks a path under the home of an agent that has no home rule. What a probe finds, including a check
 * that fails, is reported as a value instead.
 */
export type DiscoveryErrorCode = "capability-unsupported";

export function capabilityUnsupported(
  agent: CodingAgentId,
  reason = "has no probe recipe"
): AgentKitError<DiscoveryErrorCode> {
  return new AgentKitError("capability-unsupported", `Agent "${agent}" ${reason}`);
}
