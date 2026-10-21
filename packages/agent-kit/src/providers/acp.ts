import type { AcpProfiles } from "@rivus/agent-kit-acp/public";
import { codexAcpProfile } from "@rivus/agent-kit-provider-codex/acp";
import { claudeCodeAcpProfile } from "@rivus/agent-kit-provider-claude-code/acp";
import { grokAcpProfile } from "@rivus/agent-kit-provider-grok/acp";
import { opencodeAcpProfile } from "@rivus/agent-kit-provider-opencode/acp";
import { geminiCliAcpProfile } from "@rivus/agent-kit-provider-gemini-cli/acp";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinAcpProfiles: AcpProfiles = {
  "claude-code": claudeCodeAcpProfile,
  codex: codexAcpProfile,
  "gemini-cli": geminiCliAcpProfile,
  grok: grokAcpProfile,
  opencode: opencodeAcpProfile
};

export const acpTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"acp">> =>
  mergeService("acp", builtinAcpProfiles, providers);
