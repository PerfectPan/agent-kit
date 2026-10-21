import { builtinProbeRecipes } from "@rivus/agent-kit-discovery/public";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const discoveryTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"discovery">> =>
  mergeService("discovery", builtinProbeRecipes, providers);
