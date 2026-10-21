import type { InstallAdapter } from "../index.js";
import { claudeCodeInstallAdapter } from "./claude-code/strategies.js";
import { codexInstallAdapter } from "./codex/strategies.js";
import { grokInstallAdapter } from "./grok/strategies.js";
import { opencodeInstallAdapter } from "./opencode/strategies.js";

/** The agents harness can install into, the same ones that have a built-in HookDialect. */
export const builtinInstallAdapters: Readonly<Record<"claude-code" | "codex" | "grok" | "opencode", InstallAdapter>> = {
  "claude-code": claudeCodeInstallAdapter,
  codex: codexInstallAdapter,
  grok: grokInstallAdapter,
  opencode: opencodeInstallAdapter
};
