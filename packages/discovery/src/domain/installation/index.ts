export { appBundleMatches } from "./policies/app-bundle.js";
export { classifyInstallation } from "./policies/classify-installation.js";
export { installationWarnings } from "./policies/installation-warnings.js";
export { envReading, probesAuth, resolveAuthState } from "./policies/resolve-auth-state.js";
export type { AuthObservation, AuthReading, AuthSource, AuthState } from "./value-objects/auth-state.js";
export { DETECTION_STATUSES, type DetectionStatus } from "./value-objects/detection-status.js";
export type { Evidence, EvidenceKind } from "./value-objects/evidence.js";
export type { Installation } from "./value-objects/installation.js";
export type { CommandFailed, CredentialFileFailed, ProbeProblem, StatFailed } from "./value-objects/probe-problem.js";
export type {
  AuthCommandProbe,
  AuthProbe,
  AuthVariable,
  CredentialFileProbe,
  InstallationKind,
  ProbePath,
  ProbeRecipe,
  ProbeRecipes,
  VersionProbe
} from "./value-objects/probe-recipe.js";
export { type CommandOutput, type Version, versionFromOutput } from "./value-objects/version.js";
