/** Interfaces and shared helpers for provider implementations. */
export { lenient } from "./domain/installation/adapters/lenient.js";
export { VERSION_FLAG } from "./domain/installation/adapters/version-flag.js";
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
export { type AuthReading } from "./domain/installation/value-objects/auth-state.js";
export { type CommandOutput, type Version, versionFromOutput } from "./domain/installation/value-objects/version.js";
