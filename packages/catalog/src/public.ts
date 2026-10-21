export { homeFromRule } from "./domain/coding-agent/policies/home-from-rule.js";
export type {
  AgentHome,
  AgentHomeSource,
  HomeContext,
  HomeRule
} from "./domain/coding-agent/value-objects/agent-home.js";
export type { CodingAgent, CodingAgentWithHome } from "./domain/coding-agent/value-objects/coding-agent.js";
export type { CodingAgentId, InvalidCodingAgentId } from "./domain/coding-agent/value-objects/coding-agent-id.js";
export { parseCodingAgentId, validateIdentities } from "./domain/coding-agent/services/identity.js";
export { AgentKitError, isAgentKitError } from "./domain/result/errors/agent-kit-error.js";
export { err, ok } from "./domain/result/value-objects/result.js";
export type { AgentKitErrorOptions } from "./domain/result/errors/agent-kit-error.js";
export type { Result } from "./domain/result/value-objects/result.js";

export { requireService, lookupService } from "./domain/coding-agent/services/service-table.js";
export { type ServiceTable } from "./domain/coding-agent/value-objects/service-table.js";
export { homeRuleOf } from "./domain/coding-agent/services/identity.js";
export { type CapabilityUnsupported } from "./domain/coding-agent/errors/capability-unsupported.js";
