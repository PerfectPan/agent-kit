import { cursorInstallAdapter } from "@rivus/agent-kit-provider-cursor/install";
import { cursorHookDialect } from "@rivus/agent-kit-provider-cursor/hooks";
// Complete built-ins for cross-agent integration tests while providers move out of contexts.
import { builtinHookDialects as hooks } from "@rivus/agent-kit-harness";
import { piHookDialect } from "@rivus/agent-kit-provider-pi/hooks";
import { builtinInstallAdapters as install } from "@rivus/agent-kit-harness/public";
import { piInstallAdapter } from "@rivus/agent-kit-provider-pi/install";
export const builtinHookDialects: typeof hooks & {
  readonly cursor: typeof cursorHookDialect;
  readonly pi: typeof piHookDialect;
} = {
  "claude-code": hooks["claude-code"],
  codex: hooks.codex,
  cursor: cursorHookDialect,
  "gemini-cli": hooks["gemini-cli"],
  grok: hooks.grok,
  opencode: hooks.opencode,
  pi: piHookDialect
};
export const builtinInstallAdapters: typeof install & {
  readonly cursor: typeof cursorInstallAdapter;
  readonly pi: typeof piInstallAdapter;
} = {
  "claude-code": install["claude-code"],
  codex: install.codex,
  cursor: cursorInstallAdapter,
  "gemini-cli": install["gemini-cli"],
  grok: install.grok,
  opencode: install.opencode,
  pi: piInstallAdapter
};
