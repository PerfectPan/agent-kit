import type { InstallAdapter } from "../index.js";
import { claudeCodeInstallAdapter } from "./claude-code/strategies.js";
import { codexInstallAdapter } from "./codex/strategies.js";

/** The agents harness can install into, the same ones that have a built-in HookDialect. */
export const builtinInstallAdapters: Readonly<Record<"claude-code" | "codex", InstallAdapter>> = {
  "claude-code": claudeCodeInstallAdapter,
  codex: codexInstallAdapter
};
