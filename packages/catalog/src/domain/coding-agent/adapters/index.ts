import { BUILTIN_CODING_AGENT_IDS } from "../value-objects/coding-agent-id.js";
import type { BuiltinCodingAgentId, CodingAgentWithHome } from "../index.js";

import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { grok } from "./grok.js";
import { opencode } from "./opencode.js";

/** Built-in identities still owned by catalog during provider migration. */
export const builtinCodingAgents: {
  readonly [Id in Exclude<BuiltinCodingAgentId, "pi" | "cursor" | "gemini-cli">]: CodingAgentWithHome;
} = {
  "claude-code": claudeCode,
  codex,
  grok,
  opencode
};

export function isBuiltinCodingAgentId(value: string): value is BuiltinCodingAgentId {
  return BUILTIN_CODING_AGENT_IDS.some((id) => id === value);
}
