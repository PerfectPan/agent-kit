import type { InstallAdapter } from "../index.js";
import { codexInstallAdapter } from "./codex/strategies.js";

/** The agents harness can install into, the same ones that have a built-in HookDialect. */
export const builtinInstallAdapters: Readonly<Record<"codex", InstallAdapter>> = {
  codex: codexInstallAdapter
};
