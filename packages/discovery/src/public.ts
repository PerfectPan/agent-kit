// Use case
export { detectAgents, type DetectAgentsOptions } from "./application/use-cases/detect-agents.js";
export type { DiscoveryErrorCode } from "./application/errors.js";
export type { DiscoveryPlatform } from "./application/platform.js";

// Published language and rules
export {
  type AuthCommandProbe,
  type AuthProbe,
  type AuthVariable,
  type CredentialFileProbe,
  type InstallationKind,
  type ProbePath,
  type ProbeRecipe,
  type ProbeRecipes,
  type VersionProbe
} from "./domain/installation/spi/probe-recipe.js";
export {
  type AuthObservation,
  type AuthReading,
  type AuthSource,
  type AuthState
} from "./domain/installation/value-objects/auth-state.js";
export { classifyInstallation } from "./domain/installation/policies/classify-installation.js";
export {
  type CommandFailed,
  type CredentialFileFailed,
  type ProbeProblem,
  type StatFailed
} from "./domain/installation/value-objects/probe-problem.js";
export { type CommandOutput, type Version, versionFromOutput } from "./domain/installation/value-objects/version.js";
export { DETECTION_STATUSES, type DetectionStatus } from "./domain/installation/value-objects/detection-status.js";
export { type Evidence, type EvidenceKind } from "./domain/installation/value-objects/evidence.js";
export { type Installation } from "./domain/installation/value-objects/installation.js";
export { resolveAuthState } from "./domain/installation/policies/resolve-auth-state.js";

export { expandProbePath } from "./application/services/host-paths.js";
