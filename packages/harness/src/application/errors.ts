import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { ArtifactSpec, Strategy } from "../domain/bundle/index.js";
import type { ArtifactLocator, Precondition } from "../domain/install-plan/index.js";
import type { ContentHash } from "../domain/ledger/index.js";
import type { AgentCliFailure, ArtifactFailure, LedgerStoreFailure } from "./ports.js";

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

/**
 * A target no longer holds what the plan expected, found right before writing. When it is found before anything was
 * written, nothing was; otherwise `completed` steps were applied, the step stays as the ledger had it, and the rest did
 * not start. Plan again.
 */
export interface TargetChanged {
  readonly _tag: "TargetChanged";
  readonly planId: string;
  readonly locator: ArtifactLocator;
  readonly expected: Precondition;
  readonly actual?: ContentHash;
  readonly completed: number;
}

/**
 * A step failed while it changed its target, after `completed` steps were applied. The step stays pending in the
 * ledger, so the next change probes its target instead of guessing; the rest did not start. Nothing is retried.
 */
export interface ApplyFailed {
  readonly _tag: "ApplyFailed";
  readonly planId: string;
  readonly locator: ArtifactLocator;
  readonly cause: ArtifactFailure | AgentCliFailure | LedgerStoreFailure;
  readonly completed: number;
}
