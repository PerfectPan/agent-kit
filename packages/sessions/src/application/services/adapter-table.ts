import {
  type AgentHome,
  builtinCodingAgents,
  type CodingAgentId,
  type HomeContext,
  homeFromRule,
  type HomeRule,
  isBuiltinCodingAgentId,
  parseCodingAgentId
} from "@rivus/agent-kit-catalog";

import { capabilityUnsupported } from "../errors.js";

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

/** The home an adapter reads: its own home rule, else catalog's rule for a built-in agent that has one. */
export function adapterHome(
  adapter: { readonly agent: CodingAgentId; readonly home?: HomeRule },
  context: HomeContext,
  kind: string
): AgentHome {
  const rule =
    adapter.home ?? (isBuiltinCodingAgentId(adapter.agent) ? builtinCodingAgents[adapter.agent].home : undefined);
  if (rule) {
    return homeFromRule(adapter.agent, rule, context);
  }
  throw capabilityUnsupported(adapter.agent, `has a ${kind} without a home rule, and catalog has none for it`);
}
