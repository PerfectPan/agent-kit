import { geminiCliAcpProfile } from "@rivus/agent-kit-provider-gemini-cli/acp";
import { builtinAcpProfiles as contextBuiltins } from "@rivus/agent-kit-acp/public";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinAcpProfiles: typeof contextBuiltins = {
  "claude-code": contextBuiltins["claude-code"],
  codex: contextBuiltins.codex,
  "gemini-cli": geminiCliAcpProfile,
  grok: contextBuiltins.grok,
  opencode: contextBuiltins.opencode
};

export const acpTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"acp">> =>
  mergeService("acp", builtinAcpProfiles, providers);
