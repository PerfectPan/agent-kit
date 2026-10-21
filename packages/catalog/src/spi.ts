/** Interfaces and shared helpers for provider implementations. */
export { homeFromRule } from "./domain/coding-agent/policies/home-from-rule.js";
export { type AgentHome, type HomeContext, type HomeRule } from "./domain/coding-agent/value-objects/agent-home.js";
export { type CodingAgentId } from "./domain/coding-agent/value-objects/coding-agent-id.js";
export { type CodingAgent, type CodingAgentWithHome } from "./domain/coding-agent/value-objects/coding-agent.js";
export { type ServiceTable } from "./domain/coding-agent/value-objects/service-table.js";
export { AgentKitError } from "./domain/result/errors/agent-kit-error.js";
export { ok, err, type Result } from "./domain/result/value-objects/result.js";
