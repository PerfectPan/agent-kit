import { AgentKitError, type CodingAgentId } from "@rivus/agent-kit-catalog";
import type { ExitStatus } from "@rivus/agent-kit-platform";

/** The agent's program could not start, for example because it is not on the `PATH` of the given environment. */
export interface AgentUnavailable {
  readonly _tag: "AgentUnavailable";
  readonly agent: CodingAgentId;
  readonly command: string;
  readonly message: string;
}

/**
 * The agent started but the ACP handshake did not complete: it took longer than the handshake timeout, the process
 * exited, the agent speaks another protocol version, or it answered `initialize` with an error. `stderr` is the end of
 * what the agent wrote there.
 */
export interface HandshakeFailed {
  readonly _tag: "HandshakeFailed";
  readonly agent: CodingAgentId;
  readonly reason: "timeout" | "exited" | "protocol-version" | "error";
  readonly message: string;
  readonly exit?: ExitStatus;
  readonly stderr?: string;
}

/**
 * The connection ended: the caller closed it, the agent process exited, or a cancel on one of its sessions did not
 * settle and the kit closed it. Every session on it is closed.
 */
export interface ConnectionClosed {
  readonly _tag: "ConnectionClosed";
  readonly agent: CodingAgentId;
  readonly reason: "closed" | "exited" | "cancel-unsettled";
  readonly exit?: ExitStatus;
  readonly stderr?: string;
}

export interface AuthMethodInfo {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

/** The agent refused to open a session until the user logs in; `authMethods` lists the ways it offers. */
export interface AuthRequired {
  readonly _tag: "AuthRequired";
  readonly agent: CodingAgentId;
  readonly authMethods: readonly AuthMethodInfo[];
  readonly message: string;
}

/** The agent answered a request with a JSON-RPC error. */
export interface AcpRequestFailed {
  readonly _tag: "AcpRequestFailed";
  readonly method: string;
  readonly code?: number;
  readonly message: string;
  readonly data?: unknown;
}

/** The agent did not answer a session request (`session/new`, `session/load`, `session/resume`) in time. */
export interface AcpTimeout {
  readonly _tag: "AcpTimeout";
  readonly method: string;
  readonly timeoutMs: number;
}

/** The agent supports neither `session/load` nor `session/resume`, so an existing session cannot be opened. */
export interface LoadUnsupported {
  readonly _tag: "LoadUnsupported";
  readonly agent: CodingAgentId;
  readonly sessionId: string;
}

/** No binding for `sessionKey`, or one made for another agent. */
export interface BindingNotFound {
  readonly _tag: "BindingNotFound";
  readonly agent: CodingAgentId;
  readonly sessionKey: string;
}

/**
 * Codes of the `AgentKitError` that `connectAgent` throws, as a defect, for a caller mistake: an agent without an
 * ACP profile, or an option out of range such as a timeout that is not a positive number. What the agent does is
 * reported as a value instead.
 */
export type AcpErrorCode = "capability-unsupported" | "invalid-option";

export function capabilityUnsupported(agent: CodingAgentId): AgentKitError<AcpErrorCode> {
  return new AgentKitError("capability-unsupported", `Agent "${agent}" has no ACP profile`);
}

export function invalidOption(message: string): AgentKitError<AcpErrorCode> {
  return new AgentKitError("invalid-option", message);
}
