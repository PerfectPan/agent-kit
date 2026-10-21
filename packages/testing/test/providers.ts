import { cursorProbe } from "@rivus/agent-kit-provider-cursor/discovery";
import { cursor } from "@rivus/agent-kit-provider-cursor/identity";
import { cursorInstallAdapter } from "@rivus/agent-kit-provider-cursor/install";
import { cursorHookDialect } from "@rivus/agent-kit-provider-cursor/hooks";
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
export const builtinCodingAgents = {
  "claude-code": identity["claude-code"],
  codex: identity.codex,
  cursor: cursor,
  "gemini-cli": identity["gemini-cli"],
  grok: identity.grok,
  opencode: identity.opencode,
  pi: pi
};
export const builtinProbeRecipes = {
  opencode: discovery.opencode,
  "claude-code": discovery["claude-code"],
  codex: discovery.codex,
  cursor: cursorProbe,
  pi: piProbe,
  "gemini-cli": discovery["gemini-cli"],
  grok: discovery.grok
};
export const builtinHookDialects = {
  "claude-code": hooks["claude-code"],
  codex: hooks.codex,
  cursor: cursorHookDialect,
  "gemini-cli": hooks["gemini-cli"],
  grok: hooks.grok,
  opencode: hooks.opencode,
  pi: piHookDialect
};
export const builtinInstallAdapters = {
  "claude-code": install["claude-code"],
  codex: install.codex,
  cursor: cursorInstallAdapter,
  "gemini-cli": install["gemini-cli"],
  grok: install.grok,
  opencode: install.opencode,
  pi: piInstallAdapter
};
export const builtinUsageDecoders = { ...usage, pi: piUsageDecoder };
