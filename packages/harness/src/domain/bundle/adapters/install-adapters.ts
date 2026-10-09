import type { InstallAdapter } from "../index.js";
import { claudeCodeInstallAdapter } from "./claude-code/strategies.js";
import { codexInstallAdapter } from "./codex/strategies.js";
import { cursorInstallAdapter } from "./cursor/strategies.js";
import { geminiCliInstallAdapter } from "./gemini-cli/strategies.js";
import { grokInstallAdapter } from "./grok/strategies.js";
import { opencodeInstallAdapter } from "./opencode/strategies.js";
import { piInstallAdapter } from "./pi/strategies.js";

/** The agents harness can install into, the same ones that have a built-in HookDialect. */
export const builtinInstallAdapters: Readonly<
  Record<"claude-code" | "codex" | "cursor" | "gemini-cli" | "grok" | "opencode" | "pi", InstallAdapter>
> = {
  "claude-code": claudeCodeInstallAdapter,
  codex: codexInstallAdapter,
  cursor: cursorInstallAdapter,
  "gemini-cli": geminiCliInstallAdapter,
  grok: grokInstallAdapter,
  opencode: opencodeInstallAdapter,
  pi: piInstallAdapter
};
