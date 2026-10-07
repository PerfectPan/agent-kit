import type { CodingAgentId } from "@rivus/agent-kit-catalog";

/** The reference to a Session. It carries the CodingAgentId, so later calls reach the right adapter. */
export interface SessionRef {
  readonly agent: CodingAgentId;
  /** The session's main file; an adapter may read other files next to it. */
  readonly path: string;
  readonly sessionId?: string;
}
