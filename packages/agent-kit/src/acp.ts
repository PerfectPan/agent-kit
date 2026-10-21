import { probeAgent as contextProbeAgent } from "@rivus/agent-kit-acp/public";
import { connectAgent as contextConnectAgent } from "@rivus/agent-kit-acp/public";

import { acpTable } from "./providers/acp.js";
import type { ProviderOptions } from "./providers/types.js";

export {
  agentEnv,
  FileSessionBindingStoreLive,
  MemorySessionBindingStoreLive,
  SessionBindingStore
} from "@rivus/agent-kit-acp/public";
export type {
  AcpConnection,
  AcpProfile,
  AcpSessionHandle,
  ConnectError,
  McpServerConfig,
  NewSessionError,
  PermissionCallback,
  PermissionDecision,
  PermissionRequest,
  PromptBlock,
  PromptError
} from "@rivus/agent-kit-acp/public";

export type { TranscriptStreamPart } from "@rivus/agent-kit-sessions/public";

type ConnectAgentOptions = ProviderOptions<Parameters<typeof contextConnectAgent>[1]>;

export function connectAgent(
  agent: Parameters<typeof contextConnectAgent>[0],
  options: ConnectAgentOptions
): ReturnType<typeof contextConnectAgent> {
  return contextConnectAgent(agent, { ...options, providers: { acp: acpTable(options.providers) } });
}

export function probeAgent(
  agent: Parameters<typeof contextProbeAgent>[0],
  options: ConnectAgentOptions
): ReturnType<typeof contextProbeAgent> {
  return contextProbeAgent(agent, { ...options, providers: { acp: acpTable(options.providers) } });
}
