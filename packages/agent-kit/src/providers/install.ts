import { opencodeInstallAdapter } from "@rivus/agent-kit-provider-opencode/install";
import { geminiCliInstallAdapter } from "@rivus/agent-kit-provider-gemini-cli/install";
import { cursorInstallAdapter } from "@rivus/agent-kit-provider-cursor/install";
import { builtinInstallAdapters as contextBuiltins } from "@rivus/agent-kit-harness/public";
import { piInstallAdapter } from "@rivus/agent-kit-provider-pi/install";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinInstallAdapters: typeof contextBuiltins & {
  readonly opencode: typeof opencodeInstallAdapter;
  readonly "gemini-cli": typeof geminiCliInstallAdapter;
  readonly cursor: typeof cursorInstallAdapter;
  readonly pi: typeof piInstallAdapter;
} = {
  "claude-code": contextBuiltins["claude-code"],
  codex: contextBuiltins.codex,
  cursor: cursorInstallAdapter,
  "gemini-cli": geminiCliInstallAdapter,
  grok: contextBuiltins.grok,
  opencode: opencodeInstallAdapter,
  pi: piInstallAdapter
};

export const installTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"install">> =>
  mergeService("install", builtinInstallAdapters, providers);
