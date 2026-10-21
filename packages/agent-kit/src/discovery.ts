import { detectAgents as contextDetectAgents } from "@rivus/agent-kit-discovery/public";
import { discoveryTable } from "./providers/discovery.js";
import { identityTable } from "./providers/identity.js";
import type { ProviderOptions } from "./providers/types.js";

export {
  builtinProbeRecipes,
  classifyInstallation,
  DETECTION_STATUSES,
  resolveAuthState,
  versionFromOutput
} from "@rivus/agent-kit-discovery/public";
export type {
  AuthCommandProbe,
  AuthObservation,
  AuthProbe,
  AuthReading,
  AuthSource,
  AuthState,
  AuthVariable,
  CommandFailed,
  CommandOutput,
  CredentialFileFailed,
  CredentialFileProbe,
  DetectionStatus,
  DiscoveryErrorCode,
  DiscoveryPlatform,
  Evidence,
  EvidenceKind,
  Installation,
  InstallationKind,
  ProbePath,
  ProbeProblem,
  ProbeRecipe,
  ProbeRecipes,
  StatFailed,
  Version,
  VersionProbe
} from "@rivus/agent-kit-discovery/public";

export type DetectAgentsOptions = ProviderOptions<Parameters<typeof contextDetectAgents>[1]>;

export function detectAgents(
  platform: Parameters<typeof contextDetectAgents>[0],
  options: DetectAgentsOptions = {}
): ReturnType<typeof contextDetectAgents> {
  return contextDetectAgents(platform, {
    ...options,
    providers: { discovery: discoveryTable(options.providers), identity: identityTable(options.providers) }
  });
}
