import { codexUsageDecoder } from "@rivus/agent-kit-provider-codex/usage";
import { codexSessionAdapter } from "@rivus/agent-kit-provider-codex/sessions";
import { codexInstallAdapter } from "@rivus/agent-kit-provider-codex/install";
import { codexHookDialect } from "@rivus/agent-kit-provider-codex/hooks";
import { codexProbe } from "@rivus/agent-kit-provider-codex/discovery";
import { codex } from "@rivus/agent-kit-provider-codex/identity";
import { claudeCodeUsageDecoder } from "@rivus/agent-kit-provider-claude-code/usage";
import { claudeCodeSessionAdapter } from "@rivus/agent-kit-provider-claude-code/sessions";
import { claudeCodeInstallAdapter } from "@rivus/agent-kit-provider-claude-code/install";
import { claudeCodeHookDialect } from "@rivus/agent-kit-provider-claude-code/hooks";
import { claudeCodeProbe } from "@rivus/agent-kit-provider-claude-code/discovery";
import { claudeCode } from "@rivus/agent-kit-provider-claude-code/identity";
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
import { pi } from "@rivus/agent-kit-provider-pi/identity";
import { piProbe } from "@rivus/agent-kit-provider-pi/discovery";
import { piHookDialect } from "@rivus/agent-kit-provider-pi/hooks";
import { piInstallAdapter } from "@rivus/agent-kit-provider-pi/install";
import { piUsageDecoder } from "@rivus/agent-kit-provider-pi/usage";
export const builtinCodingAgents = {
  "claude-code": claudeCode,
  codex: codex,
  cursor: cursor,
  "gemini-cli": geminiCli,
  grok: grok,
  opencode: opencode,
  pi: pi
};
export const builtinProbeRecipes = {
  opencode: opencodeProbe,
  "claude-code": claudeCodeProbe,
  codex: codexProbe,
  cursor: cursorProbe,
  pi: piProbe,
  "gemini-cli": geminiCliProbe,
  grok: grokProbe
};
export const builtinHookDialects = {
  "claude-code": claudeCodeHookDialect,
  codex: codexHookDialect,
  cursor: cursorHookDialect,
  "gemini-cli": geminiCliHookDialect,
  grok: grokHookDialect,
  opencode: opencodeHookDialect,
  pi: piHookDialect
};
export const builtinInstallAdapters = {
  "claude-code": claudeCodeInstallAdapter,
  codex: codexInstallAdapter,
  cursor: cursorInstallAdapter,
  "gemini-cli": geminiCliInstallAdapter,
  grok: grokInstallAdapter,
  opencode: opencodeInstallAdapter,
  pi: piInstallAdapter
};
export const builtinUsageDecoders = {
  "claude-code": claudeCodeUsageDecoder,
  codex: codexUsageDecoder,
  "gemini-cli": geminiCliUsageDecoder,
  grok: grokUsageDecoder,
  opencode: opencodeUsageDecoder,
  pi: piUsageDecoder
};

export const builtinSessionAdapters = {
  "claude-code": claudeCodeSessionAdapter,
  codex: codexSessionAdapter,
  grok: grokSessionAdapter
};
