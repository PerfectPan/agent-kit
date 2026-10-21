import { cursorHookDialect } from "@rivus/agent-kit-provider-cursor/hooks";
import { builtinHookDialects as contextBuiltins } from "@rivus/agent-kit-harness/public/events";
import { piHookDialect } from "@rivus/agent-kit-provider-pi/hooks";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinHookDialects: typeof contextBuiltins & {
  readonly cursor: typeof cursorHookDialect;
  readonly pi: typeof piHookDialect;
} = {
  "claude-code": contextBuiltins["claude-code"],
  codex: contextBuiltins.codex,
  cursor: cursorHookDialect,
  "gemini-cli": contextBuiltins["gemini-cli"],
  grok: contextBuiltins.grok,
  opencode: contextBuiltins.opencode,
  pi: piHookDialect
};

const { grok, ...otherHooks } = builtinHookDialects;
const builtins = { grok, ...otherHooks };

export const hooksTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"hooks">> =>
  mergeService("hooks", builtins, providers);
