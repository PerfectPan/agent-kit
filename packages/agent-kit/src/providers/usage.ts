import { builtinUsageDecoders } from "@rivus/agent-kit-sessions/public";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const usageTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"usage">> =>
  mergeService("usage", builtinUsageDecoders, providers);
