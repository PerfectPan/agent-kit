import { probeAgent as contextProbeAgent } from "@rivus/agent-kit-acp/public";
import { connectAgent as contextConnectAgent } from "@rivus/agent-kit-acp/public";
import { acpTable } from "./providers/acp.js";
import type { ProviderOptions } from "./providers/types.js";

export {
  agentEnv,
  builtinAcpProfiles,
  FileSessionBindingStoreLive,
  MemorySessionBindingStoreLive,
  optionOfKind,
  SessionBindingStore
} from "@rivus/agent-kit-acp/public";
export type {
  AcpConnection,
  AcpErrorCode,
  AcpProfile,
  AcpProfiles,
  AcpRequestFailed,
  AcpSessionHandle,
  AcpSessionSnapshot,
  AcpSessionState,
  AcpTimeout,
  AgentFeatures,
  AgentInfo,
  AgentProbe,
  AgentUnavailable,
  AuthMethodInfo,
  AuthRequired,
  BindingNotFound,
  CancelUnsettled,
  ConnectError,
  ConnectionClosed,
  HandshakeFailed,
  LoadSessionError,
  LoadSessionTarget,
  LoadUnsupported,
  McpServerConfig,
  NameValue,
  NewSessionError,
  NewSessionOptions,
  PermissionCallback,
  PermissionDecision,
  PermissionOption,
  PermissionOptionKind,
  PermissionRequest,
  PromptBlock,
  PromptError,
  SessionBinding,
  SessionBindingStoreFailure,
  SessionBindingStoreShape,
  SessionClosed,
  SessionCloseReason,
  SessionOptions,
  SessionSetup,
  SystemPromptPlacement,
  TurnInProgress
} from "@rivus/agent-kit-acp/public";
export { foldStreamParts } from "@rivus/agent-kit-sessions/public";
export type { LiveTranscriptEvent, TranscriptStreamPart } from "@rivus/agent-kit-sessions/public";

export type ConnectAgentOptions = ProviderOptions<Parameters<typeof contextConnectAgent>[1]>;

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
