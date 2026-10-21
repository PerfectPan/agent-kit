import type { InstallAdapter } from "../index.js";
import { claudeCodeInstallAdapter } from "./claude-code/strategies.js";
import { codexInstallAdapter } from "./codex/strategies.js";
import { grokInstallAdapter } from "./grok/strategies.js";

/** The agents harness can install into, the same ones that have a built-in HookDialect. */
export const builtinInstallAdapters: Readonly<Record<"claude-code" | "codex" | "grok", InstallAdapter>> = {
  "claude-code": claudeCodeInstallAdapter,
  codex: codexInstallAdapter,
  grok: grokInstallAdapter
};
