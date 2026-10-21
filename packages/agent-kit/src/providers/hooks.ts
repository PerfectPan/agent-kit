import { grokHookDialect } from "@rivus/agent-kit-provider-grok/hooks";
import { opencodeHookDialect } from "@rivus/agent-kit-provider-opencode/hooks";
import { geminiCliHookDialect } from "@rivus/agent-kit-provider-gemini-cli/hooks";
import { cursorHookDialect } from "@rivus/agent-kit-provider-cursor/hooks";
import { builtinHookDialects as contextBuiltins } from "@rivus/agent-kit-harness/public/events";
import { piHookDialect } from "@rivus/agent-kit-provider-pi/hooks";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinHookDialects: typeof contextBuiltins & {
  readonly grok: typeof grokHookDialect;
  readonly opencode: typeof opencodeHookDialect;
  readonly "gemini-cli": typeof geminiCliHookDialect;
  readonly cursor: typeof cursorHookDialect;
  readonly pi: typeof piHookDialect;
} = {
  "claude-code": contextBuiltins["claude-code"],
  codex: contextBuiltins.codex,
  cursor: cursorHookDialect,
  "gemini-cli": geminiCliHookDialect,
  grok: grokHookDialect,
  opencode: opencodeHookDialect,
  pi: piHookDialect
};

const { grok, ...otherHooks } = builtinHookDialects;
const builtins = { grok, ...otherHooks };

export const hooksTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"hooks">> =>
  mergeService("hooks", builtins, providers);
