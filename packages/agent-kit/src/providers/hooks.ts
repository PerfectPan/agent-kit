import { builtinHookDialects as contextBuiltins } from "@rivus/agent-kit-harness/public/events";
import { piHookDialect } from "@rivus/agent-kit-provider-pi/hooks";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinHookDialects: typeof contextBuiltins & { readonly pi: typeof piHookDialect } = {
  ...contextBuiltins,
  pi: piHookDialect
};

const { grok, ...otherHooks } = builtinHookDialects;
const builtins = { grok, ...otherHooks };

export const hooksTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"hooks">> =>
  mergeService("hooks", builtins, providers);
