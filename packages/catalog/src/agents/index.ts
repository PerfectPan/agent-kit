import { err, ok, type Result } from "../domain/result/index.js";
import {
  type AgentHome,
  type BuiltinCodingAgentId,
  CODING_AGENT_ID_PATTERN,
  type CodingAgent,
  type CodingAgentId,
  type HomeContext,
  homeFromRule,
  type InvalidCodingAgentId
} from "../domain/coding-agent/index.js";
import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { geminiCli } from "./gemini-cli.js";
import { grok } from "./grok.js";
import { opencode } from "./opencode.js";
import { pi } from "./pi.js";

export const builtinCodingAgents: Readonly<Record<BuiltinCodingAgentId, CodingAgent>> = {
  "claude-code": claudeCode,
  codex,
  "gemini-cli": geminiCli,
  grok,
  opencode,
  pi
};

const byAlias = new Map<string, BuiltinCodingAgentId>(
  Object.values(builtinCodingAgents).flatMap((agent) => [
    [agent.id, agent.id],
    ...agent.aliases.map((alias): [string, BuiltinCodingAgentId] => [alias, agent.id])
  ])
);

export function isBuiltinCodingAgentId(value: string): value is BuiltinCodingAgentId {
  return Object.hasOwn(builtinCodingAgents, value);
}

/**
 * Resolves an id typed by a user or another tool: case and surrounding space are ignored, an alias becomes its
 * canonical id, and any other id of the right shape is accepted as a third-party id.
 */
export function parseCodingAgentId(input: string): Result<CodingAgentId, InvalidCodingAgentId> {
  const id = input.trim().toLowerCase();
  const builtin = byAlias.get(id);
  if (builtin !== undefined) {
    return ok(builtin);
  }
  return CODING_AGENT_ID_PATTERN.test(id) ? ok(id) : err({ _tag: "InvalidCodingAgentId", input });
}

/** The home of a built-in agent from its override variable, else its default under the user's home directory. */
export function resolveHome(id: BuiltinCodingAgentId, context: HomeContext): AgentHome {
  return homeFromRule(id, builtinCodingAgents[id].home, context);
}
