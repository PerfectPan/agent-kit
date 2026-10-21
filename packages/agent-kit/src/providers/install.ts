import { builtinInstallAdapters as contextBuiltins } from "@rivus/agent-kit-harness/public";
import { piInstallAdapter } from "@rivus/agent-kit-provider-pi/install";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinInstallAdapters: typeof contextBuiltins & { readonly pi: typeof piInstallAdapter } = {
  ...contextBuiltins,
  pi: piInstallAdapter
};

export const installTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"install">> =>
  mergeService("install", builtinInstallAdapters, providers);
