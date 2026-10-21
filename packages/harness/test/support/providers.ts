import { grokInstallAdapter } from "@rivus/agent-kit-provider-grok/install";
import { grokHookDialect } from "@rivus/agent-kit-provider-grok/hooks";
import { opencodeInstallAdapter } from "@rivus/agent-kit-provider-opencode/install";
import { opencodeHookDialect } from "@rivus/agent-kit-provider-opencode/hooks";
import { geminiCliInstallAdapter } from "@rivus/agent-kit-provider-gemini-cli/install";
import { geminiCliHookDialect } from "@rivus/agent-kit-provider-gemini-cli/hooks";
import { cursorInstallAdapter } from "@rivus/agent-kit-provider-cursor/install";
import { cursorHookDialect } from "@rivus/agent-kit-provider-cursor/hooks";
// Complete built-ins for cross-agent integration tests while providers move out of contexts.
import { builtinHookDialects as hooks } from "@rivus/agent-kit-harness";
import { piHookDialect } from "@rivus/agent-kit-provider-pi/hooks";
import { builtinInstallAdapters as install } from "@rivus/agent-kit-harness/public";
import { piInstallAdapter } from "@rivus/agent-kit-provider-pi/install";
export const builtinHookDialects: typeof hooks & {
  readonly grok: typeof grokHookDialect;
  readonly opencode: typeof opencodeHookDialect;
  readonly "gemini-cli": typeof geminiCliHookDialect;
  readonly cursor: typeof cursorHookDialect;
  readonly pi: typeof piHookDialect;
} = {
  "claude-code": hooks["claude-code"],
  codex: hooks.codex,
  cursor: cursorHookDialect,
  "gemini-cli": geminiCliHookDialect,
  grok: grokHookDialect,
  opencode: opencodeHookDialect,
  pi: piHookDialect
};
export const builtinInstallAdapters: typeof install & {
  readonly grok: typeof grokInstallAdapter;
  readonly opencode: typeof opencodeInstallAdapter;
  readonly "gemini-cli": typeof geminiCliInstallAdapter;
  readonly cursor: typeof cursorInstallAdapter;
  readonly pi: typeof piInstallAdapter;
} = {
  "claude-code": install["claude-code"],
  codex: install.codex,
  cursor: cursorInstallAdapter,
  "gemini-cli": geminiCliInstallAdapter,
  grok: grokInstallAdapter,
  opencode: opencodeInstallAdapter,
  pi: piInstallAdapter
};
