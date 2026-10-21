// Complete built-ins for cross-agent integration tests while providers move out of contexts.
import { builtinCodingAgents as identity } from "@rivus/agent-kit-catalog";
import { pi } from "@rivus/agent-kit-provider-pi/identity";
import { builtinProbeRecipes as discovery } from "@rivus/agent-kit-discovery";
import { piProbe } from "@rivus/agent-kit-provider-pi/discovery";
import { builtinHookDialects as hooks } from "@rivus/agent-kit-harness";
import { piHookDialect } from "@rivus/agent-kit-provider-pi/hooks";
import { builtinInstallAdapters as install } from "@rivus/agent-kit-harness/public";
import { piInstallAdapter } from "@rivus/agent-kit-provider-pi/install";
import { builtinUsageDecoders as usage } from "@rivus/agent-kit-sessions";
import { piUsageDecoder } from "@rivus/agent-kit-provider-pi/usage";
export const builtinCodingAgents = { ...identity, pi: pi };
export const builtinProbeRecipes = {
  opencode: discovery.opencode,
  "claude-code": discovery["claude-code"],
  codex: discovery.codex,
  cursor: discovery.cursor,
  pi: piProbe,
  "gemini-cli": discovery["gemini-cli"],
  grok: discovery.grok
};
export const builtinHookDialects = { ...hooks, pi: piHookDialect };
export const builtinInstallAdapters = { ...install, pi: piInstallAdapter };
export const builtinUsageDecoders = { ...usage, pi: piUsageDecoder };
