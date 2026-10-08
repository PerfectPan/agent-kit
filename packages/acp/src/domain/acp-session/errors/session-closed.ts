import type { SessionCloseReason } from "../value-objects/acp-session-snapshot.js";

/** The session is closed; it refuses every operation. */
export interface SessionClosed {
  readonly _tag: "SessionClosed";
  readonly sessionId?: string;
  readonly reason: SessionCloseReason;
}
