import { lookupService } from "../services/service-table.js";
import type { BuiltinCodingAgentId, CodingAgent, CodingAgentWithHome } from "../index.js";

import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { cursor } from "./cursor.js";
import { geminiCli } from "./gemini-cli.js";
import { grok } from "./grok.js";
import { opencode } from "./opencode.js";
import { pi } from "./pi.js";

/** Each built-in identity; Cursor has no verified home rule. */
export const builtinCodingAgents: {
  readonly [Id in BuiltinCodingAgentId]: Id extends "cursor" ? CodingAgent : CodingAgentWithHome;
} = {
  "claude-code": claudeCode,
  codex,
  cursor,
  "gemini-cli": geminiCli,
  grok,
  opencode,
  pi
};

export function isBuiltinCodingAgentId(value: string): value is BuiltinCodingAgentId {
  return lookupService(value, builtinCodingAgents).ok;
}
