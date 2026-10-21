import { AgentKitError } from "../../result/errors/agent-kit-error.js";
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
  const aliases = identityNames(identities);
  const canonical = aliases.get(id);
  if (canonical !== undefined) {
    return ok(canonical);
  }
  return CODING_AGENT_ID_PATTERN.test(id) ? ok(id) : err({ _tag: "InvalidCodingAgentId", input });
}

/** Invalid identity tables are caller errors, even when the queried name is otherwise unambiguous. */
export function validateIdentities(identities: ServiceTable<CodingAgent>): void {
  identityNames(identities);
}

function identityNames(identities: ServiceTable<CodingAgent>): Map<string, CodingAgentId> {
  const names = new Map<string, CodingAgentId>();
  for (const [key, identity] of Object.entries(identities)) {
    if (identity == null) continue;
    if (key !== identity.id) {
      throw new AgentKitError("invalid-identity-table", `Identity key "${key}" differs from id "${identity.id}"`);
    }
    names.set(key, identity.id);
  }
  for (const identity of Object.values(identities)) {
    if (identity == null) continue;
    for (const alias of identity.aliases) {
      const existing = names.get(alias);
      if (existing !== undefined && existing !== identity.id) {
        throw new AgentKitError(
          "invalid-identity-table",
          `Identity name "${alias}" belongs to both "${existing}" and "${identity.id}"`
        );
      }
      names.set(alias, identity.id);
    }
  }
  return names;
}
