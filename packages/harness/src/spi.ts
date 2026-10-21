/** Interfaces and shared helpers for provider implementations. */
export {
  agentsOf,
  commandHook,
  configHome,
  groupedHooksFile,
  jsonText,
  sharedAgentsDir,
  sharedSkillsDir
} from "./domain/bundle/adapters/install-files.js";
export { type PlacedRegistration } from "./domain/bundle/services/hook-placement.js";
export { type HookRegistration } from "./domain/bundle/services/hook-registrations.js";
export {
  type ArtifactSource,
  type CliRegistration,
  type CommandLine,
  type HookSource,
  type InstallAdapter,
  type InstallContext,
  type RenderedArtifact,
  ownerSlug
} from "./domain/bundle/spi/install-adapter.js";
export { type SkillSpec } from "./domain/bundle/value-objects/artifact-spec.js";
export { type BundleRef } from "./domain/bundle/value-objects/bundle.js";
export { type Owner } from "./domain/bundle/value-objects/owner.js";
export { type Strategy } from "./domain/bundle/value-objects/strategy.js";
export { type ArtifactLocator, locatorPointer } from "./domain/install-plan/value-objects/artifact-locator.js";
export { type TrustPromptKind } from "./domain/install-plan/value-objects/trust-prompt.js";
export { type ArtifactContent, type JsonValue } from "./domain/ledger/value-objects/content-hash.js";
export {
  type FieldPath,
  type FieldSource,
  type FinishSelector,
  type ForeignHooks,
  type HookDialect,
  type HostMarkers,
  type HookEventSpec,
  type HookOutput,
  type HookTimeout,
  type LifecycleSwitch,
  type PayloadFields,
  aliasesOf,
  finishSelectorsOf
} from "./domain/lifecycle/spi/hook-dialect.js";
export { type LifecycleMapping } from "./domain/lifecycle/value-objects/lifecycle-event.js";

export { canonicalContent, type ContentHash, isContentHash } from "./domain/ledger/value-objects/content-hash.js";
export {
  Ledger,
  LEDGER_SCHEMA_VERSION,
  type LedgerSnapshot,
  checkLedgerVersion,
  type BeginContext,
  type LedgerRecovery,
  type LedgerTransition
} from "./domain/ledger/aggregates/ledger.js";
export { type LedgerEntry } from "./domain/ledger/entities/ledger-entry.js";
export {
  locatorKey,
  isWithin,
  locatorsOverlap,
  locatorProblem,
  pointerTail
} from "./domain/install-plan/value-objects/artifact-locator.js";
export {
  type PendingOperation,
  type StepOutcome,
  type PendingProbe,
  type PendingResolution
} from "./domain/ledger/entities/pending-operation.js";
export { buildInstallPlan, type PlanRequest } from "./domain/install-plan/factories/build-install-plan.js";
export { type Bundle, checkBundle, checkOwnerMarkers, legacyMarkersOf } from "./domain/bundle/value-objects/bundle.js";
export { CONFLICT_CHOICES, type ConflictChoice } from "./domain/install-plan/value-objects/conflict.js";
export { type DesiredArtifact } from "./domain/install-plan/value-objects/desired-artifact.js";
export { isLegacyArtifact } from "./domain/bundle/policies/legacy-markers.js";
export { type ObservedArtifact, isBrokenSymlink } from "./domain/install-plan/value-objects/observed-artifact.js";
export { type PreImage } from "./domain/ledger/value-objects/pre-image.js";
export {
  threeWayVerify,
  markAcknowledged,
  type VerifyInput,
  verifyOwner
} from "./domain/ledger/policies/three-way-verify.js";
export { type VerifyStatus } from "./domain/ledger/value-objects/drift.js";
export {
  droppedHooksOf,
  type HookPlacement,
  type HookPlacementOptions,
  type PlacedHooks,
  placeHooks
} from "./domain/bundle/services/hook-placement.js";
export {
  type ForeignHookFile,
  foreignHookFiles,
  foreignHooksIn,
  type HookRegistrationOptions,
  hookRegistrations,
  runnersOf
} from "./domain/bundle/services/hook-registrations.js";
export {
  type InstalledCopyRead,
  ownRecordOf,
  registrationContent,
  registrationLinkMismatch
} from "./domain/bundle/value-objects/registration-state.js";
export { OWNER_PATTERN } from "./domain/bundle/value-objects/owner.js";
export {
  type InstallPlanDraft,
  type InstallPlanSnapshot,
  type InstallPlanTransition
} from "./domain/install-plan/aggregates/install-plan.js";
export { planClosedError } from "./domain/install-plan/errors/plan-stale.js";
export {
  type LegacyHookSource,
  planEvidenceScope,
  type PlanEvidenceScope
} from "./domain/install-plan/factories/plan-evidence-scope.js";
export { type PlanEvidence } from "./domain/install-plan/policies/plan-invariants.js";
export { type ForeignHookObservation, legacyTreatment } from "./domain/install-plan/policies/legacy-ownership.js";
export {
  type RegistrationCommands,
  registrationCommands,
  type RegistrationPurpose
} from "./domain/install-plan/policies/registration-commands.js";
export { orderSteps } from "./domain/install-plan/policies/step-ordering.js";
export {
  chooseStrategy,
  requiredCommands,
  type StrategyArtifactKind,
  type StrategyChoice,
  type StrategyRequirement,
  strategyRequirement,
  strategyUnsupported
} from "./domain/install-plan/policies/strategy-choice.js";
export { contentAfterStep, type StepContentAfter } from "./domain/install-plan/value-objects/content-after.js";
export { type InstallTarget } from "./domain/install-plan/value-objects/install-target.js";
export { touchesDisk } from "./domain/install-plan/value-objects/plan-step.js";
export { preconditionHolds } from "./domain/install-plan/value-objects/precondition.js";
export { holds, release, unionAgents } from "./domain/ledger/policies/ownership.js";
export { reconcilePending } from "./domain/ledger/policies/reconcile.js";
export { type KeptArtifact } from "./domain/ledger/entities/kept-artifact.js";
