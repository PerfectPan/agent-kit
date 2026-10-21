import { builtinSessionAdapters as sessions } from "@rivus/agent-kit-sessions";
import { grokSessionAdapter } from "@rivus/agent-kit-provider-grok/sessions";
import { grokUsageDecoder } from "@rivus/agent-kit-provider-grok/usage";
import { grokInstallAdapter } from "@rivus/agent-kit-provider-grok/install";
import { grokHookDialect } from "@rivus/agent-kit-provider-grok/hooks";
import { grokProbe } from "@rivus/agent-kit-provider-grok/discovery";
import { grok } from "@rivus/agent-kit-provider-grok/identity";
import { opencodeUsageDecoder } from "@rivus/agent-kit-provider-opencode/usage";
import { opencodeInstallAdapter } from "@rivus/agent-kit-provider-opencode/install";
import { opencodeHookDialect } from "@rivus/agent-kit-provider-opencode/hooks";
import { opencodeProbe } from "@rivus/agent-kit-provider-opencode/discovery";
import { opencode } from "@rivus/agent-kit-provider-opencode/identity";
import { geminiCliUsageDecoder } from "@rivus/agent-kit-provider-gemini-cli/usage";
import { geminiCliInstallAdapter } from "@rivus/agent-kit-provider-gemini-cli/install";
import { geminiCliHookDialect } from "@rivus/agent-kit-provider-gemini-cli/hooks";
import { geminiCliProbe } from "@rivus/agent-kit-provider-gemini-cli/discovery";
import { geminiCli } from "@rivus/agent-kit-provider-gemini-cli/identity";
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
  "gemini-cli": geminiCli,
  grok: grok,
  opencode: opencode,
  pi: pi
};
export const builtinProbeRecipes = {
  opencode: opencodeProbe,
  "claude-code": discovery["claude-code"],
  codex: discovery.codex,
  cursor: cursorProbe,
  pi: piProbe,
  "gemini-cli": geminiCliProbe,
  grok: grokProbe
};
export const builtinHookDialects = {
  "claude-code": hooks["claude-code"],
  codex: hooks.codex,
  cursor: cursorHookDialect,
  "gemini-cli": geminiCliHookDialect,
  grok: grokHookDialect,
  opencode: opencodeHookDialect,
  pi: piHookDialect
};
export const builtinInstallAdapters = {
  "claude-code": install["claude-code"],
  codex: install.codex,
  cursor: cursorInstallAdapter,
  "gemini-cli": geminiCliInstallAdapter,
  grok: grokInstallAdapter,
  opencode: opencodeInstallAdapter,
  pi: piInstallAdapter
};
export const builtinUsageDecoders = {
  "claude-code": usage["claude-code"],
  codex: usage.codex,
  "gemini-cli": geminiCliUsageDecoder,
  grok: grokUsageDecoder,
  opencode: opencodeUsageDecoder,
  pi: piUsageDecoder
};

export const builtinSessionAdapters = {
  "claude-code": sessions["claude-code"],
  codex: sessions.codex,
  grok: grokSessionAdapter
};
