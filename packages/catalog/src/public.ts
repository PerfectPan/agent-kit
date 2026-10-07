export { builtinCodingAgents, isBuiltinCodingAgentId, parseCodingAgentId, resolveHome } from "./agents/index.js";
export { homeFromRule } from "./domain/coding-agent/index.js";
export type {
  AgentHome,
  AgentHomeSource,
  BuiltinCodingAgentId,
  CodingAgent,
  CodingAgentId,
  CodingAgentIdWithHome,
  CodingAgentWithHome,
  HomeContext,
  HomeRule,
  InvalidCodingAgentId
} from "./domain/coding-agent/index.js";
export { AgentKitError, isAgentKitError, err, ok } from "./domain/result/index.js";
export type { AgentKitErrorOptions, Result } from "./domain/result/index.js";
