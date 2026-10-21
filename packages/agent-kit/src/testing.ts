import {
  hookDialectConformance as contextHookDialectConformance,
  probeRecipeConformance as contextProbeRecipeConformance
} from "@rivus/agent-kit-testing/public";
import { hooksTable } from "./providers/hooks.js";
import { identityTable } from "./providers/identity.js";
import type { Provider } from "./providers/types.js";

export { createMemoryPlatform, oversizedSession, sessionAdapterConformance } from "@rivus/agent-kit-testing/public";
export type {
  ConformanceCheck,
  ConformanceSession,
  HookDialectFixtures,
  HookDialectSample,
  MemoryCommand,
  MemoryFile,
  MemoryPlatform,
  MemoryPlatformOptions,
  MemoryRunResult,
  ProbeRecipeSamples,
  SessionAdapterFixtures
} from "@rivus/agent-kit-testing/public";

export function hookDialectConformance(
  dialect: Parameters<typeof contextHookDialectConformance>[0],
  fixtures: Parameters<typeof contextHookDialectConformance>[1],
  options: { readonly providers?: readonly Provider[] } = {}
): ReturnType<typeof contextHookDialectConformance> {
  return contextHookDialectConformance(dialect, fixtures, hooksTable(options.providers));
}

export function probeRecipeConformance(
  recipe: Parameters<typeof contextProbeRecipeConformance>[0],
  samples: Parameters<typeof contextProbeRecipeConformance>[1] = {},
  options: { readonly providers?: readonly Provider[] } = {}
): ReturnType<typeof contextProbeRecipeConformance> {
  return contextProbeRecipeConformance(recipe, samples, identityTable(options.providers));
}
