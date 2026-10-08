import type { CodingAgentId } from "@rivus/agent-kit-catalog";

/**
 * `starting` until the agent answers `session/new` or `session/load`; `ready` between turns; `turn` while a prompt
 * runs, `awaiting-permission` while the agent waits for permission answers; `cancelling` from a cancel until the turn
 * ends; `closed` for good.
 */
export type AcpSessionState = "starting" | "ready" | "turn" | "awaiting-permission" | "cancelling" | "closed";

/**
 * Why a session closed: the caller closed it, its connection ended, or a cancel did not settle in time (which also
 * removed its binding).
 */
export type SessionCloseReason = "closed" | "connection-closed" | "cancel-unsettled";

export interface AcpSessionSnapshot {
  readonly agent: CodingAgentId;
  /** Absent while `starting`. */
  readonly sessionId?: string;
  readonly sessionKey?: string;
  readonly state: AcpSessionState;
  /** Turns started so far; the running turn is the last one. */
  readonly turns: number;
  /** Permission requests of the running turn that have no answer yet. */
  readonly pendingPermissions: number;
  readonly closeReason?: SessionCloseReason;
}
