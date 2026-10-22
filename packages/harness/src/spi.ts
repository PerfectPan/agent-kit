/** Interfaces and shared helpers for provider implementations. */
export {
  agentsOf,
  commandHook,
  configHome,
  groupedHooksFile,
  sharedAgentsDir,
  sharedSkillsDir
} from "./domain/bundle/services/install-files.js";
export { jsonText } from "./lib/json.js";
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
export { type OwnerSnapshot as Owner } from "./domain/bundle/value-objects/owner.js";
export { type Strategy } from "./domain/bundle/spi/strategy.js";
export {
  type ArtifactLocatorSnapshot as ArtifactLocator,
  locatorPointer
} from "./domain/install-plan/value-objects/artifact-locator.js";
export { type TrustPromptKind } from "./domain/install-plan/spi/trust-prompt.js";
export { type ArtifactContent } from "./domain/ledger/value-objects/content-hash.js";
export { type JsonValue } from "./lib/json.js";
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

export { canonicalContent, type ContentHash } from "./domain/ledger/value-objects/content-hash.js";
export {
  Ledger,
  LEDGER_SCHEMA_VERSION,
  type LedgerSnapshot,
  checkLedgerVersion
} from "./domain/ledger/aggregates/ledger.js";
export { type LedgerEntrySnapshot as LedgerEntry } from "./domain/ledger/entities/ledger-entry.js";
export { locatorKey, isWithin, locatorsOverlap } from "./domain/install-plan/value-objects/artifact-locator.js";
export {
  type PendingOperationSnapshot as PendingOperation,
  type StepOutcome
} from "./domain/ledger/entities/pending-operation.js";
export { buildInstallPlan } from "./application/services/build-install-plan.js";
export { type BundleSnapshot as Bundle } from "./domain/bundle/value-objects/bundle.js";
export { CONFLICT_CHOICES, type ConflictChoice } from "./domain/install-plan/value-objects/conflict.js";
export { type DesiredArtifact } from "./domain/install-plan/spi/desired-artifact.js";
export { isLegacyArtifact } from "./application/services/legacy-artifact.js";
export { type ObservedArtifact } from "./domain/install-plan/spi/observed-artifact.js";
export { type PreImage } from "./domain/ledger/value-objects/pre-image.js";
export { threeWayVerify } from "./domain/ledger/services/three-way-verify.js";
export { type VerifyStatus } from "./domain/ledger/value-objects/drift.js";
