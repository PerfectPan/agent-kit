import { detectAgents as contextDetectAgents } from "@rivus/agent-kit-discovery/public";
import { discoveryTable } from "./providers/discovery.js";
import { identityTable } from "./providers/identity.js";
import type { ProviderOptions } from "./providers/types.js";

export { versionFromOutput } from "@rivus/agent-kit-discovery/public";
export type {
  AuthReading,
  CommandOutput,
  Installation,
  ProbePath,
  ProbeProblem,
  ProbeRecipe,
  ProbeRecipes
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
