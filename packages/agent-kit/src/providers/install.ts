import { cursorInstallAdapter } from "@rivus/agent-kit-provider-cursor/install";
import { builtinInstallAdapters as contextBuiltins } from "@rivus/agent-kit-harness/public";
import { piInstallAdapter } from "@rivus/agent-kit-provider-pi/install";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinInstallAdapters: typeof contextBuiltins & {
  readonly cursor: typeof cursorInstallAdapter;
  readonly pi: typeof piInstallAdapter;
} = {
  "claude-code": contextBuiltins["claude-code"],
  codex: contextBuiltins.codex,
  cursor: cursorInstallAdapter,
  "gemini-cli": contextBuiltins["gemini-cli"],
  grok: contextBuiltins.grok,
  opencode: contextBuiltins.opencode,
  pi: piInstallAdapter
};

export const installTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"install">> =>
  mergeService("install", builtinInstallAdapters, providers);
