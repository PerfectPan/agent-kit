export { homeFromRule } from "./domain/coding-agent/index.js";
export type {
  AgentHome,
  AgentHomeSource,
  CodingAgent,
  CodingAgentId,
  CodingAgentWithHome,
  HomeContext,
  HomeRule,
  InvalidCodingAgentId
} from "./domain/coding-agent/index.js";
export { parseCodingAgentId, validateIdentities } from "./domain/coding-agent/services/identity.js";
export { AgentKitError, isAgentKitError, err, ok } from "./domain/result/index.js";
export type { AgentKitErrorOptions, Result } from "./domain/result/index.js";
