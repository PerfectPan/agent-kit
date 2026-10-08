import type { AcpSessionState } from "../value-objects/acp-session-snapshot.js";

/** A transition the session's state does not allow, such as finishing a turn that is not running. */
export interface IllegalTransition {
  readonly _tag: "IllegalTransition";
  readonly transition: string;
  readonly state: AcpSessionState;
}
