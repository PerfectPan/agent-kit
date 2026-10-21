import {
  type AgentHome,
  type CodingAgentId,
  type HomeContext,
  type HomeRule,
  type CodingAgent,
  type ServiceTable,
  requireService,
  homeFromRule,
  homeRuleOf,
  parseCodingAgentId
} from "@rivus/agent-kit-catalog";

import { capabilityUnsupported } from "../errors.js";

/** The adapters of the requested agents, by id or alias, each once. An agent without one throws. */
export function selectAdapters<Adapter>(
  table: ServiceTable<Adapter>,
  agents: readonly CodingAgentId[],
  kind: string,
  identities: ServiceTable<CodingAgent>
): Adapter[] {
  const selected = new Map<CodingAgentId, Adapter>();
  for (const requested of agents) {
    const parsed = parseCodingAgentId(requested, identities);
    const agent = parsed.ok ? parsed.value : requested;
    const adapter = requireService(agent, table, `has no ${kind}`);
    selected.set(agent, adapter);
  }
  return [...selected.values()];
}

/** The home an adapter reads: its own home rule, else the one `homeRuleOf` finds for a built-in agent. */
export function adapterHome(
  adapter: { readonly agent: CodingAgentId; readonly home?: HomeRule },
  context: HomeContext,
  kind: string,
  identities: ServiceTable<CodingAgent>
): AgentHome {
  const rule = homeRuleOf(adapter.agent, identities, adapter.home);
  if (rule) {
    return homeFromRule(adapter.agent, rule, context);
  }
  throw capabilityUnsupported(adapter.agent, `has a ${kind} without a home rule, and catalog has none for it`);
}
