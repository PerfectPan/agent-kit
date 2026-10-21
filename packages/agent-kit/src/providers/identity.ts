import { codex } from "@rivus/agent-kit-provider-codex/identity";
import { claudeCode } from "@rivus/agent-kit-provider-claude-code/identity";
import { grok } from "@rivus/agent-kit-provider-grok/identity";
import { opencode } from "@rivus/agent-kit-provider-opencode/identity";
import { geminiCli } from "@rivus/agent-kit-provider-gemini-cli/identity";
import { cursor } from "@rivus/agent-kit-provider-cursor/identity";
import { validateIdentities } from "@rivus/agent-kit-catalog/public";
import { pi } from "@rivus/agent-kit-provider-pi/identity";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinCodingAgents: {
  readonly codex: typeof codex;
  readonly "claude-code": typeof claudeCode;
  readonly grok: typeof grok;
  readonly opencode: typeof opencode;
  readonly "gemini-cli": typeof geminiCli;
  readonly cursor: typeof cursor;
  readonly pi: typeof pi;
} = {
  "claude-code": claudeCode,
  codex: codex,
  cursor: cursor,
  "gemini-cli": geminiCli,
  grok: grok,
  opencode: opencode,
  pi: pi
};

export const identityTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"identity">> => {
  const table = mergeService("identity", builtinCodingAgents, providers);
  validateIdentities(table);
  return table;
};

/** Built-in ids come from the shell's provider identities, not a second list in a context. */
export type BuiltinCodingAgentId = keyof typeof builtinCodingAgents;

/** Accept third-party ids while keeping editor completion for built-ins. */
export type CodingAgentId = BuiltinCodingAgentId | (string & {});

export function isBuiltinCodingAgentId(value: string): value is BuiltinCodingAgentId {
  return Object.hasOwn(builtinCodingAgents, value);
}
