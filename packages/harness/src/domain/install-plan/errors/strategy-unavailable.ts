import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { ArtifactSpec } from "../../bundle/value-objects/artifact-spec.js";
import type { Strategy } from "../../bundle/value-objects/strategy.js";

/**
 * No strategy of the agent can install an Artifact of the bundle: the agent supports none for that type (MCP servers
 * and instructions have no built-in strategy yet), or each one it supports needs an executable that is not on
 * `PATH`, such as `codex` for Codex's plugin.
 */
export interface StrategyUnavailable {
  readonly _tag: "StrategyUnavailable";
  readonly agent: CodingAgentId;
  readonly artifact: ArtifactSpec["type"];
  /** The strategies that were considered, with the executable each one lacked. */
  readonly missing: readonly { readonly strategy: Strategy; readonly command: string }[];
}
