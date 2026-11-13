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
import { zcodeHookDialect } from "@rivus/agent-kit-provider-zcode/hooks";
import { qoder } from "@rivus/agent-kit-provider-qoder/identity";
import { qoderProbe } from "@rivus/agent-kit-provider-qoder/discovery";
import { qoderHookDialect } from "@rivus/agent-kit-provider-qoder/hooks";
import { qoderInstallAdapter } from "@rivus/agent-kit-provider-qoder/install";
import { dim } from "@rivus/agent-kit-provider-dim/identity";
import { dimProbe } from "@rivus/agent-kit-provider-dim/discovery";
import { dimHookDialect } from "@rivus/agent-kit-provider-dim/hooks";
import { dimInstallAdapter } from "@rivus/agent-kit-provider-dim/install";
import { dimUsageDecoder } from "@rivus/agent-kit-provider-dim/usage";
import { dimSessionAdapter } from "@rivus/agent-kit-provider-dim/sessions";
import { kimi } from "@rivus/agent-kit-provider-kimi/identity";
import { kimiProbe } from "@rivus/agent-kit-provider-kimi/discovery";
import { kimiHookDialect } from "@rivus/agent-kit-provider-kimi/hooks";
import { kimiInstallAdapter } from "@rivus/agent-kit-provider-kimi/install";
import { kimiUsageDecoder } from "@rivus/agent-kit-provider-kimi/usage";
import { kimiSessionAdapter } from "@rivus/agent-kit-provider-kimi/sessions";
export const builtinCodingAgents = {
  "claude-code": claudeCode,
  codex: codex,
  cursor: cursor,
  "gemini-cli": geminiCli,
  grok: grok,
  opencode: opencode,
  pi: pi,
  qoder,
  dim,
  kimi
};
export const builtinProbeRecipes = {
  opencode: opencodeProbe,
  "claude-code": claudeCodeProbe,
  codex: codexProbe,
  cursor: cursorProbe,
  pi: piProbe,
  "gemini-cli": geminiCliProbe,
  grok: grokProbe,
  kimi: kimiProbe,
  qoder: qoderProbe,
  dim: dimProbe
};
// ZCode first, as in the shell: its payloads also carry Grok's payload marker.
export const builtinHookDialects = {
  zcode: zcodeHookDialect,
  "claude-code": claudeCodeHookDialect,
  codex: codexHookDialect,
  cursor: cursorHookDialect,
  "gemini-cli": geminiCliHookDialect,
  grok: grokHookDialect,
  opencode: opencodeHookDialect,
  kimi: kimiHookDialect,
  pi: piHookDialect,
  qoder: qoderHookDialect,
  dim: dimHookDialect
};
export const builtinInstallAdapters = {
  "claude-code": claudeCodeInstallAdapter,
  codex: codexInstallAdapter,
  cursor: cursorInstallAdapter,
  "gemini-cli": geminiCliInstallAdapter,
  grok: grokInstallAdapter,
  opencode: opencodeInstallAdapter,
  pi: piInstallAdapter,
  qoder: qoderInstallAdapter,
  dim: dimInstallAdapter,
  kimi: kimiInstallAdapter
};
export const builtinUsageDecoders = {
  "claude-code": claudeCodeUsageDecoder,
  codex: codexUsageDecoder,
  "gemini-cli": geminiCliUsageDecoder,
  grok: grokUsageDecoder,
  opencode: opencodeUsageDecoder,
  pi: piUsageDecoder,
  dim: dimUsageDecoder,
  kimi: kimiUsageDecoder
};

export const builtinSessionAdapters = {
  "claude-code": claudeCodeSessionAdapter,
  codex: codexSessionAdapter,
  grok: grokSessionAdapter,
  dim: dimSessionAdapter,
  kimi: kimiSessionAdapter
};
