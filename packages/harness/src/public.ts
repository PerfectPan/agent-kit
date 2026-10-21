// The `@rivus/agent-kit/harness` entry: Effect use cases, their ports and Layers, and the plain data they exchange.
// The hook path imports `events.ts` instead, which reaches none of this.
export {
  type AppliedStep,
  applyInstall,
  type ApplyInstallError,
  type ApplyInstallOptions,
  type ApplyReport
} from "./application/use-cases/apply-install.js";
export { type Check, doctor, type DoctorOptions } from "./application/use-cases/doctor.js";
export {
  type FindLegacyError,
  type FindLegacyOptions,
  type FindLegacyServices,
  findLegacy,
  type LegacyEntry
} from "./application/use-cases/find-legacy.js";
export type { ApplyFailed, StrategyUnavailable, TargetChanged } from "./application/errors.js";
export type {
  DroppedHook,
  InstallPlan,
  PlannedCommand,
  PlannedFileChange
} from "./application/services/install-plan-handle.js";
export { discardPlan, type Inventory, inventory } from "./application/use-cases/inventory.js";
export type { ScopeOptions } from "./application/services/ledger-scope.js";
export type { LedgerLockError, LedgerReadError } from "./application/services/ledger-session.js";
export {
  type HarnessServices,
  planInstall,
  type PlanInstallError,
  type PlanInstallOptions
} from "./application/use-cases/plan-install.js";
export {
  AgentCli,
  type AgentCliFailure,
  type AgentCliShape,
  type AgentCommand,
  type ArtifactFailure,
  ArtifactFiles,
  type ArtifactFilesShape,
  type ArtifactIoFailure,
  type ArtifactRead,
  type DocumentInvalid,
  type EntryChange,
  ExternalOwner,
  type ExternalOwnerShape,
  LedgerLock,
  type LedgerLockFailure,
  type LedgerLockOptions,
  type LedgerLockShape,
  type LedgerLockUnavailable,
  LedgerRepository,
  type LedgerRepositoryFailure,
  type LedgerRepositoryShape,
  type LedgerScope,
  type RevisionConflict,
  type UnexpectedShape
} from "./application/ports.js";
export {
  uninstall,
  type UninstallError,
  type UninstallOptions,
  type UninstallReport
} from "./application/use-cases/uninstall.js";
export {
  verify,
  type VerifiedArtifact,
  type VerifyError,
  type VerifyOptions,
  type VerifyReport
} from "./application/use-cases/verify.js";
export { ChezmoiExternalOwnerLive } from "./infra/adapters/chezmoi-external-owner.js";
export { FileLedgerRepositoryLive } from "./infra/repository/file-ledger-repository.js";
export { HarnessLive } from "./infra/factories/harness-live.js";
export { PlatformArtifactFilesLive } from "./infra/adapters/platform-artifact-files.js";
export { ProcessAgentCliLive } from "./infra/adapters/process-agent-cli.js";
export { SqliteLedgerLockLive } from "./infra/adapters/sqlite-ledger-lock.js";
export {
  type ArtifactSource,
  type CliRegistration,
  type CommandLine,
  type InstallAdapter,
  type InstallAdapters,
  type InstallContext,
  ownerSlug,
  type RenderedArtifact
} from "./domain/bundle/spi/install-adapter.js";
export {
  type ArtifactSpec,
  type HookSpec,
  type InstructionSpec,
  type McpServerSpec,
  type SkillSpec
} from "./domain/bundle/value-objects/artifact-spec.js";
export { type Bundle, type BundleRef, type InvalidBundle } from "./domain/bundle/value-objects/bundle.js";
export {
  type HookCompat,
  type HookRegistration,
  type HookSpecRejected
} from "./domain/bundle/services/hook-registrations.js";
export {
  type HookOverlap,
  type InvalidHookPlacement,
  type PlacedRegistration
} from "./domain/bundle/services/hook-placement.js";
export { type Owner } from "./domain/bundle/value-objects/owner.js";
export { type Strategy } from "./domain/bundle/value-objects/strategy.js";
export {
  type ArtifactKind,
  type ArtifactLocator,
  type LocatorKey,
  locatorKey
} from "./domain/install-plan/value-objects/artifact-locator.js";
export { type Conflict, CONFLICT_CHOICES, type ConflictChoice } from "./domain/install-plan/value-objects/conflict.js";
export { type InstallScope } from "./domain/install-plan/value-objects/install-target.js";
export { type InvalidPlan } from "./domain/install-plan/errors/invalid-plan.js";
export { type LegacyTreatment } from "./domain/install-plan/policies/legacy-ownership.js";
export {
  type PlanAction,
  type PlanStep,
  type Removal,
  type StepNote
} from "./domain/install-plan/value-objects/plan-step.js";
export { type PlanBasis } from "./domain/install-plan/value-objects/plan-basis.js";
export { type PlanConflict } from "./domain/install-plan/errors/plan-conflict.js";
export { type PlanStale } from "./domain/install-plan/errors/plan-stale.js";
export { type PlanStatus } from "./domain/install-plan/aggregates/install-plan.js";
export { type Precondition } from "./domain/install-plan/value-objects/precondition.js";
export { type TrustPrompt, type TrustPromptKind } from "./domain/install-plan/value-objects/trust-prompt.js";
export type { ArtifactContent, ContentHash, JsonValue } from "./domain/ledger/value-objects/content-hash.js";
export type { ArtifactInstalled } from "./domain/ledger/events/artifact-installed.js";
export type { ArtifactRemoved } from "./domain/ledger/events/artifact-removed.js";
export type { Drift, VerifyStatus } from "./domain/ledger/value-objects/drift.js";
export type { InvalidLedger } from "./domain/ledger/errors/invalid-ledger.js";
export type { LedgerBusy } from "./domain/ledger/errors/ledger-busy.js";
export type { LedgerEntrySnapshot as LedgerEntry } from "./domain/ledger/entities/ledger-entry.js";
export type { LedgerEvent } from "./domain/ledger/aggregates/ledger.js";
export type { LedgerVersionUnsupported } from "./domain/ledger/errors/ledger-version-unsupported.js";
export type { PendingOperationSnapshot as PendingOperation } from "./domain/ledger/entities/pending-operation.js";
export type { PendingOperations } from "./domain/ledger/errors/pending-operations.js";
export type { PreImage } from "./domain/ledger/value-objects/pre-image.js";
