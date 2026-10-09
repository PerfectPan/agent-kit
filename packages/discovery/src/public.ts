// Use case
export { detectAgents, type DetectAgentsOptions } from "./application/use-cases/detect-agents.js";
export type { DiscoveryErrorCode } from "./application/errors.js";
export type { DiscoveryPlatform } from "./application/ports.js";

// Probe recipes
export { builtinProbeRecipes } from "./domain/installation/adapters/index.js";

// Published language and rules
export {
  type AuthCommandProbe,
  type AuthObservation,
  type AuthProbe,
  type AuthReading,
  type AuthSource,
  type AuthState,
  type AuthVariable,
  classifyInstallation,
  type CommandFailed,
  type CommandOutput,
  type CredentialFileFailed,
  type CredentialFileProbe,
  DETECTION_STATUSES,
  type DetectionStatus,
  type Evidence,
  type EvidenceKind,
  type Installation,
  type InstallationKind,
  type ProbePath,
  type ProbeProblem,
  type ProbeRecipe,
  type ProbeRecipes,
  resolveAuthState,
  type StatFailed,
  type Version,
  versionFromOutput,
  type VersionProbe
} from "./domain/installation/index.js";
