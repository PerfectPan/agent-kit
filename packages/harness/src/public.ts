// The `@rivus/agent-kit/harness` entry: Effect use cases, their ports and Layers, and the plain data they exchange.
// The hook path imports `events.ts` instead, which reaches none of this.
export { builtinInstallAdapters } from "./agents/install-adapters.js";
export {
  type AppliedStep,
  applyInstall,
  type ApplyInstallError,
  type ApplyInstallOptions,
  type ApplyReport
} from "./application/apply-install.js";
export { type Check, doctor, type DoctorOptions } from "./application/doctor.js";
export type { ApplyFailed, StrategyUnavailable, TargetChanged } from "./application/errors.js";
export type { DroppedHook, InstallPlan, PlannedCommand, PlannedFileChange } from "./application/install-plan-handle.js";
export { discardPlan, type Inventory, inventory } from "./application/inventory.js";
export type { ScopeOptions } from "./application/ledger-scope.js";
export type { LedgerLockError, LedgerReadError } from "./application/ledger-session.js";
export {
  type HarnessServices,
  planInstall,
  type PlanInstallError,
  type PlanInstallOptions
} from "./application/plan-install.js";
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
  type LedgerScope,
  LedgerStore,
  type LedgerStoreFailure,
  type LedgerStoreShape,
  type UnexpectedShape
} from "./application/ports.js";
export {
  uninstall,
  type UninstallError,
  type UninstallOptions,
  type UninstallReport
} from "./application/uninstall.js";
export {
  verify,
  type VerifiedArtifact,
  type VerifyError,
  type VerifyOptions,
  type VerifyReport
} from "./application/verify.js";
export { ChezmoiExternalOwnerLive } from "./adapters/chezmoi-external-owner.js";
export { FileLedgerStoreLive } from "./adapters/file-ledger-store.js";
export { HarnessLive } from "./adapters/harness-live.js";
export { PlatformArtifactFilesLive } from "./adapters/platform-artifact-files.js";
export { ProcessAgentCliLive } from "./adapters/process-agent-cli.js";
export { SqliteLedgerLockLive } from "./adapters/sqlite-ledger-lock.js";
export {
  type ArtifactSource,
  type ArtifactSpec,
  type Bundle,
  type BundleRef,
  type CliRegistration,
  type CommandLine,
  type HookCompat,
  type HookOverlap,
  type HookRegistration,
  type HookSpec,
  type HookSpecRejected,
  type InstallAdapter,
  type InstallAdapters,
  type InstallContext,
  type InstructionSpec,
  type InvalidBundle,
  type InvalidHookPlacement,
  type McpServerSpec,
  type Owner,
  ownerSlug,
  type PlacedRegistration,
  type RenderedArtifact,
  type SkillSpec,
  type Strategy
} from "./domain/bundle/index.js";
export {
  type ArtifactKind,
  type ArtifactLocator,
  type Conflict,
  CONFLICT_CHOICES,
  type ConflictChoice,
  type InstallScope,
  type InvalidPlan,
  type LocatorKey,
  locatorKey,
  type PlanAction,
  type PlanBasis,
  type PlanConflict,
  type PlanStale,
  type PlanStatus,
  type PlanStep,
  type Precondition,
  type Removal,
  type StepNote,
  type TrustPrompt,
  type TrustPromptKind
} from "./domain/install-plan/index.js";
export type {
  ArtifactContent,
  ArtifactInstalled,
  ArtifactRemoved,
  ContentHash,
  Drift,
  InvalidLedger,
  JsonValue,
  LedgerBusy,
  LedgerEntry,
  LedgerEvent,
  LedgerVersionUnsupported,
  PendingOperation,
  PendingOperations,
  PreImage,
  VerifyStatus
} from "./domain/ledger/index.js";
