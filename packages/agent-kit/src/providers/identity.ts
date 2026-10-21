import { codex } from "@rivus/agent-kit-provider-codex/identity";
import { claudeCode } from "@rivus/agent-kit-provider-claude-code/identity";
import { grok } from "@rivus/agent-kit-provider-grok/identity";
import { opencode } from "@rivus/agent-kit-provider-opencode/identity";
import { geminiCli } from "@rivus/agent-kit-provider-gemini-cli/identity";
import { cursor } from "@rivus/agent-kit-provider-cursor/identity";
import { builtinCodingAgents as contextBuiltins, validateIdentities } from "@rivus/agent-kit-catalog/public";
import { pi } from "@rivus/agent-kit-provider-pi/identity";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinCodingAgents: typeof contextBuiltins & {
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
