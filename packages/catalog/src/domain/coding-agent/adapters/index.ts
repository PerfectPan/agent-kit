import { err, ok, type Result } from "../../result/index.js";
import {
  type AgentHome,
  type BuiltinCodingAgentId,
  CODING_AGENT_ID_PATTERN,
  type CodingAgent,
  type CodingAgentId,
  type CodingAgentIdWithHome,
  type CodingAgentWithHome,
  type HomeContext,
  homeFromRule,
  type HomeRule,
  type InvalidCodingAgentId
} from "../index.js";
import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { cursor } from "./cursor.js";
import { geminiCli } from "./gemini-cli.js";
import { grok } from "./grok.js";
import { opencode } from "./opencode.js";
import { pi } from "./pi.js";

/** Each built-in agent's identity; the agents whose id is a `CodingAgentIdWithHome` also have a home rule. */
export const builtinCodingAgents: {
  readonly [Id in BuiltinCodingAgentId]: Id extends CodingAgentIdWithHome ? CodingAgentWithHome : CodingAgent;
} = {
  "claude-code": claudeCode,
  codex,
  cursor,
  "gemini-cli": geminiCli,
  grok,
  opencode,
  pi
};

// Built on first use: a module-level map would keep the agent table in bundles that never parse an id, such as the
// hook entry, which only needs AgentKitError.
let byAlias: Map<string, BuiltinCodingAgentId> | undefined;

function aliasTable(): Map<string, BuiltinCodingAgentId> {
  byAlias ??= new Map(
    Object.values(builtinCodingAgents).flatMap((agent) => [
      [agent.id, agent.id],
      ...agent.aliases.map((alias): [string, BuiltinCodingAgentId] => [alias, agent.id])
    ])
  );
  return byAlias;
}

export function isBuiltinCodingAgentId(value: string): value is BuiltinCodingAgentId {
  return Object.hasOwn(builtinCodingAgents, value);
}

/**
 * The rule that decides an agent's home: the caller's own rule for the agent wins, else a built-in agent's rule;
 * `undefined` when there is neither, so a path or adapter that needs the home reports it instead of guessing.
 */
export function homeRuleOf(agent: CodingAgentId, own?: HomeRule): HomeRule | undefined {
  return own ?? (isBuiltinCodingAgentId(agent) ? builtinCodingAgents[agent].home : undefined);
}

/**
 * Resolves an id typed by a user or another tool: case and surrounding space are ignored, an alias becomes its
 * canonical id, and any other id of the right shape is accepted as a third-party id.
 */
export function parseCodingAgentId(input: string): Result<CodingAgentId, InvalidCodingAgentId> {
  const id = input.trim().toLowerCase();
  const builtin = aliasTable().get(id);
  if (builtin !== undefined) {
    return ok(builtin);
  }
  return CODING_AGENT_ID_PATTERN.test(id) ? ok(id) : err({ _tag: "InvalidCodingAgentId", input });
}

/**
 * The home of a built-in agent with a home rule, from its override variable, else its default under the user's home
 * directory. For any agent, `builtinCodingAgents[id].home` with `homeFromRule` does the same when the rule exists.
 */
export function resolveHome(id: CodingAgentIdWithHome, context: HomeContext): AgentHome {
  return homeFromRule(id, builtinCodingAgents[id].home, context);
}
