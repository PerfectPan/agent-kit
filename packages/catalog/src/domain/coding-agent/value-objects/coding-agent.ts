import type { HomeRule } from "./agent-home.js";
import type { BuiltinCodingAgentId } from "./coding-agent-id.js";

/** The identity of a built-in CodingAgent: what every context needs to agree on, and nothing more. */
export interface CodingAgent {
  readonly id: BuiltinCodingAgentId;
  readonly displayName: string;
  /** Other ids that name the same agent, such as `claude`; `parseCodingAgentId` maps them to `id`. */
  readonly aliases: readonly string[];
  /** Absent until an upstream source or the agent's documentation confirms where it keeps its data. */
  readonly home?: HomeRule;
}

export interface CodingAgentWithHome extends CodingAgent {
  readonly home: HomeRule;
}
