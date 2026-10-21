import { builtinInstallAdapters } from "@rivus/agent-kit-harness/public";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const installTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"install">> =>
  mergeService("install", builtinInstallAdapters, providers);
