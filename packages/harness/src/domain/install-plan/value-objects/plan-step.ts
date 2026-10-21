import { deepFreeze } from "../../../lib/deep-freeze.js";
import { err, ok, type Result } from "@rivus/agent-kit-catalog/public";
import type { LedgerEntry } from "../../ledger/entities/ledger-entry.js";
import type { PreImage } from "../../ledger/value-objects/pre-image.js";
import type { ObservedArtifact } from "../spi/observed-artifact.js";
import type { CodingAgentId } from "@rivus/agent-kit-catalog/public";

import type { Strategy } from "../../bundle/spi/strategy.js";
import { type ArtifactContent, type ContentHash, isContentHash } from "../../ledger/value-objects/content-hash.js";
import type { Drift } from "../../ledger/value-objects/drift.js";
import { ArtifactLocator, type ArtifactLocatorSnapshot } from "./artifact-locator.js";
import type { ConflictSnapshot, ConflictChoice } from "./conflict.js";
import { Precondition, type PreconditionSnapshot } from "./precondition.js";

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
export interface PlanStepSnapshot {
  readonly locator: ArtifactLocatorSnapshot;
  readonly action: PlanAction;
  /** The agents that use the Artifact once the step is done; empty once it is removed. */
  readonly agents: readonly CodingAgentId[];
  readonly precondition: PreconditionSnapshot;
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
  readonly conflict?: ConflictSnapshot;
  readonly choice?: ConflictChoice;
  /** The drift that led to this step, such as an `update` of an outdated Artifact. */
  readonly drift?: Drift;
  /** The target is what an older version of the owner installed without a ledger; it gets no pre-image. */
  readonly legacy?: true;
  readonly note?: StepNote;
}

export class PlanStep {
  declare readonly locator: ArtifactLocatorSnapshot;
  declare readonly action: PlanAction;

  declare readonly agents: readonly CodingAgentId[];
  declare readonly precondition: PreconditionSnapshot;

  declare readonly desired?: { readonly hash: ContentHash; readonly content: ArtifactContent };
  declare readonly strategy?: Strategy;

  declare readonly capturePreImage: boolean;
  declare readonly removal?: Removal;

  declare readonly conflict?: ConflictSnapshot;
  declare readonly choice?: ConflictChoice;

  declare readonly drift?: Drift;

  declare readonly legacy?: true;
  declare readonly note?: StepNote;

  readonly #snapshot: PlanStepSnapshot;
  readonly #locator: ArtifactLocator;
  readonly #condition: Precondition;
  private constructor(snapshot: PlanStepSnapshot, locator: ArtifactLocator, condition: Precondition) {
    this.#snapshot = deepFreeze(structuredClone(snapshot));
    this.#locator = locator;
    this.#condition = condition;
    Object.assign(this, this.#snapshot);
    Object.freeze(this);
  }

  static restore(snapshot: PlanStepSnapshot): Result<PlanStep, string> {
    const locator = ArtifactLocator.restore(snapshot.locator);
    if (!locator.ok) {
      return locator;
    }
    const reason = PlanStep.problem(snapshot);
    if (reason !== undefined) {
      return err(reason);
    }
    const condition = Precondition.restore(snapshot.precondition);
    if (!condition.ok) {
      return condition;
    }
    return ok(new PlanStep(snapshot, locator.value, condition.value));
  }

  toSnapshot(): PlanStepSnapshot {
    return this.#snapshot;
  }
  key(): string {
    return this.#locator.key();
  }
  touchesDisk(): boolean {
    return PlanStep.touchesDisk(this.#snapshot);
  }
  contentAfter(preImage: PreImage | undefined): ReturnType<typeof PlanStep.contentAfter> {
    return PlanStep.contentAfter(this.#snapshot, preImage);
  }
  preconditionSatisfied(context: { readonly entry?: LedgerEntry; readonly observed?: ObservedArtifact }): boolean {
    return this.#condition.satisfied(context);
  }
  targetWritable(observed: ObservedArtifact | undefined): boolean {
    return !this.touchesDisk() || this.locator.kind === "symlink" || observed?.symlinkTarget === undefined;
  }
  preconditionHolds(context: { readonly entry?: LedgerEntry; readonly observed?: ObservedArtifact }): boolean {
    return this.preconditionSatisfied(context) && this.targetWritable(context.observed);
  }
  /** Why a step's own fields are inconsistent, so that no transition can record something `restore` would refuse. */
  static problem(step: PlanStepSnapshot): string | undefined {
    const { action, desired, precondition, removal } = step;
    if (action === "conflict" && step.conflict === undefined) {
      return "a conflict without a reason";
    }
    const condition = Precondition.restore(precondition);
    if (!condition.ok) {
      return condition.error;
    }
    if (desired !== undefined && !isContentHash(desired.hash)) {
      return "an invalid desired hash";
    }
    if ((action === "create" || action === "update" || action === "adopt") && desired === undefined) {
      return `${action} without desired content`;
    }
    if (action === "remove" ? removal === undefined : removal !== undefined && action !== "conflict") {
      return "a removal kind on the wrong action";
    }
    if (step.capturePreImage && !("hash" in precondition)) {
      return "a pre-image to capture where nothing is";
    }
    const recorded = (action !== "remove" && action !== "conflict" && desired !== undefined) || removal === "release";
    return recorded && step.agents.length === 0 ? "no agents for an Artifact the ledger records" : undefined;
  }

  /**
   * Whether the executor changes the target on disk for this step: a create or update, an adopt whose content differs
   * from what is there, or a removal that deletes or restores something. Steps that only change the ledger do not.
   */
  static touchesDisk(step: PlanStepSnapshot): boolean {
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
  /**
   * The content a step leaves behind, expressed the same way the ledger's pending reconciliation is: a non-removal
   * leaves its desired content; a `restore-pre-image` of something that existed leaves that pre-image; anything else
   * leaves nothing. The use case fetches the pre-image's bytes from the ledger repository.
   */
  static contentAfter(
    step: PlanStepSnapshot,
    preImage: PreImage | undefined
  ): { readonly desired: ArtifactContent } | { readonly preImage: string } | undefined {
    if (step.action !== "remove") {
      return step.desired === undefined ? undefined : { desired: step.desired.content };
    }
    return step.removal === "restore-pre-image" && preImage?.existed === true
      ? { preImage: preImage.blobRef }
      : undefined;
  }
}
