import type { ServiceTable } from "@rivus/agent-kit-catalog";

import type { AcpProfile } from "../index.js";
import { claudeCodeAcpProfile } from "./claude-code.js";
import { codexAcpProfile } from "./codex.js";
import { geminiCliAcpProfile } from "./gemini-cli.js";
import { grokAcpProfile } from "./grok.js";
import { opencodeAcpProfile } from "./opencode.js";

export type AcpProfiles = ServiceTable<AcpProfile>;

/** The agents `connectAgent` can launch by id. A shell caller adds or overrides one through `providers` descriptors with an `acp` service. */
export const builtinAcpProfiles: AcpProfiles = {
  "claude-code": claudeCodeAcpProfile,
  codex: codexAcpProfile,
  "gemini-cli": geminiCliAcpProfile,
  grok: grokAcpProfile,
  opencode: opencodeAcpProfile
};
