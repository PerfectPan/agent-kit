export {
  builtinCodingAgents,
  isBuiltinCodingAgentId,
  type BuiltinCodingAgentId,
  type CodingAgentId
} from "./providers/identity.js";
export {
  AgentKitError,
  err,
  homeFromRule,
  isAgentKitError,
  ok,
  parseCodingAgentId
} from "@rivus/agent-kit-catalog/public";
export type {
  AgentHome,
  AgentHomeSource,
  AgentKitErrorOptions,
  CodingAgent,
  CodingAgentWithHome,
  HomeContext,
  HomeRule,
  InvalidCodingAgentId,
  Result
} from "@rivus/agent-kit-catalog/public";
