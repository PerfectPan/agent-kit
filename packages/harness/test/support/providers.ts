// Complete built-ins for cross-agent integration tests while providers move out of contexts.
import { builtinHookDialects as hooks } from "@rivus/agent-kit-harness";
import { piHookDialect } from "@rivus/agent-kit-provider-pi/hooks";
import { builtinInstallAdapters as install } from "@rivus/agent-kit-harness/public";
import { piInstallAdapter } from "@rivus/agent-kit-provider-pi/install";
export const builtinHookDialects = { ...hooks, pi: piHookDialect };
export const builtinInstallAdapters = { ...install, pi: piInstallAdapter };
