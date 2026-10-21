import { builtinUsageDecoders as contextBuiltins } from "@rivus/agent-kit-sessions/public";
import { piUsageDecoder } from "@rivus/agent-kit-provider-pi/usage";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

const builtinUsageDecoders: typeof contextBuiltins & { readonly pi: typeof piUsageDecoder } = {
  ...contextBuiltins,
  pi: piUsageDecoder
};

export const usageTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"usage">> =>
  mergeService("usage", builtinUsageDecoders, providers);
