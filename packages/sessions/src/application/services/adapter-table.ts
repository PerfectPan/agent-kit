import {
  type AgentHome,
  type CodingAgentId,
  type HomeContext,
  homeFromRule,
  type HomeRule,
  homeRuleOf,
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

/** The home an adapter reads: its own home rule, else the one `homeRuleOf` finds for a built-in agent. */
export function adapterHome(
  adapter: { readonly agent: CodingAgentId; readonly home?: HomeRule },
  context: HomeContext,
  kind: string
): AgentHome {
  const rule = homeRuleOf(adapter.agent, adapter.home);
  if (rule) {
    return homeFromRule(adapter.agent, rule, context);
  }
  throw capabilityUnsupported(adapter.agent, `has a ${kind} without a home rule, and catalog has none for it`);
}
