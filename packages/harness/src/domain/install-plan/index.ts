export {
  InstallPlan,
  type InstallPlanDraft,
  type InstallPlanSnapshot,
  type InstallPlanTransition,
  type PlanStatus
} from "./aggregates/install-plan.js";
export type { InvalidPlan } from "./errors/invalid-plan.js";
export type { PlanConflict } from "./errors/plan-conflict.js";
export { planClosedError, type PlanStale } from "./errors/plan-stale.js";
export type { StrategyUnavailable } from "./errors/strategy-unavailable.js";
export { buildInstallPlan, type PlanRequest } from "./factories/build-install-plan.js";
export { type LegacyHookSource, planEvidenceScope, type PlanEvidenceScope } from "./factories/plan-evidence-scope.js";
export type { PlanEvidence } from "./policies/plan-invariants.js";
export { type ForeignHookObservation } from "./policies/legacy-ownership.js";
export {
  type RegistrationCommands,
  registrationCommands,
  type RegistrationPurpose
} from "./policies/registration-commands.js";
export { orderSteps } from "./policies/step-ordering.js";
export {
  chooseStrategy,
  requiredCommands,
  type StrategyArtifactKind,
  type StrategyChoice,
  type StrategyRequirement,
  strategyRequirement,
  strategyUnsupported
} from "./policies/strategy-choice.js";
export {
  type ArtifactKind,
  type ArtifactLocator,
  isWithin,
  type LocatorKey,
  locatorKey,
  locatorPointer,
  locatorProblem,
  locatorsOverlap,
  pointerTail
} from "./value-objects/artifact-locator.js";
export { type Conflict, CONFLICT_CHOICES, type ConflictChoice } from "./value-objects/conflict.js";
export { contentAfterStep, type StepContentAfter } from "./value-objects/content-after.js";
export type { DesiredArtifact } from "./value-objects/desired-artifact.js";
export type { InstallScope, InstallTarget } from "./value-objects/install-target.js";
export { isBrokenSymlink, type ObservedArtifact } from "./value-objects/observed-artifact.js";
export { type PlanBasis } from "./value-objects/plan-basis.js";
export { type PlanAction, type PlanStep, type Removal, type StepNote, touchesDisk } from "./value-objects/plan-step.js";
export { preconditionHolds, type Precondition } from "./value-objects/precondition.js";
export type { TrustPrompt, TrustPromptKind } from "./value-objects/trust-prompt.js";
