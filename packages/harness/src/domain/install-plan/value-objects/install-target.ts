import type { CodingAgentId } from "@rivus/agent-kit-catalog";

/** Each scope has its own Ledger. */
export type InstallScope = "user" | "project";

/** What one plan installs into: agents in one scope. */
export interface InstallTarget {
  readonly scope: InstallScope;
  /** The plan covers the owner's Artifacts for these agents only; Artifacts of other agents stay untouched. */
  readonly agents: readonly CodingAgentId[];
  /**
   * Absolute directories every step's path must be inside, such as the agents' homes or the project root, resolved
   * by the path convention of ArtifactLocator.
   */
  readonly roots: readonly string[];
}
