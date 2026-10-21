import { err, ok, type Result } from "../../result/value-objects/result.js";
import type { HomeRule } from "../value-objects/agent-home.js";
import type { CodingAgent } from "../value-objects/coding-agent.js";
import {
  CODING_AGENT_ID_PATTERN,
  type CodingAgentId,
  type InvalidCodingAgentId
} from "../value-objects/coding-agent-id.js";
import type { ServiceTable } from "../value-objects/service-table.js";
import { lookupService } from "./service-table.js";

/** The caller's own rule wins, then the identity's; no rule means the caller must report the missing home. */
export function homeRuleOf(
  agent: CodingAgentId,
  identities: ServiceTable<CodingAgent>,
  own?: HomeRule
): HomeRule | undefined {
  if (own !== undefined) {
    return own;
  }
  const identity = lookupService(agent, identities);
  return identity.ok ? identity.value.home : undefined;
}

/** Resolves aliases from the given identities, ignoring input case and space; other valid ids stay unchanged. */
export function parseCodingAgentId(
  input: string,
  identities: ServiceTable<CodingAgent>
): Result<CodingAgentId, InvalidCodingAgentId> {
  const id = input.trim().toLowerCase();
  const aliases = new Map(
    Object.values(identities).flatMap((agent) =>
      agent === undefined ? [] : [agent.id, ...agent.aliases].map((alias): [string, CodingAgentId] => [alias, agent.id])
    )
  );
  const canonical = aliases.get(id);
  if (canonical !== undefined) {
    return ok(canonical);
  }
  return CODING_AGENT_ID_PATTERN.test(id) ? ok(id) : err({ _tag: "InvalidCodingAgentId", input });
}
