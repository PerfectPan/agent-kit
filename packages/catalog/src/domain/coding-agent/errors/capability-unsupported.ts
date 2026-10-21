import type { CodingAgentId } from "../value-objects/coding-agent-id.js";

/** Data names an agent without a provider for the requested capability. */
export interface CapabilityUnsupported {
  readonly _tag: "CapabilityUnsupported";
  readonly agent: CodingAgentId;
}
