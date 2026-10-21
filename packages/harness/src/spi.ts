/** Interfaces and shared helpers for provider implementations. */
export {
  agentsOf,
  commandHook,
  configHome,
  groupedHooksFile,
  jsonText,
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
  type HookEventSpec,
  type HookOutput,
  type HookTimeout,
  type LifecycleSwitch,
  type PayloadFields,
  aliasesOf,
  finishSelectorsOf
} from "./domain/lifecycle/spi/hook-dialect.js";
export { type LifecycleMapping } from "./domain/lifecycle/value-objects/lifecycle-event.js";
