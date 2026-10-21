import { AgentKitError } from "../../result/errors/agent-kit-error.js";
import { err, ok, type Result } from "../../result/value-objects/result.js";
import type { CapabilityUnsupported } from "../errors/capability-unsupported.js";
import type { CodingAgentId } from "../value-objects/coding-agent-id.js";
import type { ServiceTable } from "../value-objects/service-table.js";

/** Looks up a provider for an agent named by data; missing providers are expected outcomes. */
export function lookupService<T>(agent: CodingAgentId, table: ServiceTable<T>): Result<T, CapabilityUnsupported> {
  const service = Object.hasOwn(table, agent) ? table[agent] : undefined;
  return service == null ? err({ _tag: "CapabilityUnsupported", agent }) : ok(service);
}

/** A caller naming an unsupported agent in its options is a programming error. */
export function requireService<T>(
  agent: CodingAgentId,
  table: ServiceTable<T>,
  reason = "has no provider for this capability"
): T {
  const result = lookupService(agent, table);
  if (!result.ok) {
    throw new AgentKitError("capability-unsupported", `Agent "${agent}" ${reason}`);
  }
  return result.value;
}
