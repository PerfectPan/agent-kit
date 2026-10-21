import type { InstallAdapter } from "../index.js";
import { claudeCodeInstallAdapter } from "./claude-code/strategies.js";
import { codexInstallAdapter } from "./codex/strategies.js";
import { geminiCliInstallAdapter } from "./gemini-cli/strategies.js";
import { grokInstallAdapter } from "./grok/strategies.js";
import { opencodeInstallAdapter } from "./opencode/strategies.js";

/** The agents harness can install into, the same ones that have a built-in HookDialect. */
export const builtinInstallAdapters: Readonly<
  Record<"claude-code" | "codex" | "gemini-cli" | "grok" | "opencode", InstallAdapter>
> = {
  "claude-code": claudeCodeInstallAdapter,
  codex: codexInstallAdapter,
  "gemini-cli": geminiCliInstallAdapter,
  grok: grokInstallAdapter,
  opencode: opencodeInstallAdapter
};
