import type { HomeRule } from "./agent-home.js";
import type { BuiltinCodingAgentId } from "./coding-agent-id.js";

/** The identity of a built-in CodingAgent: what every context needs to agree on, and nothing more. */
export interface CodingAgent {
  readonly id: BuiltinCodingAgentId;
  readonly displayName: string;
  /** Other ids that name the same agent, such as `claude`; `parseCodingAgentId` maps them to `id`. */
  readonly aliases: readonly string[];
  readonly home: HomeRule;
}
