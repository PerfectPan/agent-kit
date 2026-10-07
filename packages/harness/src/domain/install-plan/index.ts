export {
  InstallPlan,
  type InstallPlanDraft,
  type InstallPlanSnapshot,
  type InstallPlanTransition,
  type PlanStatus
} from "./aggregate/install-plan.js";
export type { InvalidPlan } from "./errors/invalid-plan.js";
export type { PlanConflict } from "./errors/plan-conflict.js";
export type { PlanStale } from "./errors/plan-stale.js";
export { buildInstallPlan, type PlanRequest } from "./factories/build-install-plan.js";
export type { PlanEvidence } from "./policies/plan-invariants.js";
export { orderSteps } from "./policies/step-ordering.js";
export { preferredStrategy, STRATEGY_PREFERENCE } from "./policies/strategy-preference.js";
export {
  type ArtifactKind,
  type ArtifactLocator,
  isWithin,
  type LocatorKey,
  locatorKey,
  locatorProblem,
  locatorsOverlap
} from "./value-objects/artifact-locator.js";
export { type Conflict, CONFLICT_CHOICES, type ConflictChoice } from "./value-objects/conflict.js";
export type { DesiredArtifact } from "./value-objects/desired-artifact.js";
export type { InstallScope, InstallTarget } from "./value-objects/install-target.js";
export type { ObservedArtifact } from "./value-objects/observed-artifact.js";
export type { PlanBasis } from "./value-objects/plan-basis.js";
export { type PlanAction, type PlanStep, type Removal, touchesDisk } from "./value-objects/plan-step.js";
export type { Precondition } from "./value-objects/precondition.js";
export type { TrustPrompt, TrustPromptKind } from "./value-objects/trust-prompt.js";
