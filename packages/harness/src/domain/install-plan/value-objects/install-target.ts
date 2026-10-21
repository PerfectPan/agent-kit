import { isWithin, type ArtifactLocatorSnapshot } from "./artifact-locator.js";
import type { CodingAgentId } from "@rivus/agent-kit-catalog/public";

/** Each scope has its own Ledger. */
export type InstallScope = "user" | "project";

/** What one plan installs into: agents in one scope. */
export interface InstallTargetSnapshot {
  readonly scope: InstallScope;
  /** The plan covers the owner's Artifacts for these agents only; Artifacts of other agents stay untouched. */
  readonly agents: readonly CodingAgentId[];
  /**
   * Absolute directories every step's path must be inside, such as the agents' homes or the project root, resolved
   * by the path convention of ArtifactLocator.
   */
  readonly roots: readonly string[];
}

export class InstallTarget {
  readonly #snapshot: InstallTargetSnapshot;
  private constructor(snapshot: InstallTargetSnapshot) {
    this.#snapshot = Object.freeze({
      ...snapshot,
      agents: Object.freeze([...snapshot.agents]),
      roots: Object.freeze([...snapshot.roots])
    });
    Object.freeze(this);
  }
  static restore(snapshot: InstallTargetSnapshot): InstallTarget {
    return new InstallTarget(snapshot);
  }
  contains(locator: ArtifactLocatorSnapshot): boolean {
    return this.#snapshot.roots.some((root) => isWithin(locator.path, root));
  }
  toSnapshot(): InstallTargetSnapshot {
    return this.#snapshot;
  }
}
