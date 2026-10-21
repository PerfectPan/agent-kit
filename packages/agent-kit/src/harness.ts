export { builtinInstallAdapters } from "./providers/install.js";
import { planInstall as contextPlanInstall } from "@rivus/agent-kit-harness/public";
import { findLegacy as contextFindLegacy } from "@rivus/agent-kit-harness/public";
import { verify as contextVerify } from "@rivus/agent-kit-harness/public";
import { uninstall as contextUninstall } from "@rivus/agent-kit-harness/public";
import { doctor as contextDoctor } from "@rivus/agent-kit-harness/public";
import { installTable } from "./providers/install.js";
import { hooksTable } from "./providers/hooks.js";
import { identityTable } from "./providers/identity.js";
import type { ProviderOptions } from "./providers/types.js";

export {
  AgentCli,
  applyInstall,
  ArtifactFiles,
  ChezmoiExternalOwnerLive,
  CONFLICT_CHOICES,
  discardPlan,
  ExternalOwner,
  FileLedgerRepositoryLive,
  HarnessLive,
  inventory,
  LedgerLock,
  LedgerRepository,
  locatorKey,
  ownerSlug,
  PlatformArtifactFilesLive,
  ProcessAgentCliLive,
  SqliteLedgerLockLive
} from "@rivus/agent-kit-harness/public";
export type {
  AgentCliFailure,
  AgentCliShape,
  AgentCommand,
  AppliedStep,
  ApplyFailed,
  ApplyInstallError,
  ApplyInstallOptions,
  ApplyReport,
  ArtifactContent,
  ArtifactFailure,
  ArtifactFilesShape,
  ArtifactInstalled,
  ArtifactIoFailure,
  ArtifactKind,
  ArtifactLocator,
  ArtifactRead,
  ArtifactRemoved,
  ArtifactSource,
  ArtifactSpec,
  Bundle,
  BundleRef,
  Check,
  CliRegistration,
  CommandLine,
  Conflict,
  ConflictChoice,
  ContentHash,
  DocumentInvalid,
  FindLegacyError,
  FindLegacyServices,
  Drift,
  DroppedHook,
  EntryChange,
  ExternalOwnerShape,
  HarnessServices,
  HookCompat,
  HookOverlap,
  HookRegistration,
  HookSpec,
  HookSpecRejected,
  InstallAdapter,
  InstallAdapters,
  InstallContext,
  InstallPlan,
  InstallScope,
  InstructionSpec,
  InvalidBundle,
  InvalidHookPlacement,
  InvalidLedger,
  InvalidPlan,
  Inventory,
  JsonValue,
  LedgerBusy,
  LedgerEntry,
  LedgerEvent,
  LedgerLockError,
  LedgerLockFailure,
  LedgerLockOptions,
  LedgerLockShape,
  LedgerLockUnavailable,
  LedgerReadError,
  LedgerRepositoryFailure,
  LedgerRepositoryShape,
  LedgerScope,
  LedgerVersionUnsupported,
  LegacyEntry,
  LegacyTreatment,
  LocatorKey,
  McpServerSpec,
  Owner,
  PendingOperation,
  PendingOperations,
  PlacedRegistration,
  PlanAction,
  PlanBasis,
  PlanConflict,
  PlanInstallError,
  PlannedCommand,
  PlannedFileChange,
  PlanStale,
  PlanStatus,
  PlanStep,
  Precondition,
  PreImage,
  Removal,
  RenderedArtifact,
  RevisionConflict,
  ScopeOptions,
  SkillSpec,
  StepNote,
  Strategy,
  StrategyUnavailable,
  TargetChanged,
  TrustPrompt,
  TrustPromptKind,
  UnexpectedShape,
  UninstallError,
  UninstallReport,
  VerifiedArtifact,
  VerifyError,
  VerifyReport,
  VerifyStatus
} from "@rivus/agent-kit-harness/public";

export type PlanInstallOptions = ProviderOptions<Parameters<typeof contextPlanInstall>[1]>;

export function planInstall(
  bundle: Parameters<typeof contextPlanInstall>[0],
  options: PlanInstallOptions
): ReturnType<typeof contextPlanInstall> {
  if (options.providers !== undefined) {
    identityTable(options.providers);
  }
  return contextPlanInstall(bundle, {
    ...options,
    providers: {
      install: installTable(options.providers),
      hooks: hooksTable(options.providers)
    }
  });
}

export type FindLegacyOptions = ProviderOptions<Parameters<typeof contextFindLegacy>[1]>;

export function findLegacy(
  owner: Parameters<typeof contextFindLegacy>[0],
  options: FindLegacyOptions
): ReturnType<typeof contextFindLegacy> {
  if (options.providers !== undefined) {
    identityTable(options.providers);
  }
  return contextFindLegacy(owner, {
    ...options,
    providers: {
      install: installTable(options.providers),
      hooks: hooksTable(options.providers)
    }
  });
}

export type VerifyOptions = ProviderOptions<Parameters<typeof contextVerify>[1]>;

export function verify(
  owner: Parameters<typeof contextVerify>[0],
  options: VerifyOptions = {}
): ReturnType<typeof contextVerify> {
  if (options.providers !== undefined) {
    identityTable(options.providers);
  }
  return contextVerify(owner, {
    ...options,
    providers: {
      install: installTable(options.providers),
      hooks: hooksTable(options.providers)
    }
  });
}

export type UninstallOptions = ProviderOptions<Parameters<typeof contextUninstall>[1]>;

export function uninstall(
  owner: Parameters<typeof contextUninstall>[0],
  options: UninstallOptions = {}
): ReturnType<typeof contextUninstall> {
  if (options.providers !== undefined) {
    identityTable(options.providers);
  }
  return contextUninstall(owner, {
    ...options,
    providers: {
      install: installTable(options.providers),
      hooks: hooksTable(options.providers)
    }
  });
}

export type DoctorOptions = ProviderOptions<Parameters<typeof contextDoctor>[0]>;

export function doctor(options: DoctorOptions = {}): ReturnType<typeof contextDoctor> {
  if (options.providers !== undefined) {
    identityTable(options.providers);
  }
  return contextDoctor({
    ...options,
    providers: {
      install: installTable(options.providers),
      hooks: hooksTable(options.providers)
    }
  });
}
