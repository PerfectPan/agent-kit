import {
  type AgentHome,
  type CodingAgentId,
  type HomeContext,
  homeFromRule,
  type HomeRule,
  isBuiltinCodingAgentId,
  parseCodingAgentId,
  resolveHome
} from "@rivus/agent-kit-catalog";

import { capabilityUnsupported } from "./errors.js";

/** The adapters of the requested agents, by id or alias, each once. An agent without one throws. */
export function selectAdapters<Adapter>(
  table: Readonly<Partial<Record<CodingAgentId, Adapter>>>,
  agents: readonly CodingAgentId[],
  kind: string
): Adapter[] {
  const selected = new Map<CodingAgentId, Adapter>();
  for (const requested of agents) {
    const parsed = parseCodingAgentId(requested);
    const agent = parsed.ok ? parsed.value : requested;
    const adapter = table[agent];
    if (!adapter) {
      throw capabilityUnsupported(agent, `has no ${kind}`);
    }
    selected.set(agent, adapter);
  }
  return [...selected.values()];
}

/** The home an adapter reads: its own home rule, else catalog's rule for a built-in agent. */
export function adapterHome(
  adapter: { readonly agent: CodingAgentId; readonly home?: HomeRule },
  context: HomeContext,
  kind: string
): AgentHome {
  if (adapter.home) {
    return homeFromRule(adapter.agent, adapter.home, context);
  }
  if (isBuiltinCodingAgentId(adapter.agent)) {
    return resolveHome(adapter.agent, context);
  }
  throw capabilityUnsupported(adapter.agent, `has a ${kind} without a home rule, and catalog does not know it`);
}
