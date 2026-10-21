import { builtinCodingAgents as contextBuiltins, validateIdentities } from "@rivus/agent-kit-catalog/public";
import { pi } from "@rivus/agent-kit-provider-pi/identity";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinCodingAgents: typeof contextBuiltins & { readonly pi: typeof pi } = { ...contextBuiltins, pi: pi };

export const identityTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"identity">> => {
  const table = mergeService("identity", builtinCodingAgents, providers);
  validateIdentities(table);
  return table;
};
