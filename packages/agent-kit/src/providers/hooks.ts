import { builtinHookDialects } from "@rivus/agent-kit-harness/public/events";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

const { grok, ...otherHooks } = builtinHookDialects;
const builtins = { grok, ...otherHooks };

export const hooksTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"hooks">> =>
  mergeService("hooks", builtins, providers);
