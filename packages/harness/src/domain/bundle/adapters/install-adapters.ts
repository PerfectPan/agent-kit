import type { InstallAdapter } from "../index.js";

/** The agents harness can install into, the same ones that have a built-in HookDialect. */
export const builtinInstallAdapters: Readonly<Record<never, InstallAdapter>> = {};
