import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { Owner } from "../../bundle/value-objects/owner.js";
import type { ArtifactLocator } from "../../install-plan/value-objects/artifact-locator.js";
import type { PlanAction, Removal } from "../../install-plan/value-objects/plan-step.js";
import type { Precondition } from "../../install-plan/value-objects/precondition.js";
import type { ContentHash } from "./content-hash.js";
import type { PreImage } from "./pre-image.js";

/**
 * One plan step recorded in the Ledger before any target is touched, with everything needed to finish its record
 * later or to probe it after a crash, without the plan.
 */
export interface PendingOperation {
  readonly planId: string;
  readonly owner: Owner;
  readonly bundleVersion: string;
  readonly toolVersion: string;
  readonly locator: ArtifactLocator;
  readonly action: Exclude<PlanAction, "conflict">;
  readonly agents: readonly CodingAgentId[];
  readonly precondition: Precondition;
  /** The hash the target has once the step is done; absent on a removal and on a noop that keeps a user's change. */
  readonly resultHash?: ContentHash;
  readonly removal?: Removal;
  /** Captured before the step wrote, or, for `restore-pre-image`, the one to restore. */
  readonly preImage?: PreImage;
  readonly legacy?: true;
  readonly startedAt: string;
}

/**
 * How the executor finished a step. `done`: the step happened. `skipped`: it did not start, for example because its
 * precondition no longer held; the old record stays. `failed`: it may have changed the target; the operation stays
 * pending, to be probed.
 */
export interface StepOutcome {
  readonly locator: ArtifactLocator;
  readonly status: "done" | "skipped" | "failed";
}

/** What is at a pending operation's target after a crash: its hash, or none when nothing is there. */
export interface PendingProbe {
  readonly locator: ArtifactLocator;
  readonly hash?: ContentHash;
}

/**
 * What a probe shows. `completed`: the target is as the step leaves it, so the step's record is written.
 * `not-started`: the target is as the precondition expects; the old record stays. `unknown`: neither; the old record
 * stays and three-way verify reports the drift.
 */
export type PendingResolution = "completed" | "not-started" | "unknown";
