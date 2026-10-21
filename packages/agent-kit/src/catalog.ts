export { builtinCodingAgents } from "./providers/identity.js";
export {
  AgentKitError,
  err,
  homeFromRule,
  isAgentKitError,
  isBuiltinCodingAgentId,
  ok,
  parseCodingAgentId
} from "@rivus/agent-kit-catalog/public";
export type {
  AgentHome,
  AgentHomeSource,
  AgentKitErrorOptions,
  BuiltinCodingAgentId,
  CodingAgent,
  CodingAgentId,
  CodingAgentWithHome,
  HomeContext,
  HomeRule,
  InvalidCodingAgentId,
  Result
} from "@rivus/agent-kit-catalog/public";
