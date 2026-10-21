import { BUILTIN_CODING_AGENT_IDS } from "../value-objects/coding-agent-id.js";
import type { BuiltinCodingAgentId, CodingAgent, CodingAgentWithHome } from "../index.js";

import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { cursor } from "./cursor.js";
import { geminiCli } from "./gemini-cli.js";
import { grok } from "./grok.js";
import { opencode } from "./opencode.js";

/** Each built-in identity; Cursor has no verified home rule. */
export const builtinCodingAgents: {
  readonly [Id in Exclude<BuiltinCodingAgentId, "pi">]: Id extends "cursor" ? CodingAgent : CodingAgentWithHome;
} = {
  "claude-code": claudeCode,
  codex,
  cursor,
  "gemini-cli": geminiCli,
  grok,
  opencode
};

export function isBuiltinCodingAgentId(value: string): value is BuiltinCodingAgentId {
  return BUILTIN_CODING_AGENT_IDS.some((id) => id === value);
}
