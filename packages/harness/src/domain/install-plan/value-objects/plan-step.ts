import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { Strategy } from "../../bundle/value-objects/strategy.js";
import type { ArtifactContent, ContentHash } from "../../ledger/value-objects/content-hash.js";
import type { Drift } from "../../ledger/value-objects/drift.js";
import type { ArtifactLocator } from "./artifact-locator.js";
import type { Conflict, ConflictChoice } from "./conflict.js";
import type { Precondition } from "./precondition.js";

export type PlanAction = "create" | "update" | "adopt" | "remove" | "noop" | "conflict";

/**
 * What a `remove` does on disk. `delete`: nothing was there before harness. `restore-pre-image`: put back what was.
 * `release`: other owners or agents still use the Artifact, so only the ledger changes. `keep`: the user changed the
 * Artifact, so it stays on disk as theirs and only its record (with the pre-image) is dropped.
 */
export type Removal = "delete" | "restore-pre-image" | "release" | "keep";

/**
 * Why harness leaves a file it would otherwise delete or restore: a ForeignOwner such as chezmoi manages the path, or
 * the path is a symlink. An owned Artifact's removal becomes `keep` (its record is dropped, the file stays); a legacy
 * removal becomes a `noop` in a plan that installs nothing. A blocked owned or legacy removal is a conflict when
 * installing a replacement, since the kept hook would still execute. Uninstall never stops
 * there, and the plan lists every such step in its `notes`.
 */
export type StepNote = "dotfiles-managed" | "symlinked-target";

/** One action of an InstallPlan on one Artifact. */
export interface PlanStep {
  readonly locator: ArtifactLocator;
  readonly action: PlanAction;
  /** The agents that use the Artifact once the step is done; empty once it is removed. */
  readonly agents: readonly CodingAgentId[];
  readonly precondition: Precondition;
  /**
   * What the target holds once the step is done. The executor writes it only when it differs from the precondition's
   * hash, so an `adopt` of matching content and a `noop` write nothing. Absent on a removal and on a `noop` that
   * keeps a user-modified Artifact.
   */
  readonly desired?: { readonly hash: ContentHash; readonly content: ArtifactContent };
  readonly strategy?: Strategy;
  /** Keep what is at the target as the LedgerEntry's pre-image before writing. */
  readonly capturePreImage: boolean;
  readonly removal?: Removal;
  /** Set with action `conflict`, or with the action that `choice` resolved it to. */
  readonly conflict?: Conflict;
  readonly choice?: ConflictChoice;
  /** The drift that led to this step, such as an `update` of an outdated Artifact. */
  readonly drift?: Drift;
  /** The target is what an older version of the owner installed without a ledger; it gets no pre-image. */
  readonly legacy?: true;
  readonly note?: StepNote;
}

/**
 * Whether the executor changes the target on disk for this step: a create or update, an adopt whose content differs
 * from what is there, or a removal that deletes or restores something. Steps that only change the ledger do not.
 */
export function touchesDisk(step: PlanStep): boolean {
  switch (step.action) {
    case "create":
    case "update":
      return true;
    case "adopt":
      return (
        step.desired !== undefined && !("hash" in step.precondition && step.precondition.hash === step.desired.hash)
      );
    case "remove":
      return step.removal === "restore-pre-image" || (step.removal === "delete" && !("absent" in step.precondition));
    default:
      return false;
  }
}
