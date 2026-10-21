import { codexInstallAdapter } from "@rivus/agent-kit-provider-codex/install";
import { claudeCodeInstallAdapter } from "@rivus/agent-kit-provider-claude-code/install";
import { grokInstallAdapter } from "@rivus/agent-kit-provider-grok/install";
import { opencodeInstallAdapter } from "@rivus/agent-kit-provider-opencode/install";
import { geminiCliInstallAdapter } from "@rivus/agent-kit-provider-gemini-cli/install";
import { cursorInstallAdapter } from "@rivus/agent-kit-provider-cursor/install";
import { piInstallAdapter } from "@rivus/agent-kit-provider-pi/install";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinInstallAdapters: {
  readonly codex: typeof codexInstallAdapter;
  readonly "claude-code": typeof claudeCodeInstallAdapter;
  readonly grok: typeof grokInstallAdapter;
  readonly opencode: typeof opencodeInstallAdapter;
  readonly "gemini-cli": typeof geminiCliInstallAdapter;
  readonly cursor: typeof cursorInstallAdapter;
  readonly pi: typeof piInstallAdapter;
} = {
  "claude-code": claudeCodeInstallAdapter,
  codex: codexInstallAdapter,
  cursor: cursorInstallAdapter,
  "gemini-cli": geminiCliInstallAdapter,
  grok: grokInstallAdapter,
  opencode: opencodeInstallAdapter,
  pi: piInstallAdapter
};

export const installTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"install">> =>
  mergeService("install", builtinInstallAdapters, providers);
