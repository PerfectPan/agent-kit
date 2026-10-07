export { isLegacyArtifact } from "./policies/legacy-markers.js";
export {
  type HookOverlap,
  type HookPlacement,
  type HookPlacementOptions,
  type InvalidHookPlacement,
  type PlacedHooks,
  type PlacedRegistration,
  placeHooks
} from "./services/hook-placement.js";
export {
  foreignHooksIn,
  type HookCompat,
  type HookRegistration,
  type HookRegistrationOptions,
  hookRegistrations,
  type HookSpecRejected,
  runnersOf
} from "./services/hook-registrations.js";
export type {
  ArtifactSpec,
  HookSpec,
  InstructionSpec,
  McpServerSpec,
  SkillSpec
} from "./value-objects/artifact-spec.js";
export { type Bundle, type BundleRef, checkBundle, type InvalidBundle } from "./value-objects/bundle.js";
export { type Owner, OWNER_PATTERN } from "./value-objects/owner.js";
export type { Strategy } from "./value-objects/strategy.js";
