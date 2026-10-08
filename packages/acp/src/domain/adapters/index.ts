import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { AcpProfile } from "../acp-session/index.js";
import { claudeCodeAcpProfile } from "./claude-code.js";
import { codexAcpProfile } from "./codex.js";
import { geminiCliAcpProfile } from "./gemini-cli.js";
import { grokAcpProfile } from "./grok.js";
import { opencodeAcpProfile } from "./opencode.js";

export type AcpProfiles = Readonly<Partial<Record<CodingAgentId, AcpProfile>>>;

/** The agents `connectAgent` can launch by id. A caller adds or overrides one through `profiles`. */
export const builtinAcpProfiles: AcpProfiles = {
  "claude-code": claudeCodeAcpProfile,
  codex: codexAcpProfile,
  "gemini-cli": geminiCliAcpProfile,
  grok: grokAcpProfile,
  opencode: opencodeAcpProfile
};
