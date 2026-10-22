import { type CodingAgentId, err, ok, type Result } from "@rivus/agent-kit-catalog/public";

import type { InvalidLedger } from "../errors/invalid-ledger.js";
import { ArtifactLocator } from "../../install-plan/value-objects/artifact-locator.js";

import type { OwnerSnapshot } from "../../bundle/value-objects/owner.js";
import type { ArtifactLocatorSnapshot } from "../../install-plan/value-objects/artifact-locator.js";
import type { PlanAction, Removal } from "../../install-plan/value-objects/plan-step.js";
import type { PreconditionSnapshot } from "../../install-plan/value-objects/precondition.js";
import { type ContentHash, isContentHash } from "../value-objects/content-hash.js";
import { type PreImage, isPreImage } from "../value-objects/pre-image.js";

/**
 * One plan step recorded in the Ledger before any target is touched, with everything needed to finish its record
 * later or to probe it after a crash, without the plan.
 */
export interface PendingOperationSnapshot {
  readonly planId: string;
  readonly owner: OwnerSnapshot;
  readonly bundleVersion: string;
  readonly toolVersion: string;
  readonly locator: ArtifactLocatorSnapshot;
  readonly action: Exclude<PlanAction, "conflict">;
  readonly agents: readonly CodingAgentId[];
  readonly precondition: PreconditionSnapshot;
  /** The hash the target has once the step is done; absent on a removal and on a noop that keeps a user's change. */
  readonly resultHash?: ContentHash;
  readonly removal?: Removal;
  /** Captured before the step wrote, or, for `restore-pre-image`, the one to restore. */
  readonly preImage?: PreImage;
  /** Creation provenance to retain only after the executor confirms completion, not from an ambiguous crash probe. */
  readonly createdConfigFile?: true;
  readonly legacy?: true;
  readonly startedAt: string;
}

/**
 * How the executor finished a step. `done`: the step happened. `skipped`: it did not start, for example because its
 * precondition no longer held; the old record stays. `failed`: it may have changed the target; the operation stays
 * pending, to be probed.
 */
export interface StepOutcome {
  readonly locator: ArtifactLocatorSnapshot;
  readonly status: "done" | "skipped" | "failed";
}

/** What is at a pending operation's target after a crash: its hash, or none when nothing is there. */
export interface PendingProbe {
  readonly locator: ArtifactLocatorSnapshot;
  readonly hash?: ContentHash;
}

/**
 * What a probe shows. `completed`: the target is as the step leaves it, so the step's record is written.
 * `not-started`: the target is as the precondition expects; the old record stays. `unknown`: neither; the old record
 * stays and three-way verify reports the drift.
 */
export type PendingResolution = "completed" | "not-started" | "unknown";

function pendingProblem(op: PendingOperationSnapshot): string | undefined {
  const { precondition } = op;
  const invalid =
    ArtifactLocator.problem(op.locator) !== undefined ||
    (op.resultHash !== undefined && !isContentHash(op.resultHash)) ||
    (op.preImage !== undefined && !isPreImage(op.preImage)) ||
    ("hash" in precondition && !isContentHash(precondition.hash)) ||
    ("ownedAt" in precondition && (!Number.isSafeInteger(precondition.ownedAt) || precondition.ownedAt < 0));
  return invalid ? "pending operation has an invalid locator, hash, pre-image or precondition" : undefined;
}

/** A validated, immutable child of the Ledger; only the root restores or replaces it. */
export class PendingOperation {
  declare readonly planId: string;
  declare readonly owner: OwnerSnapshot;
  declare readonly bundleVersion: string;
  declare readonly toolVersion: string;
  declare readonly locator: ArtifactLocatorSnapshot;
  declare readonly action: Exclude<PlanAction, "conflict">;
  declare readonly agents: readonly CodingAgentId[];
  declare readonly precondition: PreconditionSnapshot;
  declare readonly resultHash?: ContentHash;
  declare readonly removal?: Removal;
  declare readonly preImage?: PreImage;
  declare readonly createdConfigFile?: true;
  declare readonly legacy?: true;
  declare readonly startedAt: string;

  static restore(snapshot: PendingOperationSnapshot): Result<PendingOperation, InvalidLedger> {
    const reason = pendingProblem(snapshot);
    return reason === undefined ? ok(new PendingOperation(snapshot)) : err({ _tag: "InvalidLedger", reason });
  }

  readonly #snapshot: PendingOperationSnapshot;

  private constructor(input: PendingOperationSnapshot) {
    const snapshot = structuredClone(input);
    Object.freeze(snapshot.locator);
    Object.freeze(snapshot.agents);
    Object.freeze(snapshot.precondition);
    Object.freeze(snapshot.preImage);
    this.#snapshot = Object.freeze(snapshot);
    Object.assign(this, snapshot);
    Object.freeze(this);
  }

  toSnapshot(): PendingOperationSnapshot {
    return this.#snapshot;
  }

  /**
   * Decides from a probe of the target whether a pending operation happened, instead of replaying it: the state the
   * step leaves wins over the state its precondition expects, so a step whose before and after look the same counts as
   * completed.
   */
  resolve(actual: ContentHash | undefined): PendingResolution {
    const after = this.expectedAfter();
    if (after === "any" || (after === "absent" ? actual === undefined : actual === after)) {
      return "completed";
    }
    const before = this.precondition;
    if ("ownedAt" in before) {
      return "completed";
    }
    return ("absent" in before ? actual === undefined : actual === before.hash) ? "not-started" : "unknown";
  }
  /** What the target holds once the operation is done: a hash, nothing, or anything because the disk is not involved. */
  private expectedAfter(): ContentHash | "absent" | "any" {
    if (this.action !== "remove") {
      return this.resultHash ?? "any";
    }
    switch (this.removal) {
      case "release":
      case "keep":
        return "any";
      case "restore-pre-image":
        return this.preImage?.existed === true ? this.preImage.hash : "absent";
      default:
        return "absent";
    }
  }
}
