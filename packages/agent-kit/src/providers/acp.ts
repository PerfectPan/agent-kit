import { builtinAcpProfiles } from "@rivus/agent-kit-acp/public";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const acpTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"acp">> =>
  mergeService("acp", builtinAcpProfiles, providers);
